import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { PrismaService } from '../../../database/prisma.service';
import { DecimalValue } from '../../catalog/domain/decimal';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { GetCurrentPricesUseCase } from '../../prices/application/get-current-prices.use-case';
import { evaluateBenefits } from '../../promotions/domain/benefit-engine';
import type { BenefitEngineResult, BenefitPurchase, CapUsageEntry } from '../../promotions/domain/benefit-engine';
import type { PayerProfile } from '../../promotions/domain/payer-eligibility';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import { parseCalendarDate, RoutineRuleError } from '../../routines/domain/routine-rules';
import { argentineNoon } from '../../shopping-plans/domain/plan-calendar';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { MAX_BENEFIT_LINES } from '../presentation/benefits.dto';
import type { EvaluateBenefitsDto } from '../presentation/benefits.dto';

const invalid = (error: string, message: string, fields: string[] = ['purchases']) => new PublicHttpException(400, error, message, fields);

export interface PricedLine {
  readonly lineId: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly unitPriceUnit: string;
  readonly priceSource: string;
  readonly observedAt: string;
  readonly isStale: boolean;
}

export interface BenefitsEvaluationDto {
  /** Lo declarado por la persona: lo único que se usa para decidir elegibilidad. */
  readonly payer: PayerProfile & { readonly declared: boolean };
  readonly purchases: readonly {
    readonly purchaseId: string;
    readonly storeId: string;
    readonly storeName: string;
    readonly chainName: string;
    readonly date: string;
    readonly lines: readonly PricedLine[];
    /** Productos sin precio en esa sucursal: quedan afuera del cálculo, no se inventan. */
    readonly missingPrices: readonly { readonly lineId: string; readonly productId: string }[];
  }[];
  readonly result: BenefitEngineResult;
}

/**
 * Evalúa una canasta con el motor de beneficios (P10-01, ADR 0023): precios actuales de cada
 * sucursal (con su fuente y frescura), promociones vigentes ese día, preferencias de pago
 * declaradas y lo informado como ya usado de cada tope. No guarda nada.
 */
@Injectable()
export class EvaluateBenefitsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductRepository,
    private readonly stores: StoreRepository,
    private readonly currentPrices: GetCurrentPricesUseCase,
    private readonly promotions: PromotionRepository,
  ) {}

  async execute(userId: string, dto: EvaluateBenefitsDto, now = new Date()): Promise<BenefitsEvaluationDto> {
    const totalLines = dto.purchases.reduce((total, purchase) => total + purchase.lines.length, 0);
    if (totalLines > MAX_BENEFIT_LINES) throw invalid('TOO_MANY_LINES', `Una evaluación admite hasta ${MAX_BENEFIT_LINES} productos en total.`);
    for (const purchase of dto.purchases) {
      try {
        parseCalendarDate(purchase.date, 'date');
      } catch (error: unknown) {
        if (error instanceof RoutineRuleError) throw invalid('DATE_INVALID', 'La fecha debe ser un día real con formato AAAA-MM-DD.');
        throw error;
      }
    }

    const [user, usage] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { paymentMethods: true, banks: true, membershipPrograms: true } }),
      this.prisma.benefitCapUsage.findMany({ where: { userId }, select: { capKey: true, periodKey: true, consumed: true } }),
    ]);
    if (!user) throw new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');
    const payer: PayerProfile = { paymentMethods: user.paymentMethods, banks: user.banks, memberships: user.membershipPrograms };
    const capUsage: CapUsageEntry[] = usage.map((entry) => ({ capKey: entry.capKey, periodKey: entry.periodKey, consumed: toAmountString(entry.consumed, 2) }));

    const storeIds = [...new Set(dto.purchases.map((purchase) => purchase.storeId))];
    const productIds = [...new Set(dto.purchases.flatMap((purchase) => purchase.lines.map((line) => line.productId)))];
    const [stores, products] = await Promise.all([this.stores.findManyByIds(storeIds), this.products.findManyByIds(productIds)]);
    const storesById = new Map(stores.filter((store) => store.isActive).map((store) => [store.id, store]));
    const productsById = new Map(products.filter((product) => product.isActive).map((product) => [product.id, product]));
    if (storeIds.some((id) => !storesById.has(id))) throw invalid('STORE_NOT_FOUND', 'Alguna sucursal no existe o no está activa.');
    if (productIds.some((id) => !productsById.has(id))) throw invalid('PRODUCT_NOT_FOUND', 'Algún producto no existe o no está disponible.');

    // Precio actual de cada producto en las sucursales pedidas (con precedencia de fuente y frescura).
    const priceOf = new Map<string, Awaited<ReturnType<GetCurrentPricesUseCase['execute']>>[number]>();
    for (const productId of productIds) {
      for (const view of await this.currentPrices.execute(productId, { storeIds, now })) priceOf.set(`${productId}|${view.storeId}`, view);
    }

    const instants = dto.purchases.map((purchase) => argentineNoon(purchase.date));
    const rules = await this.promotions.findActiveBetween(
      {
        storeIds,
        chainIds: [...new Set(stores.map((store) => store.chainId))],
        productIds,
        canonicalProductIds: [...new Set(products.flatMap((product) => (product.canonicalProductId ? [product.canonicalProductId] : [])))],
        from: new Date(Math.min(...instants.map((instant) => instant.getTime()))),
        until: new Date(Math.max(...instants.map((instant) => instant.getTime()))),
      },
      1000,
    );

    const purchases: BenefitPurchase[] = [];
    const described: BenefitsEvaluationDto['purchases'][number][] = [];
    dto.purchases.forEach((purchase, purchaseIndex) => {
      const store = storesById.get(purchase.storeId)!;
      const purchaseId = `compra-${purchaseIndex + 1}`;
      const lines: PricedLine[] = [];
      const missingPrices: { lineId: string; productId: string }[] = [];
      const engineLines: BenefitPurchase['lines'][number][] = [];
      purchase.lines.forEach((line, lineIndex) => {
        const product = productsById.get(line.productId)!;
        const lineId = `${purchaseId}-${String(lineIndex + 1).padStart(3, '0')}`;
        const quantity = DecimalValue.parse(line.quantity);
        if (!quantity.isPositive() || (product.saleMode === 'PACKAGED' && !quantity.isInteger())) {
          throw invalid('QUANTITY_INVALID', 'Un envasado se compra en unidades enteras; por peso, en la unidad base, siempre más que cero.', ['quantity']);
        }
        const price = priceOf.get(`${line.productId}|${purchase.storeId}`);
        if (!price) {
          missingPrices.push({ lineId, productId: line.productId });
          return;
        }
        lines.push({
          lineId,
          productId: product.id,
          productName: product.name,
          quantity: line.quantity,
          unitPrice: price.price,
          unitPriceUnit: price.unitPriceUnit,
          priceSource: price.source,
          observedAt: price.observedAt.toISOString(),
          isStale: price.freshness.isStale,
        });
        engineLines.push({
          lineId,
          productId: product.id,
          canonicalProductId: product.canonicalProductId,
          unitPrice: price.price,
          quantity: line.quantity,
          saleMode: product.saleMode,
        });
      });
      purchases.push({ purchaseId, storeId: store.id, chainId: store.chainId, instant: instants[purchaseIndex]!, lines: engineLines });
      described.push({ purchaseId, storeId: store.id, storeName: store.name, chainName: store.chainName, date: purchase.date, lines, missingPrices });
    });

    return {
      payer: { ...payer, declared: payer.banks.length + payer.paymentMethods.length + payer.memberships.length > 0 },
      purchases: described,
      result: evaluateBenefits({ purchases, rules, payer, capUsage }),
    };
  }
}
