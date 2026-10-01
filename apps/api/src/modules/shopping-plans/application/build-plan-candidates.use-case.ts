import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { rethrowRuleErrors } from '../../../common/rule-errors';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { PrismaService } from '../../../database/prisma.service';
import { toQuantityString } from '../../catalog/infrastructure/decimal-mapper';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { ProductPriceRepository } from '../../prices/infrastructure/product-price.repository';
import type { PromotionRule } from '../../promotions/domain/promotion.types';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import { argentineToday } from '../../routines/domain/routine-rules';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { buildCandidates } from '../domain/candidates';
import { buildNeeds } from '../domain/needs';
import { argentineNoon, resolvePlanWindow } from '../domain/plan-calendar';
import type { PlanWindow } from '../domain/plan-calendar';
import { PlanningRuleError } from '../domain/planning-errors';
import { PLAN_CANDIDATES_SCHEMA_VERSION } from '../domain/planner.types';
import type {
  CandidateLimits,
  CandidateStoreInput,
  PlanCandidates,
  PlanLocationScope,
  PlanRoutineItemInput,
} from '../domain/planner.types';

export interface PlanCandidatesQuery {
  /** `AAAA-MM-DD`; por defecto, hoy en Argentina. */
  readonly startDate?: string;
  /** `AAAA-MM-DD` inclusive; por defecto, una semana. */
  readonly endDate?: string;
  /** Momento de referencia: frescura de precios, antigüedad de la despensa y "hoy". */
  readonly now?: Date;
}

export interface PlanCandidatesWithPromotions {
  readonly candidates: PlanCandidates;
  readonly promotions: readonly PromotionRule[];
}

interface ResolvedLocation {
  readonly scope: PlanLocationScope;
  readonly storeIds: readonly string[];
  readonly distances: ReadonlyMap<string, number>;
}

/** Columna `date`: Prisma la entrega como medianoche UTC. */
const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);
const asRuleError = rethrowRuleErrors([PlanningRuleError]);

/**
 * Necesidades y candidatos de compra de un usuario (P5-01). Carga lo mínimo con
 * el filtro de dueño en cada consulta y delega el cálculo en el dominio puro
 * (`buildNeeds` y `buildCandidates`). No guarda nada ni descuenta la despensa:
 * P5-02 optimiza sobre el resultado y P5-03 lo persiste.
 */
@Injectable()
export class BuildPlanCandidatesUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductRepository,
    private readonly prices: ProductPriceRepository,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    private readonly promotions: PromotionRepository,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(userId: string, query: PlanCandidatesQuery = {}): Promise<PlanCandidates> {
    return (await this.executeWithPromotions(userId, query)).candidates;
  }

  /**
   * Candidatos y las promociones vigentes que los alcanzan (P10-02): el planificador las vuelve
   * a evaluar por canasta, con las preferencias de pago de la persona.
   */
  async executeWithPromotions(userId: string, query: PlanCandidatesQuery = {}): Promise<PlanCandidatesWithPromotions> {
    const now = query.now ?? new Date();
    const window = this.resolveWindow(query, now);
    const limits: CandidateLimits = {
      maxStores: this.config.planner.maxCandidateStores,
      maxOffersPerStore: this.config.planner.maxOffersPerStore,
      maxDates: this.config.planner.maxCandidateDates,
    };
    const maxAgeDays = this.config.prices.maxAgeDays;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { latitude: true, longitude: true, city: true, province: true, maxTravelDistanceKm: true },
    });
    // Token válido de una cuenta que ya no existe: se trata como sesión inválida.
    if (!user) throw new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');

    const [routines, inventory] = await Promise.all([
      this.prisma.shoppingRoutine.findMany({
        where: { userId },
        include: { items: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.userInventory.findMany({ where: { userId } }),
    ]);
    const items: PlanRoutineItemInput[] = routines.flatMap((routine) =>
      routine.items.map((item) => {
        const own = item.frequencyDays !== null && item.anchorDate !== null;
        return {
          id: item.id,
          routineId: routine.id,
          routineName: routine.name,
          canonicalProductId: item.canonicalProductId,
          quantity: toQuantityString(item.quantity),
          unit: item.unit,
          frequencyDays: own ? (item.frequencyDays as number) : routine.frequencyDays,
          anchorDate: toCalendarDate(own ? (item.anchorDate as Date) : routine.anchorDate),
          inheritedSchedule: !own,
          allowSubstitutes: item.allowSubstitutes,
          preferredProductId: item.preferredProductId,
          preferredBrands: item.preferredBrands,
          excludedBrands: item.excludedBrands,
        };
      }),
    );
    const canonicals = items.length
      ? await this.prisma.canonicalProduct.findMany({
          where: { id: { in: [...new Set(items.map((item) => item.canonicalProductId))] } },
          select: { id: true, name: true, defaultUnit: true },
        })
      : [];

    const needs = buildNeeds({
      window,
      items,
      inventory: inventory.map((row) => ({
        canonicalProductId: row.canonicalProductId,
        quantity: toQuantityString(row.quantity),
        unit: row.unit,
        updatedAt: row.updatedAt,
      })),
      canonicals,
      now,
    });

    const location = await this.resolveLocation(user);
    const toBuy = needs.needs.filter((need) => need.status === 'TO_BUY');
    const canonicalIds = toBuy.map((need) => need.canonicalProductId);
    const products = canonicalIds.length ? await this.products.listByCanonicalProducts(canonicalIds) : [];
    const activeProductIds = products.filter((product) => product.isActive).map((product) => product.id);

    const storeRecords = location.storeIds.length ? await this.stores.findManyByIds(location.storeIds) : [];
    const stores: CandidateStoreInput[] = storeRecords
      .filter((store) => store.isActive)
      .map((store) => ({
        id: store.id,
        name: store.name,
        chainId: store.chainId,
        chainName: store.chainName,
        city: store.city,
        province: store.province,
        distanceMeters: location.distances.get(store.id) ?? null,
      }));
    const storeIds = stores.map((store) => store.id);

    // Sin sucursales no se consulta: una lista vacía de sucursales significa "todas" en el repositorio.
    const prices = storeIds.length && activeProductIds.length
      ? await this.prices.findCurrentByProducts(activeProductIds, {
          storeIds,
          sourcePrecedence: this.config.prices.sourcePrecedence,
        })
      : [];
    const evaluatedDates = window.dates.slice(0, limits.maxDates);
    const promotions = prices.length
      ? await this.promotions.findActiveBetween({
          from: argentineNoon(evaluatedDates[0] as string),
          until: argentineNoon(evaluatedDates[evaluatedDates.length - 1] as string),
          storeIds,
          chainIds: [...new Set(stores.map((store) => store.chainId))],
          productIds: activeProductIds,
          canonicalProductIds: canonicalIds,
        })
      : [];

    const candidates = buildCandidates({
      needs: needs.needs,
      products,
      stores,
      prices,
      promotions,
      dates: window.dates,
      scope: location.scope,
      limits,
      now,
      maxAgeDays,
    });

    const result: PlanCandidates = {
      schemaVersion: PLAN_CANDIDATES_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      window,
      scope: location.scope,
      limits,
      maxAgeDays,
      needs: needs.needs,
      skippedItems: needs.skippedItems,
      candidates,
    };
    return { candidates: result, promotions };
  }

  private resolveWindow(query: PlanCandidatesQuery, now: Date): PlanWindow {
    try {
      return resolvePlanWindow(
        { startDate: query.startDate ?? argentineToday(now), endDate: query.endDate },
        this.config.planner.maxHorizonDays,
      );
    } catch (error: unknown) {
      return asRuleError(error);
    }
  }

  /**
   * Coordenadas → radio real con PostGIS; solo localidad → sucursales de la ciudad
   * sin distancia; nada → sin sucursales. Nunca se buscan "todas" las sucursales:
   * un plan con comercios de cualquier lugar del país no se puede cumplir.
   */
  private async resolveLocation(user: {
    latitude: { toString(): string } | null;
    longitude: { toString(): string } | null;
    city: string | null;
    province: string | null;
    maxTravelDistanceKm: { toString(): string };
  }): Promise<ResolvedLocation> {
    const base = { city: user.city, province: user.province };
    if (user.latitude !== null && user.longitude !== null) {
      const radiusKm = Number(user.maxTravelDistanceKm.toString());
      const resolved = await this.storeScope.resolve({
        latitude: Number(user.latitude.toString()),
        longitude: Number(user.longitude.toString()),
        radiusKm,
      });
      return {
        scope: { origin: 'COORDINATES', radiusKm, ...base },
        storeIds: resolved.storeIds ?? [],
        distances: resolved.distances,
      };
    }
    if (user.city && user.province) {
      const resolved = await this.storeScope.resolve({ city: user.city, province: user.province });
      return {
        scope: { origin: 'LOCALITY', radiusKm: null, ...base },
        storeIds: resolved.storeIds ?? [],
        distances: new Map(),
      };
    }
    return { scope: { origin: 'NONE', radiusKm: null, ...base }, storeIds: [], distances: new Map() };
  }
}
