/**
 * Qué se guarda de un plan (P5-03, ADR 0015). Función pura: traduce el cálculo
 * (`PlanCandidates` + `OptimizedPlan`) a columnas y snapshots JSON versionados.
 *
 * El plan emitido no depende del catálogo vivo: nombres, presentación, precio,
 * fuente, fecha observada y promoción viajan en el snapshot de cada línea, así
 * un precio nuevo o una rutina editada no reescriben un plan pasado.
 */
import type { CalendarDate } from '../../routines/domain/routine-rules';
import type { BaseUnit } from '../../catalog/domain/units';
import type {
  BaselineMethod,
  CoveredByInventory,
  LineAlternative,
  LineReasonCode,
  OptimizedPlan,
  OptimizerSettings,
  PlanBaseline,
  PlanCoverage,
  PlanLimitation,
  PlanTotals,
  PlanVisit,
  SearchSummary,
  UnfulfilledNeed,
  BaselineUnavailableReason,
  PlanSavings,
} from './optimized-plan.types';
import type {
  CandidateExclusionReason,
  CandidatePriceBasis,
  CandidatePurchase,
  CandidateStoreSummary,
  MatchType,
  PlanCandidates,
  PlanLocationScope,
  PlanNeed,
  PlanWarning,
  SkippedRoutineItem,
  UnresolvedReason,
} from './planner.types';

export const PLAN_SNAPSHOT_SCHEMA_VERSION = 1;

/** Entradas del cálculo: preferencias, necesidades con su origen y el recorte aplicado. */
export interface PlanInputSnapshot {
  readonly schemaVersion: typeof PLAN_SNAPSHOT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly window: { readonly startDate: CalendarDate; readonly endDate: CalendarDate; readonly days: number; readonly timeZone: string };
  readonly scope: PlanLocationScope;
  readonly limits: PlanCandidates['limits'];
  readonly maxAgeDays: number;
  readonly settings: OptimizerSettings;
  readonly needs: readonly PlanNeed[];
  readonly skippedItems: readonly SkippedRoutineItem[];
  readonly candidates: {
    readonly datesEvaluated: readonly CalendarDate[];
    readonly datesTrimmed: readonly CalendarDate[];
    readonly storesKept: readonly CandidateStoreSummary[];
    readonly storesTrimmed: readonly CandidateStoreSummary[];
    readonly needs: readonly {
      readonly canonicalProductId: string;
      readonly offerCount: number;
      readonly unresolvedReason: UnresolvedReason | null;
      readonly exclusions: Partial<Record<CandidateExclusionReason, number>>;
    }[];
  };
  readonly warnings: readonly PlanWarning[];
}

/** Lo que el optimizador decidió y no vive en las líneas. */
export interface PlanResultSnapshot {
  readonly schemaVersion: typeof PLAN_SNAPSHOT_SCHEMA_VERSION;
  readonly coverage: PlanCoverage;
  readonly search: SearchSummary;
  readonly totals: PlanTotals;
  readonly baseline: PlanBaseline | null;
  readonly baselineUnavailableReason: BaselineUnavailableReason | null;
  readonly savings: PlanSavings | null;
  readonly visits: readonly PlanVisit[];
  readonly limitations: readonly PlanLimitation[];
  readonly coveredByInventory: readonly CoveredByInventory[];
}

/** Lo necesario para mostrar una línea sin volver al catálogo. */
export interface PlanItemSnapshot {
  readonly schemaVersion: typeof PLAN_SNAPSHOT_SCHEMA_VERSION;
  readonly offerId: string;
  readonly canonicalName: string;
  readonly productName: string;
  readonly brand: string | null;
  readonly storeName: string;
  readonly chainName: string;
  readonly matchType: MatchType;
  readonly purchase: CandidatePurchase;
  readonly priceBasis: CandidatePriceBasis;
  readonly promotion: { readonly id: string; readonly name: string } | null;
  readonly reasonCodes: readonly LineReasonCode[];
  readonly alternatives: readonly LineAlternative[];
}

export type StoredBaselineMethod = BaselineMethod | 'NONE';

export interface PlanItemRecord {
  readonly canonicalProductId: string;
  readonly productId: string;
  readonly storeId: string;
  readonly productPriceId: string;
  readonly promotionId: string | null;
  readonly neededQuantity: string;
  readonly quantity: string;
  readonly unit: BaseUnit;
  /** Envases enteros; null para venta por peso. */
  readonly packageCount: number | null;
  readonly price: string;
  readonly estimatedRegularPrice: string;
  readonly estimatedSavings: string;
  readonly recommendedDate: CalendarDate;
  readonly reason: string;
  readonly snapshot: PlanItemSnapshot;
}

export interface PlanRecord {
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  /** Base habitual; sin base, igual a `optimizedCost` para que el ahorro guardado sea cero. */
  readonly estimatedRegularCost: string;
  readonly optimizedCost: string;
  readonly estimatedSavings: string;
  readonly storeVisitPenaltyCost: string;
  readonly distancePenaltyCost: string;
  readonly effectiveCost: string;
  readonly totalDistanceKm: string | null;
  readonly optimizerVersion: string;
  readonly baselineMethod: StoredBaselineMethod;
  readonly inputSnapshot: PlanInputSnapshot;
  readonly resultSnapshot: PlanResultSnapshot;
  readonly unfulfilledNeeds: readonly UnfulfilledNeed[];
  readonly items: readonly PlanItemRecord[];
}

function countExclusions(reasons: readonly CandidateExclusionReason[]): Partial<Record<CandidateExclusionReason, number>> {
  const counts: Partial<Record<CandidateExclusionReason, number>> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

export function toPlanRecord(candidates: PlanCandidates, plan: OptimizedPlan): PlanRecord {
  const { totals, baseline } = plan;
  return {
    startDate: candidates.window.startDate,
    endDate: candidates.window.endDate,
    estimatedRegularCost: baseline ? baseline.productCost : totals.productCost,
    optimizedCost: totals.productCost,
    estimatedSavings: plan.savings ? plan.savings.estimatedSavings : '0.00',
    storeVisitPenaltyCost: totals.storeVisitPenaltyCost,
    distancePenaltyCost: totals.distancePenaltyCost,
    effectiveCost: totals.effectiveCost,
    totalDistanceKm: totals.totalDistanceKm,
    optimizerVersion: plan.optimizerVersion,
    baselineMethod: baseline ? baseline.method : 'NONE',
    inputSnapshot: {
      schemaVersion: PLAN_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: candidates.generatedAt,
      window: {
        startDate: candidates.window.startDate,
        endDate: candidates.window.endDate,
        days: candidates.window.days,
        timeZone: candidates.window.timeZone,
      },
      scope: candidates.scope,
      limits: candidates.limits,
      maxAgeDays: candidates.maxAgeDays,
      settings: plan.settings,
      needs: candidates.needs,
      skippedItems: candidates.skippedItems,
      candidates: {
        datesEvaluated: candidates.candidates.dates.evaluated,
        datesTrimmed: candidates.candidates.dates.trimmed,
        storesKept: candidates.candidates.stores.kept,
        storesTrimmed: candidates.candidates.stores.trimmed,
        needs: candidates.candidates.needs.map((need) => ({
          canonicalProductId: need.canonicalProductId,
          offerCount: need.offers.length,
          unresolvedReason: need.unresolvedReason,
          exclusions: countExclusions(need.exclusions.map((exclusion) => exclusion.reason)),
        })),
      },
      warnings: candidates.candidates.warnings,
    },
    resultSnapshot: {
      schemaVersion: PLAN_SNAPSHOT_SCHEMA_VERSION,
      coverage: plan.coverage,
      search: plan.search,
      totals,
      baseline,
      baselineUnavailableReason: plan.baselineUnavailableReason,
      savings: plan.savings,
      visits: plan.visits,
      limitations: plan.limitations,
      coveredByInventory: plan.coveredByInventory,
    },
    unfulfilledNeeds: plan.unfulfilled,
    items: plan.lines.map((line) => ({
      canonicalProductId: line.canonicalProductId,
      productId: line.productId,
      storeId: line.storeId,
      productPriceId: line.priceBasis.observationId,
      promotionId: line.promotion?.id ?? null,
      neededQuantity: line.neededQuantity,
      quantity: line.purchase.purchasedQuantity,
      unit: line.unit,
      packageCount: line.purchase.saleMode === 'PACKAGED' ? Number(line.purchase.units) : null,
      price: line.total,
      estimatedRegularPrice: line.regularTotal,
      estimatedSavings: line.discount,
      recommendedDate: line.date,
      reason: line.reason,
      snapshot: {
        schemaVersion: PLAN_SNAPSHOT_SCHEMA_VERSION,
        offerId: line.offerId,
        canonicalName: line.canonicalName,
        productName: line.productName,
        brand: line.brand,
        storeName: line.storeName,
        chainName: line.chainName,
        matchType: line.matchType,
        purchase: line.purchase,
        priceBasis: line.priceBasis,
        promotion: line.promotion,
        reasonCodes: line.reasonCodes,
        alternatives: line.alternatives,
      },
    })),
  };
}
