/**
 * Contrato del resultado del optimizador (P5-02, ADR 0004 y 0014). Importes en ARS
 * como texto decimal con dos decimales; distancias en km con tres. Separa lo que
 * se paga (productos) de las penalidades de conveniencia (visitas y distancia),
 * que son preferencias monetizadas y no gasto real.
 */
import type { CalendarDate } from '../../routines/domain/routine-rules';
import type { BaseUnit } from '../../catalog/domain/units';
import type { BenefitConditions } from '../../promotions/domain/benefit-conditions';
import type { BenefitReason, CapStatus } from '../../promotions/domain/benefit-engine';
import type { PayerProfile } from '../../promotions/domain/payer-eligibility';
import type { BenefitTiming } from '../../promotions/domain/promotion.types';
import type {
  CandidatePriceBasis,
  CandidatePurchase,
  MatchType,
  NeedInventory,
  PlanLocationOrigin,
  UnresolvedReason,
} from './planner.types';

/**
 * Cambia cuando cambia el algoritmo o su contrato: P5-03 lo guarda en cada plan.
 * `2026-10-01.1` (P10-02): canastas por visita con el motor de beneficios (ADR 0024).
 */
export const OPTIMIZER_VERSION = 'planner-2026-10-01.1';

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
  | 'PROMOTION_APPLIED'
  /** P10-02: había una línea más barata en otra visita, pero acá suma al beneficio de la compra. */
  | 'BASKET_BENEFIT_CHOICE';

export type { BenefitConditions };

/** Beneficio de pago aplicado a una visita (una compra). */
export interface PlanVisitPayment {
  readonly promotionId: string;
  readonly name: string;
  readonly timing: BenefitTiming;
  readonly refundDelayDays: number | null;
  /** Lo que entró en la base del beneficio (sin lo no acumulable). */
  readonly base: string;
  readonly amount: string;
  readonly conditions: BenefitConditions;
  readonly cap: CapStatus | null;
}

/**
 * Un beneficio que existe en la visita y no se sumó: condicionado (falta un dato de la
 * persona), no elegible (con el motivo) o no elegido (se usa otro, un solo pago por compra).
 */
export interface PlanBenefitNote {
  readonly promotionId: string;
  readonly name: string;
  readonly layer: 'PRODUCT' | 'PAYMENT';
  /** Necesidad de la línea en la capa de producto; null en un beneficio de pago. */
  readonly canonicalProductId: string | null;
  readonly status: 'CONDITIONAL' | 'NOT_ELIGIBLE' | 'NOT_CHOSEN';
  readonly reason: BenefitReason | null;
  /** Importe posible (condicionado o no elegido); null si no corresponde. */
  readonly amount: string | null;
  readonly conditions: BenefitConditions;
  readonly cap: CapStatus | null;
}

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
  /** Líneas con sus promociones de producto, antes del beneficio de pago. */
  readonly subtotal: string;
  /** P10-02: descuento de pago en caja de esta compra. */
  readonly paymentDiscount: string;
  /** Lo que se paga en la caja: `subtotal − paymentDiscount`. */
  readonly payToday: string;
  /** Reintegro posterior estimado: no baja lo que se paga hoy. */
  readonly refundEstimated: string;
  readonly payment: PlanVisitPayment | null;
  readonly benefitNotes: readonly PlanBenefitNote[];
}

export interface PlanTotals {
  /** Lo que se estima pagar por los productos, con promociones de producto. */
  readonly productCost: string;
  /** Los mismos productos sin promociones. */
  readonly regularProductCost: string;
  readonly promotionDiscount: string;
  /** P10-02: descuentos de pago en caja (confirmados con lo declarado). */
  readonly paymentDiscount: string;
  /** `productCost − paymentDiscount`: lo que se paga en las cajas. */
  readonly payToday: string;
  /** Reintegros estimados (aplicados con tope conocido): llegan después y no son ahorro. */
  readonly refundEstimated: string;
  /** `payToday − refundEstimated`. */
  readonly costAfterRefund: string;
  /** Beneficios posibles que dependen de un dato no informado: no sumados en ningún total. */
  readonly conditionalAmount: string;
  readonly visitCount: number;
  readonly storeCount: number;
  readonly storeVisitPenaltyCost: string;
  readonly distancePenaltyCost: string;
  /** `payToday + storeVisitPenaltyCost + distancePenaltyCost`. */
  readonly effectiveCost: string;
  /** `costAfterRefund + penalidades`: decide la recomendación. Sin reintegros es `effectiveCost`. */
  readonly effectiveCostAfterRefund: string;
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
  /**
   * `base.productCost − plan.payToday`: dinero de productos que no se paga en la caja, con
   * promociones y descuentos de pago confirmados. **Nunca incluye reintegros**. Puede ser negativo.
   */
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
  /** Sin evaluación por canasta (cálculo por líneas): mínimos y pagos quedan afuera. */
  | 'MINIMUM_SPEND_NOT_EVALUATED'
  | 'PAYMENT_PROMOTIONS_EXCLUDED'
  /** P10-02: hay beneficios que dependen de datos no informados; no se suman. */
  | 'BENEFITS_CONDITIONAL'
  /** P10-02: el plan incluye reintegros: hoy se paga más y el reintegro llega después. */
  | 'REFUND_PENDING'
  /** P10-02: la canasta con beneficios se buscó con el método aproximado. */
  | 'BASKET_BENEFITS_APPROXIMATED';

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
  /**
   * P10-02: cómo se buscó la canasta con beneficios. `NOT_NEEDED`: ninguna regla cambia el
   * costo de la suma de líneas; `EXHAUSTIVE`: todas las asignaciones; `LOCAL_SEARCH`: aproximado.
   * Null sin evaluación de beneficios.
   */
  readonly basketSearch: 'NOT_NEEDED' | 'EXHAUSTIVE' | 'LOCAL_SEARCH' | null;
  readonly basketEvaluations: number;
  readonly maxBasketEvaluations: number | null;
}

/** Con qué se evaluaron los beneficios del plan. */
export interface PlanBenefitsSummary {
  /** Solo lo declarado: nunca datos de tarjeta. */
  readonly payer: PayerProfile & { readonly declared: boolean };
  /** Topes tocados por el plan: límite, lo informado como usado afuera y lo que usa el plan. */
  readonly caps: readonly {
    readonly key: string;
    readonly periodKey: string;
    readonly limit: string;
    readonly consumedOutside: string | null;
    readonly usedHere: string;
  }[];
  /** Criterios usados, en castellano, para mostrar tal cual. */
  readonly criteria: readonly string[];
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
  /** Null cuando el cálculo no recibió preferencias ni reglas de pago (solo líneas). */
  readonly benefits: PlanBenefitsSummary | null;
}
