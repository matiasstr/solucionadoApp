/**
 * Contrato del resultado del optimizador (P5-02, ADR 0004 y 0014). Importes en ARS
 * como texto decimal con dos decimales; distancias en km con tres. Separa lo que
 * se paga (productos) de las penalidades de conveniencia (visitas y distancia),
 * que son preferencias monetizadas y no gasto real.
 */
import type { CalendarDate } from '../../routines/domain/routine-rules';
import type { BaseUnit } from '../../catalog/domain/units';
import type {
  CandidatePriceBasis,
  CandidatePurchase,
  MatchType,
  NeedInventory,
  PlanLocationOrigin,
  UnresolvedReason,
} from './planner.types';

/** Cambia cuando cambia el algoritmo o su contrato: P5-03 lo guarda en cada plan. */
export const OPTIMIZER_VERSION = 'planner-2026-09-29.1';

export interface OptimizerSettings {
  /** ARS por visita (sucursal y fecha). */
  readonly storeVisitPenalty: string;
  /** ARS por km de ida y vuelta desde la ubicación del usuario. */
  readonly distancePenaltyPerKm: string;
  /** Máximo de sucursales distintas del usuario; null = sin límite propio. */
  readonly maxStores: number | null;
  /** Presupuesto de combinaciones evaluadas antes de pasar al método aproximado. */
  readonly maxCombinations: number;
}

/**
 * `EXACT_BOUNDED`: óptimo exacto **entre los candidatos acotados**, no entre todas
 * las sucursales del país. `HEURISTIC`: el espacio superó el presupuesto y se usó
 * un método aproximado que respeta las mismas restricciones. `NO_CANDIDATES`: no
 * había nada que optimizar.
 */
export type OptimizationMethod = 'EXACT_BOUNDED' | 'HEURISTIC' | 'NO_CANDIDATES';

/** `EMPTY`: no hay nada que comprar. `PARTIAL`: quedaron necesidades sin cubrir. */
export type PlanCoverage = 'COMPLETE' | 'PARTIAL' | 'EMPTY';

export type LineReasonCode =
  | 'CHEAPEST_EVALUATED'
  | 'CHEAPER_OPTION_NOT_WORTH_IT'
  | 'EXACT_PRODUCT_REQUIRED'
  | 'PREFERRED_PRODUCT'
  | 'PROMOTION_APPLIED';

export interface LineAlternative {
  readonly offerId: string;
  readonly productName: string;
  readonly storeName: string;
  readonly date: CalendarDate;
  readonly total: string;
  /** `alternativa − elegida`: negativo si la alternativa era más barata en productos. */
  readonly difference: string;
}

export interface PlanLine {
  readonly canonicalProductId: string;
  readonly canonicalName: string;
  /** Necesidad neta que cubre esta línea, en la unidad del canónico. */
  readonly neededQuantity: string;
  readonly unit: BaseUnit;
  readonly offerId: string;
  readonly productId: string;
  readonly productName: string;
  readonly brand: string | null;
  readonly storeId: string;
  readonly storeName: string;
  readonly chainName: string;
  readonly date: CalendarDate;
  readonly matchType: MatchType;
  readonly purchase: CandidatePurchase;
  readonly priceBasis: CandidatePriceBasis;
  /** Total de la línea sin promoción. */
  readonly regularTotal: string;
  /** Total de la línea con la promoción de esa fecha, si hay. */
  readonly total: string;
  readonly discount: string;
  readonly promotion: { readonly id: string; readonly name: string } | null;
  readonly reasonCodes: readonly LineReasonCode[];
  /** Explicación en castellano para mostrar tal cual. */
  readonly reason: string;
  readonly alternatives: readonly LineAlternative[];
}

export interface PlanVisit {
  readonly storeId: string;
  readonly storeName: string;
  readonly chainName: string;
  readonly date: CalendarDate;
  /** Distancia desde la ubicación del usuario; null si no se puede medir. */
  readonly distanceMeters: number | null;
  /** Ida y vuelta estimada, no una ruta vial. */
  readonly roundTripKm: string | null;
  readonly lineCount: number;
  readonly subtotal: string;
}

export interface PlanTotals {
  /** Lo que se estima pagar por los productos, con promociones. */
  readonly productCost: string;
  /** Los mismos productos sin promociones. */
  readonly regularProductCost: string;
  readonly promotionDiscount: string;
  readonly visitCount: number;
  readonly storeCount: number;
  readonly storeVisitPenaltyCost: string;
  readonly distancePenaltyCost: string;
  /** `productCost + storeVisitPenaltyCost + distancePenaltyCost`: decide la recomendación. */
  readonly effectiveCost: string;
  /** Suma de ida y vuelta de cada visita; null si alguna distancia se desconoce. */
  readonly totalDistanceKm: string | null;
}

export type BaselineMethod = 'SINGLE_STORE_REGULAR_PRICES';

export interface BaselineLine {
  readonly canonicalProductId: string;
  readonly offerId: string;
  readonly observationId: string;
  readonly regularTotal: string;
}

/**
 * Base habitual (ADR 0004): las **mismas** necesidades del plan compradas en una
 * sola sucursal a precio regular. Se elige la más barata con cobertura completa:
 * así el ahorro informado es el más prudente.
 */
export interface PlanBaseline {
  readonly method: BaselineMethod;
  readonly storeId: string;
  readonly storeName: string;
  readonly productCost: string;
  readonly storeVisitPenaltyCost: string;
  readonly distancePenaltyCost: string;
  readonly effectiveCost: string;
  readonly lines: readonly BaselineLine[];
}

export type BaselineUnavailableReason = 'NOTHING_TO_BUY' | 'NO_SINGLE_STORE_COVERS_PLAN';

export interface PlanSavings {
  /** `base.productCost − plan.productCost`: solo dinero de productos, puede ser negativo. */
  readonly estimatedSavings: string;
  /** Diferencia de costo efectivo (incluye penalidades): no es dinero ahorrado. */
  readonly effectiveCostDifference: string;
}

export type UnfulfilledReason = UnresolvedReason | 'MAX_STORES_LIMIT';

export interface UnfulfilledNeed {
  readonly canonicalProductId: string;
  readonly canonicalName: string;
  readonly netQuantity: string;
  readonly unit: BaseUnit;
  readonly reason: UnfulfilledReason;
}

export interface CoveredByInventory {
  readonly canonicalProductId: string;
  readonly canonicalName: string;
  readonly grossQuantity: string;
  readonly unit: BaseUnit;
  readonly inventory: NeedInventory | null;
}

export type PlanLimitationCode =
  | 'PRICES_ARE_ESTIMATES'
  | 'DISTANCE_IS_ESTIMATE'
  | 'DISTANCE_UNKNOWN'
  | 'CANDIDATES_TRIMMED'
  | 'SEARCH_BUDGET_EXCEEDED'
  | 'PARTIAL_PLAN'
  | 'NO_BASELINE'
  | 'MINIMUM_SPEND_NOT_EVALUATED'
  | 'PAYMENT_PROMOTIONS_EXCLUDED';

export interface PlanLimitation {
  readonly code: PlanLimitationCode;
  readonly message: string;
}

export interface SearchSummary {
  readonly method: OptimizationMethod;
  /** Combinaciones que habría evaluado la búsqueda exacta. */
  readonly exactCombinations: number;
  readonly evaluatedCombinations: number;
  readonly maxCombinations: number;
  readonly storesConsidered: number;
  /** Fechas útiles por sucursal tras descartar las dominadas (igual o peor en todo). */
  readonly datesPerStore: Readonly<Record<string, readonly CalendarDate[]>>;
}

export interface OptimizedPlan {
  readonly optimizerVersion: typeof OPTIMIZER_VERSION;
  readonly coverage: PlanCoverage;
  readonly settings: OptimizerSettings;
  readonly locationOrigin: PlanLocationOrigin;
  readonly search: SearchSummary;
  readonly lines: readonly PlanLine[];
  readonly visits: readonly PlanVisit[];
  readonly totals: PlanTotals;
  readonly baseline: PlanBaseline | null;
  readonly baselineUnavailableReason: BaselineUnavailableReason | null;
  /** Null si no hay base comparable: sin comparación válida no se muestra ahorro. */
  readonly savings: PlanSavings | null;
  readonly unfulfilled: readonly UnfulfilledNeed[];
  readonly coveredByInventory: readonly CoveredByInventory[];
  readonly limitations: readonly PlanLimitation[];
}
