import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { DecimalValue } from '../../catalog/domain/decimal';
import { toBaseQuantity, unitPricePer100g } from '../../catalog/domain/units';
import { CanonicalProductRepository } from '../../catalog/infrastructure/canonical-product.repository';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import type { ProductRecord } from '../../catalog/domain/catalog-records';
import { toCanonicalProductDto, toProductDto } from '../../catalog/presentation/catalog.mappers';
import { minimumQuantityFor, priceLine } from '../../promotions/domain/promotion-calculator';
import type { PromotionRule } from '../../promotions/domain/promotion.types';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import type { StoreScopeQuery } from '../../stores/application/resolve-store-scope.use-case';
import type { StoreSummaryRecord } from '../../stores/domain/store-records';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { toStoreDto } from '../../stores/presentation/store.contracts';
import { freshnessOf } from '../domain/price-freshness';
import type { CurrentPriceRecord } from '../domain/price-records';
import { UNIT_PRICE_SCALE } from '../domain/price-normalizer';
import { ProductPriceRepository } from '../infrastructure/product-price.repository';
import type {
  CanonicalOfferDto,
  CanonicalPricesDto,
  OfferPromotionDto,
  PriceSortBy,
} from '../presentation/price.contracts';

const MONEY_SCALE = 2;

export interface CanonicalPricesQuery extends StoreScopeQuery {
  /** Producto por el que se llegó: sus ofertas son coincidencia exacta. */
  readonly productId?: string;
  readonly includeStale?: boolean;
  readonly sortBy?: PriceSortBy;
  readonly limit?: number;
  /** Momento de referencia; los tests lo fijan. */
  readonly now?: Date;
}

/**
 * Comparación de una necesidad: todas las presentaciones del canónico con su
 * precio actual por sucursal, comparables por unidad base.
 *
 * Distingue coincidencia exacta de alternativa, conserva el precio sin promoción
 * y, cuando una promoción automática lo cambia, informa cuántas unidades hay que
 * llevar. El orden no mezcla dimensiones: todas las alternativas de un canónico
 * comparten unidad base (ADR 0002).
 */
@Injectable()
export class GetCanonicalPricesUseCase {
  constructor(
    private readonly canonicalProducts: CanonicalProductRepository,
    private readonly products: ProductRepository,
    private readonly prices: ProductPriceRepository,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    private readonly promotions: PromotionRepository,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(canonicalProductId: string, query: CanonicalPricesQuery = {}): Promise<CanonicalPricesDto> {
    const canonical = await this.canonicalProducts.findById(canonicalProductId);
    if (!canonical) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto canónico.');

    const scope = await this.storeScope.resolve(query);
    const sortBy = query.sortBy ?? 'UNIT_PRICE';
    if (sortBy === 'DISTANCE' && scope.origin !== 'COORDINATES') {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Ordenar por distancia necesita latitud y longitud.', [
        'sortBy',
      ]);
    }
    const now = query.now ?? new Date();
    const includeStale = query.includeStale ?? true;
    const maxAgeDays = this.config.prices.maxAgeDays;
    const limit = Math.min(query.limit ?? MAX_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const alternatives = await this.products.listByCanonicalProduct(canonical.id);
    const emptyScope = scope.storeIds?.length === 0 || alternatives.length === 0;
    const current = emptyScope
      ? []
      : await this.prices.findCurrentByProducts(
          alternatives.map((product) => product.id),
          { storeIds: scope.storeIds ?? undefined, sourcePrecedence: this.config.prices.sourcePrecedence },
        );

    const storesById = new Map(
      (await this.stores.findManyByIds([...new Set(current.map((price) => price.storeId))])).map((store) => [
        store.id,
        store,
      ]),
    );
    const rules = current.length
      ? await this.promotions.findActiveFor({
          instant: now,
          storeIds: [...storesById.keys()],
          chainIds: [...new Set([...storesById.values()].map((store) => store.chainId))],
          productIds: alternatives.map((product) => product.id),
          canonicalProductIds: [canonical.id],
        })
      : [];

    const productsById = new Map(alternatives.map((product) => [product.id, product]));
    const offers: CanonicalOfferDto[] = [];
    for (const price of current) {
      const product = productsById.get(price.productId);
      const store = storesById.get(price.storeId);
      if (!product || !store) continue;
      const freshness = freshnessOf(price.observedAt, now, maxAgeDays);
      if (!includeStale && freshness.isStale) continue;
      offers.push({
        product: toProductDto(product),
        matchType: query.productId === product.id ? 'EXACT' : 'ALTERNATIVE',
        store: toStoreDto(store, scope.distances.get(store.id) ?? null),
        price: price.price,
        currency: price.currency,
        unitPrice: price.unitPrice,
        unitPriceUnit: price.unitPriceUnit,
        unitPricePer100g:
          price.unitPriceUnit === 'KG'
            ? unitPricePer100g(DecimalValue.parse(price.unitPrice), price.unitPriceUnit).toFixed(UNIT_PRICE_SCALE)
            : null,
        source: price.source,
        freshness: {
          observedAt: freshness.observedAt.toISOString(),
          ageDays: freshness.ageDays,
          maxAgeDays: freshness.maxAgeDays,
          isStale: freshness.isStale,
        },
        promotion: this.bestPromotion(product, price, store, rules, now),
      });
    }

    return {
      canonicalProduct: toCanonicalProductDto(canonical),
      scope: {
        origin: scope.origin,
        radiusKm: scope.radiusKm,
        distancesAvailable: scope.origin === 'COORDINATES',
        storesConsidered: scope.storeIds?.length ?? storesById.size,
        maxAgeDays,
        includeStale,
      },
      sortBy,
      offers: this.sort(offers, sortBy).slice(0, limit),
    };
  }

  /**
   * Evalúa las promociones sobre la cantidad mínima que las habilita. El precio
   * regular no se toca: el beneficio se muestra al lado, con su condición.
   */
  private bestPromotion(
    product: ProductRecord,
    price: CurrentPriceRecord,
    store: StoreSummaryRecord,
    rules: readonly PromotionRule[],
    instant: Date,
  ): OfferPromotionDto | null {
    if (!rules.length) return null;
    const target = {
      storeId: store.id,
      chainId: store.chainId,
      productId: product.id,
      canonicalProductId: product.canonicalProductId,
    };
    let best: OfferPromotionDto | null = null;
    for (const rule of rules) {
      const minimumQuantity = minimumQuantityFor(rule);
      // La venta por peso se compara sobre su base de cotización (1 KG, 1 L).
      const quantity = product.saleMode === 'VARIABLE_WEIGHT' ? '1' : String(minimumQuantity);
      const charge = priceLine({ unitPrice: price.price, quantity, saleMode: product.saleMode }, [rule], {
        target,
        instant,
      });
      if (charge.appliedPromotionId !== rule.id) continue;
      const baseQuantity = toBaseQuantity(DecimalValue.parse(product.quantity), product.unit).multiply(
        DecimalValue.parse(quantity),
      );
      const candidate: OfferPromotionDto = {
        id: rule.id,
        name: rule.name,
        type: rule.type,
        minimumQuantity: product.saleMode === 'VARIABLE_WEIGHT' ? 1 : minimumQuantity,
        regularTotal: charge.regularTotal,
        total: charge.total,
        discount: charge.discount,
        promotionalUnitPrice: DecimalValue.parse(charge.total)
          .divide(baseQuantity, UNIT_PRICE_SCALE)
          .toFixed(UNIT_PRICE_SCALE),
        eligibleWeekdays: [...rule.eligibleWeekdays],
        terms: rule.terms,
      };
      if (!best || DecimalValue.parse(candidate.discount).compare(DecimalValue.parse(best.discount)) > 0) {
        best = candidate;
      }
    }
    return best;
  }

  /** Orden estable: el criterio elegido y, ante empate, el id de la sucursal. */
  private sort(offers: CanonicalOfferDto[], sortBy: PriceSortBy): CanonicalOfferDto[] {
    const byStore = (a: CanonicalOfferDto, b: CanonicalOfferDto) =>
      a.store.id < b.store.id ? -1 : a.store.id > b.store.id ? 1 : 0;
    return offers.sort((a, b) => {
      if (sortBy === 'DISTANCE') {
        const distance = (a.store.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.store.distanceMeters ?? Number.POSITIVE_INFINITY);
        if (distance !== 0) return distance;
        return byStore(a, b);
      }
      const field = sortBy === 'PRICE' ? 'price' : 'unitPrice';
      const scale = sortBy === 'PRICE' ? MONEY_SCALE : UNIT_PRICE_SCALE;
      const comparison = DecimalValue.parse(a[field])
        .round(scale)
        .compare(DecimalValue.parse(b[field]).round(scale));
      if (comparison !== 0) return comparison;
      return byStore(a, b);
    });
  }
}
