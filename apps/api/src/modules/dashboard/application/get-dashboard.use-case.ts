import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { PrismaService } from '../../../database/prisma.service';
import { DecimalValue } from '../../catalog/domain/decimal';
import { normalizeName } from '../../catalog/domain/naming';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { CurrentPriceAnalysis } from '../../prices/application/current-price-analysis';
import { argentineDate } from '../../prices/domain/price-analysis';
import type { PriceObservationRecord } from '../../prices/domain/price-records';
import { effectiveStatus } from '../../shopping-plans/domain/plan-status';
import type { PlanItemSnapshot } from '../../shopping-plans/domain/plan-snapshot';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { rankOpportunities } from '../domain/opportunities';
import type { AnalyzedSeries } from '../domain/opportunities';
import { summarizeSavings } from '../domain/savings-summary';
import type { DashboardDto, NextPurchaseDto, OpportunityDto } from '../presentation/dashboard.contracts';

/** Sucursales más cercanas (o de la localidad) donde se buscan oportunidades. */
const MAX_OPPORTUNITY_STORES = 20;
const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);
const REGISTERED_MESSAGE = 'Todavía no registramos compras: el ahorro de esta pantalla es estimado.';

type Location = { latitude: number; longitude: number; radiusKm: number } | { city: string; province: string } | null;

/**
 * Resumen privado (P6-02, ADR 0017): próxima compra, rutinas, ahorro **estimado**
 * sin contar dos veces el mismo período y oportunidades en los productos
 * habituales. Todo filtrado por el usuario del token.
 */
@Injectable()
export class GetDashboardUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductRepository,
    private readonly currentPrices: CurrentPriceAnalysis,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
  ) {}

  async execute(userId: string, now: Date = new Date()): Promise<DashboardDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { latitude: true, longitude: true, city: true, province: true, maxTravelDistanceKm: true },
    });
    if (!user) throw new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');
    const today = argentineDate(now);

    const [plans, routines] = await Promise.all([
      this.prisma.shoppingPlan.findMany({
        where: { userId },
        select: { id: true, status: true, startDate: true, endDate: true, generatedAt: true, estimatedSavings: true, baselineMethod: true },
      }),
      this.prisma.shoppingRoutine.findMany({ where: { userId }, include: { items: true } }),
    ]);
    const plansWithStatus = plans.map((plan) => ({
      id: plan.id,
      status: effectiveStatus(plan.status, toCalendarDate(plan.endDate), today),
      startDate: toCalendarDate(plan.startDate),
      endDate: toCalendarDate(plan.endDate),
      generatedAt: plan.generatedAt,
      estimatedSavings: plan.baselineMethod === 'NONE' ? null : toAmountString(plan.estimatedSavings, 2),
    }));
    const savings = summarizeSavings(plansWithStatus, today);

    // Plan a seguir: el activo; si no hay, el borrador vigente más nuevo.
    const byNewest = [...plansWithStatus].sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    const toFollow = byNewest.find((plan) => plan.status === 'ACTIVE') ?? byNewest.find((plan) => plan.status === 'DRAFT');

    const location: Location = user.latitude !== null && user.longitude !== null
      ? { latitude: Number(user.latitude.toString()), longitude: Number(user.longitude.toString()), radiusKm: Number(user.maxTravelDistanceKm.toString()) }
      : user.city && user.province
        ? { city: user.city, province: user.province }
        : null;

    return {
      today,
      nextPurchase: toFollow ? await this.nextPurchase(toFollow, today) : null,
      routines: {
        routineCount: routines.length,
        itemCount: routines.reduce((total, routine) => total + routine.items.length, 0),
      },
      savings: {
        estimated: {
          week: savings.week,
          month: savings.month,
          total: savings.total,
          plansWithoutBaseline: savings.plansWithoutBaseline,
          selection: 'ONE_PLAN_PER_PERIOD_ACTIVE_OR_COMPLETED',
        },
        registered: { available: false, message: REGISTERED_MESSAGE },
      },
      opportunities: await this.opportunities(routines.flatMap((routine) => routine.items), location, now),
    };
  }

  private async nextPurchase(
    plan: { id: string; status: string; startDate: string; endDate: string },
    today: string,
  ): Promise<NextPurchaseDto | null> {
    const items = await this.prisma.shoppingPlanItem.findMany({
      where: { shoppingPlanId: plan.id },
      select: { recommendedDate: true, storeId: true, price: true, snapshot: true },
      orderBy: [{ recommendedDate: 'asc' }, { storeId: 'asc' }, { id: 'asc' }],
    });
    if (!items.length) return null;
    const dates = [...new Set(items.map((item) => toCalendarDate(item.recommendedDate)))];
    const upcoming = dates.find((date) => date >= today);
    const date = upcoming ?? (dates[dates.length - 1] as string);
    const visits = new Map<string, { storeName: string; chainName: string; lineCount: number; subtotal: DecimalValue }>();
    for (const item of items.filter((entry) => toCalendarDate(entry.recommendedDate) === date)) {
      const details = item.snapshot as unknown as PlanItemSnapshot;
      const visit = visits.get(item.storeId) ?? { storeName: details.storeName, chainName: details.chainName, lineCount: 0, subtotal: DecimalValue.zero(2) };
      visit.lineCount += 1;
      visit.subtotal = visit.subtotal.add(DecimalValue.parse(toAmountString(item.price, 2)));
      visits.set(item.storeId, visit);
    }
    return {
      planId: plan.id,
      status: plan.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      startDate: plan.startDate,
      endDate: plan.endDate,
      date,
      dateHasPassed: upcoming === undefined,
      visits: [...visits.entries()].map(([storeId, visit]) => ({
        storeId,
        storeName: visit.storeName,
        chainName: visit.chainName,
        lineCount: visit.lineCount,
        subtotal: visit.subtotal.toFixed(2),
      })),
      remainingLines: items.filter((item) => toCalendarDate(item.recommendedDate) >= date).length,
    };
  }

  private async opportunities(
    items: readonly { canonicalProductId: string; allowSubstitutes: boolean; preferredProductId: string | null; excludedBrands: string[] }[],
    location: Location,
    now: Date,
  ): Promise<DashboardDto['opportunities']> {
    const none = (unavailableReason: DashboardDto['opportunities']['unavailableReason'], storesConsidered = 0) => ({
      items: [],
      unavailableReason,
      storesConsidered,
      seriesAnalyzed: 0,
    });
    if (!items.length) return none('NO_ROUTINES');
    if (!location) return none('NO_LOCATION');
    const scope = await this.storeScope.resolve(location);
    const storeIds = (scope.storeIds ?? []).slice(0, MAX_OPPORTUNITY_STORES);
    if (!storeIds.length) return none('NO_STORES_IN_SCOPE');

    // Las mismas reglas que el plan: sin reemplazos solo la presentación elegida; marcas excluidas afuera.
    const rules = new Map<string, { required: Set<string>; excluded: Set<string> }>();
    for (const item of items) {
      const rule = rules.get(item.canonicalProductId) ?? { required: new Set<string>(), excluded: new Set<string>() };
      if (!item.allowSubstitutes && item.preferredProductId) rule.required.add(item.preferredProductId);
      for (const brand of item.excludedBrands) rule.excluded.add(normalizeName(brand));
      rules.set(item.canonicalProductId, rule);
    }
    const catalog = await this.products.listByCanonicalProducts([...rules.keys()]);
    const allowed = catalog.filter((product) => {
      const rule = product.canonicalProductId ? rules.get(product.canonicalProductId) : undefined;
      if (!rule || !product.isActive) return false;
      if (rule.required.size && !rule.required.has(product.id)) return false;
      return !(product.brand && rule.excluded.has(normalizeName(product.brand)));
    });
    if (!allowed.length) return none(null, storeIds.length);

    const current = await this.currentPrices.analyze(allowed.map((product) => product.id), storeIds, now);
    if (!current.length) return none(null, storeIds.length);
    const productsById = new Map(allowed.map((product) => [product.id, product]));
    const canonicalNames = new Map(
      (await this.prisma.canonicalProduct.findMany({ where: { id: { in: [...rules.keys()] } }, select: { id: true, name: true } }))
        .map((canonical) => [canonical.id, canonical.name]),
    );
    const analyzed: AnalyzedSeries<PriceObservationRecord>[] = current.map(({ latest, analysis }) => ({
      canonicalName: canonicalNames.get(productsById.get(latest.productId)?.canonicalProductId ?? '') ?? '',
      productId: latest.productId,
      storeId: latest.storeId,
      analysis,
      payload: latest,
    }));

    const ranked = rankOpportunities(analyzed);
    const storesById = new Map((await this.stores.findManyByIds([...new Set(ranked.map((entry) => entry.storeId))])).map((store) => [store.id, store]));
    const result: OpportunityDto[] = [];
    for (const entry of ranked) {
      const product = productsById.get(entry.productId);
      const store = storesById.get(entry.storeId);
      if (!product || !store || !product.canonicalProductId) continue;
      result.push({
        canonicalProductId: product.canonicalProductId,
        canonicalName: entry.canonicalName,
        productId: product.id,
        productName: product.name,
        brand: product.brand,
        store: { id: store.id, name: store.name, chainName: store.chainName, distanceMeters: scope.distances.get(store.id) ?? null },
        classification: entry.analysis.classification as OpportunityDto['classification'],
        price: entry.payload.price,
        unitPrice: entry.payload.unitPrice,
        unitPriceUnit: entry.payload.unitPriceUnit,
        observedAt: entry.payload.observedAt.toISOString(),
        average: entry.analysis.average as string,
        lowest: entry.analysis.lowest as string,
        ratioToAverage: entry.analysis.ratioToAverage as string,
      });
    }
    return { items: result, unavailableReason: null, storesConsidered: storeIds.length, seriesAnalyzed: analyzed.length };
  }
}
