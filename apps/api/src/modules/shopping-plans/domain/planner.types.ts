/**
 * Contratos del cálculo de necesidades y candidatos (P5-01). Puros: sin Prisma ni
 * Nest. Cantidades e importes como texto decimal; fechas de calendario
 * `AAAA-MM-DD` en Argentina; instantes como `Date` en la entrada e ISO en la salida.
 *
 * La salida es trazable: cada necesidad dice de qué ítems salió y cuánto restó la
 * despensa, cada oferta qué observación de precio usa y cada descarte su motivo.
 * P5-02 optimiza sobre `candidates` y P5-03 la guarda como snapshot.
 */
import type { ProductRecord } from '../../catalog/domain/catalog-records';
import type { BaseUnit, SaleMode } from '../../catalog/domain/units';
import type { CurrentPriceRecord } from '../../prices/domain/price-records';
import type { PromotionRule, PromotionSkipReason } from '../../promotions/domain/promotion.types';
import type { CalendarDate } from '../../routines/domain/routine-rules';
import type { PlanWindow } from './plan-calendar';

/** Versión del formato: P5-03 la guarda junto al snapshot. */
export const PLAN_CANDIDATES_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- necesidades

export interface PlanRoutineItemInput {
  readonly id: string;
  readonly routineId: string;
  readonly routineName: string;
  readonly canonicalProductId: string;
  /** Necesidad por ocurrencia, en la unidad del canónico (P4-01 ya la normalizó). */
  readonly quantity: string;
  readonly unit: BaseUnit;
  readonly frequencyDays: number;
  readonly anchorDate: CalendarDate;
  /** `true` si usa la frecuencia de su rutina. */
  readonly inheritedSchedule: boolean;
  readonly allowSubstitutes: boolean;
  readonly preferredProductId: string | null;
  readonly preferredBrands: readonly string[];
  readonly excludedBrands: readonly string[];
}

export interface PlanInventoryInput {
  readonly canonicalProductId: string;
  readonly quantity: string;
  readonly unit: BaseUnit;
  readonly updatedAt: Date;
}

export interface PlanCanonicalInput {
  readonly id: string;
  readonly name: string;
  readonly defaultUnit: BaseUnit;
}

export interface NeedsInput {
  readonly window: PlanWindow;
  readonly items: readonly PlanRoutineItemInput[];
  readonly inventory: readonly PlanInventoryInput[];
  readonly canonicals: readonly PlanCanonicalInput[];
  readonly now: Date;
}

/** Un ítem de rutina que aporta a la necesidad y cuánto aporta en la ventana. */
export interface NeedSource {
  readonly routineId: string;
  readonly routineName: string;
  readonly routineItemId: string;
  readonly quantityPerOccurrence: string;
  readonly frequencyDays: number;
  readonly anchorDate: CalendarDate;
  readonly inheritedSchedule: boolean;
  readonly occurrences: readonly CalendarDate[];
  /** `quantityPerOccurrence × occurrences.length`. */
  readonly quantity: string;
}

export interface NeedInventory {
  readonly quantity: string;
  readonly unit: BaseUnit;
  readonly updatedAt: string;
  /** Días completos desde la última actualización: el saldo es aproximado. */
  readonly ageDays: number;
  /** `false` si la unidad no coincide con la del canónico: no se resta nada. */
  readonly applied: boolean;
  /** Lo que efectivamente se restó: `min(saldo, necesidad bruta)` o cero. */
  readonly subtracted: string;
}

/** Restricciones combinadas de todos los ítems del mismo canónico. */
export interface NeedConstraints {
  /** `false` si algún ítem no acepta reemplazos. */
  readonly allowSubstitutes: boolean;
  /** Presentación obligatoria cuando algún ítem no acepta reemplazos. */
  readonly requiredProductId: string | null;
  /** Presentaciones preferidas de los ítems que sí aceptan reemplazos. */
  readonly preferredProductIds: readonly string[];
  /** Preferencias: desempatan y se conservan en el recorte, no excluyen. */
  readonly preferredBrands: readonly string[];
  /** Restricciones: la unión de las marcas excluidas de todos los ítems. */
  readonly excludedBrands: readonly string[];
}

export type NeedStatus = 'TO_BUY' | 'COVERED_BY_INVENTORY' | 'CONFLICT';

export interface PlanNeed {
  readonly canonicalProductId: string;
  readonly canonicalName: string;
  readonly unit: BaseUnit;
  /** Suma de todas las ocurrencias de todos los ítems, antes de la despensa. */
  readonly grossQuantity: string;
  /** `max(0, bruta − despensa)`: la despensa se resta una sola vez por canónico. */
  readonly netQuantity: string;
  readonly firstOccurrence: CalendarDate;
  readonly inventory: NeedInventory | null;
  readonly constraints: NeedConstraints;
  readonly sources: readonly NeedSource[];
  readonly status: NeedStatus;
}

export type SkippedItemReason = 'NO_OCCURRENCES_IN_WINDOW' | 'UNIT_MISMATCH' | 'CANONICAL_NOT_FOUND';

export interface SkippedRoutineItem {
  readonly routineId: string;
  readonly routineItemId: string;
  readonly canonicalProductId: string;
  readonly reason: SkippedItemReason;
}

export interface NeedsResult {
  readonly needs: readonly PlanNeed[];
  readonly skippedItems: readonly SkippedRoutineItem[];
}

// ----------------------------------------------------------------- candidatos

/**
 * `COORDINATES`: radio real con PostGIS y distancias. `LOCALITY`: sucursales de la
 * ciudad, sin radio ni distancia garantizados. `NONE`: sin ubicación, sin sucursales.
 */
export type PlanLocationOrigin = 'COORDINATES' | 'LOCALITY' | 'NONE';

export interface PlanLocationScope {
  readonly origin: PlanLocationOrigin;
  readonly radiusKm: number | null;
  readonly city: string | null;
  readonly province: string | null;
}

export interface CandidateLimits {
  /** Sucursales que pasan al optimizador. */
  readonly maxStores: number;
  /** Ofertas más baratas por necesidad y sucursal (más la preferida si quedó afuera). */
  readonly maxOffersPerStore: number;
  /** Fechas de compra evaluadas: las primeras de la ventana. */
  readonly maxDates: number;
}

export interface CandidateStoreInput {
  readonly id: string;
  readonly name: string;
  readonly chainId: string;
  readonly chainName: string;
  readonly city: string;
  readonly province: string;
  /** Solo con coordenadas del usuario y de la sucursal; nunca se inventa 0 km. */
  readonly distanceMeters: number | null;
}

export interface CandidatesInput {
  readonly needs: readonly PlanNeed[];
  /** Todas las presentaciones de los canónicos, activas o no: lo inactivo se informa. */
  readonly products: readonly ProductRecord[];
  readonly stores: readonly CandidateStoreInput[];
  readonly prices: readonly CurrentPriceRecord[];
  readonly promotions: readonly PromotionRule[];
  readonly dates: readonly CalendarDate[];
  readonly scope: PlanLocationScope;
  readonly limits: CandidateLimits;
  readonly now: Date;
  readonly maxAgeDays: number;
}

export type MatchType = 'EXACT' | 'ALTERNATIVE';

export interface CandidatePurchase {
  readonly saleMode: SaleMode;
  /** Envases enteros (envasado) o bases de cotización (venta por peso). */
  readonly units: string;
  /** Contenido de un envase o base de cotización, en la unidad del canónico. */
  readonly unitContent: string;
  readonly purchasedQuantity: string;
  /** Lo que sobra respecto de la necesidad neta; se muestra, no se oculta. */
  readonly surplus: string;
  /** Venta por peso: el peso final se conoce recién en la caja. */
  readonly quantityIsEstimate: boolean;
}

/** Precio observado usado como estimación: no es un precio futuro garantizado. */
export interface CandidatePriceBasis {
  readonly basis: 'LATEST_OBSERVATION';
  readonly observationId: string;
  readonly price: string;
  readonly unitPrice: string;
  readonly unitPriceUnit: BaseUnit;
  readonly currency: string;
  readonly source: string;
  readonly observedAt: string;
  readonly ageDays: number;
}

export interface CandidatePromotionCheck {
  readonly promotionId: string;
  readonly name: string;
  readonly applied: boolean;
  readonly skipReason: PromotionSkipReason | null;
}

/** Costo de la línea si se compra en esa fecha (vigencia y día de la promoción). */
export interface CandidateDateOption {
  readonly date: CalendarDate;
  readonly total: string;
  readonly discount: string;
  readonly appliedPromotionId: string | null;
  readonly promotions: readonly CandidatePromotionCheck[];
}

export interface CandidateOffer {
  /** `productId:storeId`: estable entre ejecuciones. */
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly brand: string | null;
  readonly storeId: string;
  readonly storeName: string;
  readonly chainId: string;
  readonly chainName: string;
  readonly distanceMeters: number | null;
  readonly matchType: MatchType;
  readonly preferredBrand: boolean;
  readonly purchase: CandidatePurchase;
  readonly priceBasis: CandidatePriceBasis;
  /** Sin promociones: envases × precio observado. */
  readonly regularTotal: string;
  /** El menor total entre las fechas evaluadas y las fechas que lo consiguen. */
  readonly bestTotal: string;
  readonly bestDates: readonly CalendarDate[];
  readonly dateOptions: readonly CandidateDateOption[];
}

export type CandidateExclusionReason =
  | 'UNIT_MISMATCH'
  | 'PRODUCT_INACTIVE'
  | 'SUBSTITUTION_NOT_ALLOWED'
  | 'BRAND_EXCLUDED'
  | 'NO_PRICE_IN_SCOPE'
  | 'PRICE_STALE'
  | 'STORE_LIMIT'
  | 'OFFER_LIMIT';

/** Un descarte con su motivo. `storeId` es null cuando se descarta la presentación entera. */
export interface CandidateExclusion {
  readonly productId: string;
  readonly storeId: string | null;
  readonly reason: CandidateExclusionReason;
  /** Antigüedad del precio descartado por viejo. */
  readonly ageDays?: number;
}

export type UnresolvedReason =
  | 'NO_LOCATION'
  | 'NO_STORES_IN_SCOPE'
  | 'CONFLICTING_EXACT_PRODUCTS'
  | 'PREFERRED_PRODUCT_UNAVAILABLE'
  | 'NO_ELIGIBLE_PRODUCT'
  | 'NO_PRICE_IN_SCOPE'
  | 'ONLY_STALE_PRICES'
  | 'ONLY_IN_TRIMMED_STORES';

export interface NeedCandidates {
  readonly canonicalProductId: string;
  readonly offers: readonly CandidateOffer[];
  readonly exclusions: readonly CandidateExclusion[];
  /** Por qué la necesidad quedó sin ninguna oferta; null si tiene al menos una. */
  readonly unresolvedReason: UnresolvedReason | null;
}

export interface CandidateStoreSummary extends CandidateStoreInput {
  /** Necesidades que la sucursal puede cubrir con al menos una oferta. */
  readonly coverage: number;
  /** Suma de la oferta más barata de cada necesidad cubierta: solo ordena el recorte. */
  readonly cheapestCoveredTotal: string;
}

export type PlanWarningCode =
  | 'LOCATION_MISSING'
  | 'LOCATION_APPROXIMATE'
  | 'STORES_TRIMMED'
  | 'DATES_TRIMMED'
  | 'INVENTORY_UNIT_MISMATCH';

export interface PlanWarning {
  readonly code: PlanWarningCode;
  readonly message: string;
}

export interface CandidatesResult {
  readonly dates: { readonly evaluated: readonly CalendarDate[]; readonly trimmed: readonly CalendarDate[] };
  readonly stores: {
    readonly kept: readonly CandidateStoreSummary[];
    readonly trimmed: readonly CandidateStoreSummary[];
  };
  readonly needs: readonly NeedCandidates[];
  readonly warnings: readonly PlanWarning[];
}

// ------------------------------------------------------------------ resultado

/** Entrada y salida completas del paso: lo que P5-02 optimiza y P5-03 guarda. */
export interface PlanCandidates {
  readonly schemaVersion: typeof PLAN_CANDIDATES_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly window: PlanWindow;
  readonly scope: PlanLocationScope;
  readonly limits: CandidateLimits;
  readonly maxAgeDays: number;
  readonly needs: readonly PlanNeed[];
  readonly skippedItems: readonly SkippedRoutineItem[];
  readonly candidates: CandidatesResult;
}
