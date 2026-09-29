/**
 * Contratos HTTP de los planes guardados (P5-03). Se reflejan en `packages/shared`
 * y `docs/API.md`; si cambian, cambiar los tres. Todo sale de las columnas y los
 * snapshots del plan, nunca del catálogo vivo: un plan emitido no cambia.
 */
import type { Prisma } from '../../../generated/prisma/client';
import { toAmountString, toQuantityString } from '../../catalog/infrastructure/decimal-mapper';
import type { BaseUnit, SaleMode } from '../../catalog/domain/units';
import { effectiveStatus } from '../domain/plan-status';
import type { PlanStatus } from '../domain/plan-status';
import { PLAN_SNAPSHOT_SCHEMA_VERSION } from '../domain/plan-snapshot';
import type { PlanInputSnapshot, PlanItemSnapshot, PlanResultSnapshot, StoredBaselineMethod } from '../domain/plan-snapshot';
import type {
  CoveredByInventory,
  LineAlternative,
  LineReasonCode,
  OptimizationMethod,
  PlanCoverage,
  PlanLimitation,
  PlanTotals,
  UnfulfilledNeed,
} from '../domain/optimized-plan.types';
import type { MatchType, PlanLocationScope, PlanWarning } from '../domain/planner.types';

export interface ShoppingPlanSummaryDto {
  id: string;
  status: PlanStatus;
  startDate: string;
  endDate: string;
  generatedAt: string;
  completedAt: string | null;
  coverage: PlanCoverage;
  lineCount: number;
  visitCount: number;
  unfulfilledCount: number;
  /** Lo que se estima pagar por los productos. */
  optimizedCost: string;
  effectiveCost: string;
  /** Null si no hubo base comparable: sin comparación no hay ahorro que mostrar. */
  estimatedSavings: string | null;
}

export interface ShoppingPlanListDto {
  items: ShoppingPlanSummaryDto[];
}

export interface PlanLineDto {
  id: string;
  canonicalProductId: string;
  canonicalName: string;
  productId: string;
  productName: string;
  brand: string | null;
  matchType: MatchType;
  /** Necesidad neta cubierta, en la unidad del canónico. */
  neededQuantity: string;
  /** Lo que se compra: envases enteros o peso estimado. */
  quantity: string;
  unit: BaseUnit;
  packageCount: number | null;
  saleMode: SaleMode;
  surplus: string;
  quantityIsEstimate: boolean;
  /** Totales de la línea en ARS. */
  price: string;
  regularPrice: string;
  discount: string;
  promotion: { id: string; name: string } | null;
  priceObservedAt: string;
  priceSource: string;
  reasonCodes: LineReasonCode[];
  reason: string;
  alternatives: LineAlternative[];
}

export interface ScheduleVisitDto {
  storeId: string;
  storeName: string;
  chainName: string;
  distanceMeters: number | null;
  roundTripKm: string | null;
  subtotal: string;
  lines: PlanLineDto[];
}

export interface ScheduleDayDto {
  date: string;
  visits: ScheduleVisitDto[];
}

export interface PlanNeedSummaryDto {
  canonicalProductId: string;
  canonicalName: string;
  unit: BaseUnit;
  grossQuantity: string;
  netQuantity: string;
  inventorySubtracted: string | null;
  sources: { routineName: string; occurrences: string[]; quantity: string }[];
}

export interface ShoppingPlanDto extends ShoppingPlanSummaryDto {
  optimizerVersion: string;
  method: OptimizationMethod;
  baselineMethod: StoredBaselineMethod;
  location: PlanLocationScope;
  settings: { storeVisitPenalty: string; distancePenaltyPerKm: string; maxStores: number | null };
  totals: PlanTotals;
  savings: {
    estimatedSavings: string;
    effectiveCostDifference: string;
    baselineStoreName: string;
    baselineProductCost: string;
  } | null;
  schedule: ScheduleDayDto[];
  needs: PlanNeedSummaryDto[];
  unfulfilled: UnfulfilledNeed[];
  coveredByInventory: CoveredByInventory[];
  limitations: PlanLimitation[];
  warnings: PlanWarning[];
  /** Rango de fechas de los precios usados como estimación. */
  prices: { oldestObservedAt: string; newestObservedAt: string } | null;
}

export const planInclude = {
  items: { orderBy: [{ recommendedDate: 'asc' }, { storeId: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ShoppingPlanInclude;

export type PlanRow = Prisma.ShoppingPlanGetPayload<{ include: typeof planInclude }>;
type PlanSummaryRow = Omit<PlanRow, 'items' | 'inputSnapshot'> & { _count: { items: number } };

/** Columna `date`: Prisma la entrega como medianoche UTC. */
export const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);
export const fromCalendarDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/** Los snapshots se validan al leer: una versión desconocida no se interpreta a ciegas. */
function snapshot<T extends { schemaVersion: number }>(value: Prisma.JsonValue, name: string): T {
  const parsed = value as T | null;
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== PLAN_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Snapshot ${name} con versión no soportada.`);
  }
  return parsed;
}

export function toPlanSummaryDto(row: PlanSummaryRow, today: string): ShoppingPlanSummaryDto {
  const result = snapshot<PlanResultSnapshot>(row.resultSnapshot, 'resultSnapshot');
  const unfulfilled = row.unfulfilledNeeds as unknown as UnfulfilledNeed[];
  return {
    id: row.id,
    status: effectiveStatus(row.status, toCalendarDate(row.endDate), today),
    startDate: toCalendarDate(row.startDate),
    endDate: toCalendarDate(row.endDate),
    generatedAt: row.generatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    coverage: result.coverage,
    lineCount: row._count.items,
    visitCount: result.totals.visitCount,
    unfulfilledCount: unfulfilled.length,
    optimizedCost: toAmountString(row.optimizedCost, 2),
    effectiveCost: toAmountString(row.effectiveCost, 2),
    estimatedSavings: row.baselineMethod === 'NONE' ? null : toAmountString(row.estimatedSavings, 2),
  };
}

function toLineDto(item: PlanRow['items'][number]): PlanLineDto {
  const details = snapshot<PlanItemSnapshot>(item.snapshot, 'snapshot de línea');
  return {
    id: item.id,
    canonicalProductId: item.canonicalProductId,
    canonicalName: details.canonicalName,
    productId: item.productId,
    productName: details.productName,
    brand: details.brand,
    matchType: details.matchType,
    neededQuantity: toQuantityString(item.neededQuantity),
    quantity: toQuantityString(item.quantity),
    unit: item.unit,
    packageCount: item.packageCount,
    saleMode: details.purchase.saleMode,
    surplus: details.purchase.surplus,
    quantityIsEstimate: details.purchase.quantityIsEstimate,
    price: toAmountString(item.price, 2),
    regularPrice: toAmountString(item.estimatedRegularPrice, 2),
    discount: toAmountString(item.estimatedSavings, 2),
    promotion: details.promotion,
    priceObservedAt: details.priceBasis.observedAt,
    priceSource: details.priceBasis.source,
    reasonCodes: [...details.reasonCodes],
    reason: item.reason,
    alternatives: [...details.alternatives],
  };
}

export function toPlanDto(row: PlanRow, today: string): ShoppingPlanDto {
  const input = snapshot<PlanInputSnapshot>(row.inputSnapshot, 'inputSnapshot');
  const result = snapshot<PlanResultSnapshot>(row.resultSnapshot, 'resultSnapshot');
  const summary = toPlanSummaryDto({ ...row, _count: { items: row.items.length } }, today);
  const lines = row.items.map(toLineDto);

  const visitsByKey = new Map(result.visits.map((visit) => [`${visit.date}|${visit.storeId}`, visit]));
  const days = new Map<string, Map<string, ScheduleVisitDto>>();
  for (const [index, line] of lines.entries()) {
    const item = row.items[index] as PlanRow['items'][number];
    const date = toCalendarDate(item.recommendedDate);
    const visit = visitsByKey.get(`${date}|${item.storeId}`);
    const day = days.get(date) ?? new Map<string, ScheduleVisitDto>();
    const entry = day.get(item.storeId) ?? {
      storeId: item.storeId,
      storeName: visit?.storeName ?? (item.snapshot as unknown as PlanItemSnapshot).storeName,
      chainName: visit?.chainName ?? (item.snapshot as unknown as PlanItemSnapshot).chainName,
      distanceMeters: visit?.distanceMeters ?? null,
      roundTripKm: visit?.roundTripKm ?? null,
      subtotal: visit?.subtotal ?? '0.00',
      lines: [],
    };
    entry.lines.push(line);
    day.set(item.storeId, entry);
    days.set(date, day);
  }
  const observed = lines.map((line) => line.priceObservedAt).sort();

  return {
    ...summary,
    optimizerVersion: row.optimizerVersion,
    method: result.search.method,
    baselineMethod: row.baselineMethod as StoredBaselineMethod,
    location: input.scope,
    settings: {
      storeVisitPenalty: input.settings.storeVisitPenalty,
      distancePenaltyPerKm: input.settings.distancePenaltyPerKm,
      maxStores: input.settings.maxStores,
    },
    totals: result.totals,
    savings: result.savings && result.baseline
      ? {
          estimatedSavings: result.savings.estimatedSavings,
          effectiveCostDifference: result.savings.effectiveCostDifference,
          baselineStoreName: result.baseline.storeName,
          baselineProductCost: result.baseline.productCost,
        }
      : null,
    schedule: [...days.entries()].map(([date, visits]) => ({ date, visits: [...visits.values()] })),
    needs: input.needs.map((need) => ({
      canonicalProductId: need.canonicalProductId,
      canonicalName: need.canonicalName,
      unit: need.unit,
      grossQuantity: need.grossQuantity,
      netQuantity: need.netQuantity,
      inventorySubtracted: need.inventory?.applied ? need.inventory.subtracted : null,
      sources: need.sources.map((source) => ({
        routineName: source.routineName,
        occurrences: [...source.occurrences],
        quantity: source.quantity,
      })),
    })),
    unfulfilled: row.unfulfilledNeeds as unknown as UnfulfilledNeed[],
    coveredByInventory: [...result.coveredByInventory],
    limitations: [...result.limitations],
    warnings: [...input.warnings],
    prices: observed.length
      ? { oldestObservedAt: observed[0] as string, newestObservedAt: observed[observed.length - 1] as string }
      : null,
  };
}
