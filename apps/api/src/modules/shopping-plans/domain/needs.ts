/**
 * Necesidades del plan (P5-01, docs/DOMAIN.md "Rutinas e inventario").
 *
 * Por cada ítem cuenta sus ocurrencias en la ventana y multiplica la cantidad por
 * ocurrencia. Agrupa por canónico **antes** de mirar la despensa, así dos rutinas
 * con pollo no restan dos veces los mismos 2 kg. Función pura y determinista: el
 * orden de la entrada no cambia el resultado.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import { normalizeName } from '../../catalog/domain/naming';
import { ageInDays } from '../../prices/domain/price-freshness';
import { normalizeBrandList } from '../../routines/domain/routine-rules';
import { occurrencesInWindow } from './plan-calendar';
import type {
  NeedConstraints,
  NeedInventory,
  NeedSource,
  NeedsInput,
  NeedsResult,
  NeedStatus,
  PlanNeed,
  PlanRoutineItemInput,
  SkippedRoutineItem,
} from './planner.types';

const QUANTITY_SCALE = 4;

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compareText);

const sortBrands = (brands: readonly string[]): string[] =>
  [...brands].sort((a, b) => compareText(normalizeName(a), normalizeName(b)));

/**
 * Combina las restricciones de varios ítems del mismo canónico. Lo que restringe
 * se suma (marcas excluidas, "sin reemplazos"); lo que prefiere solo se conserva
 * si no choca con una restricción. Dos presentaciones exactas distintas no se
 * pueden cumplir con una sola compra: es un conflicto que se informa.
 */
function mergeConstraints(items: readonly PlanRoutineItemInput[]): { constraints: NeedConstraints; conflict: boolean } {
  const required = uniqueSorted(
    items.filter((item) => !item.allowSubstitutes && item.preferredProductId).map((item) => item.preferredProductId as string),
  );
  const preferred = uniqueSorted(
    items.filter((item) => item.allowSubstitutes && item.preferredProductId).map((item) => item.preferredProductId as string),
  );
  const excludedBrands = sortBrands(normalizeBrandList(items.flatMap((item) => item.excludedBrands)));
  const excludedKeys = new Set(excludedBrands.map((brand) => normalizeName(brand)));
  const preferredBrands = sortBrands(
    normalizeBrandList(items.flatMap((item) => item.preferredBrands)).filter(
      (brand) => !excludedKeys.has(normalizeName(brand)),
    ),
  );
  const allowSubstitutes = items.every((item) => item.allowSubstitutes);
  return {
    constraints: {
      allowSubstitutes,
      requiredProductId: required.length === 1 ? (required[0] as string) : null,
      preferredProductIds: allowSubstitutes ? preferred : [],
      preferredBrands,
      excludedBrands,
    },
    conflict: required.length > 1,
  };
}

export function buildNeeds(input: NeedsInput): NeedsResult {
  const canonicals = new Map(input.canonicals.map((canonical) => [canonical.id, canonical]));
  const inventory = new Map(input.inventory.map((row) => [row.canonicalProductId, row]));
  const skippedItems: SkippedRoutineItem[] = [];
  const grouped = new Map<string, { item: PlanRoutineItemInput; occurrences: string[] }[]>();

  const items = [...input.items].sort((a, b) => compareText(a.routineId, b.routineId) || compareText(a.id, b.id));
  for (const item of items) {
    const skip = (reason: SkippedRoutineItem['reason']) =>
      skippedItems.push({
        routineId: item.routineId,
        routineItemId: item.id,
        canonicalProductId: item.canonicalProductId,
        reason,
      });
    const canonical = canonicals.get(item.canonicalProductId);
    if (!canonical) {
      skip('CANONICAL_NOT_FOUND');
      continue;
    }
    // P4-01 guarda en la unidad del canónico; si el canónico cambió después, no se adivina.
    if (item.unit !== canonical.defaultUnit) {
      skip('UNIT_MISMATCH');
      continue;
    }
    const occurrences = occurrencesInWindow(
      { frequencyDays: item.frequencyDays, anchorDate: item.anchorDate },
      input.window,
    );
    if (!occurrences.length) {
      skip('NO_OCCURRENCES_IN_WINDOW');
      continue;
    }
    const group = grouped.get(canonical.id) ?? [];
    group.push({ item, occurrences });
    grouped.set(canonical.id, group);
  }

  const needs: PlanNeed[] = [];
  for (const [canonicalId, entries] of grouped) {
    const canonical = canonicals.get(canonicalId);
    if (!canonical) continue;

    const sources: NeedSource[] = entries.map(({ item, occurrences }) => ({
      routineId: item.routineId,
      routineName: item.routineName,
      routineItemId: item.id,
      quantityPerOccurrence: DecimalValue.parse(item.quantity).toTrimmedString(),
      frequencyDays: item.frequencyDays,
      anchorDate: item.anchorDate,
      inheritedSchedule: item.inheritedSchedule,
      occurrences,
      quantity: DecimalValue.parse(item.quantity).multiply(DecimalValue.parse(String(occurrences.length))).toTrimmedString(),
    }));
    const gross = sources.reduce((sum, source) => sum.add(DecimalValue.parse(source.quantity)), DecimalValue.zero(QUANTITY_SCALE));

    let net = gross;
    let inventoryView: NeedInventory | null = null;
    const stock = inventory.get(canonicalId);
    if (stock) {
      const balance = DecimalValue.parse(stock.quantity);
      const applied = stock.unit === canonical.defaultUnit;
      const subtracted = !applied ? DecimalValue.zero() : balance.compare(gross) < 0 ? balance : gross;
      net = gross.subtract(subtracted);
      inventoryView = {
        quantity: balance.toTrimmedString(),
        unit: stock.unit,
        updatedAt: stock.updatedAt.toISOString(),
        ageDays: ageInDays(stock.updatedAt, input.now),
        applied,
        subtracted: subtracted.toTrimmedString(QUANTITY_SCALE),
      };
    }

    const { constraints, conflict } = mergeConstraints(entries.map((entry) => entry.item));
    const status: NeedStatus = !net.isPositive() ? 'COVERED_BY_INVENTORY' : conflict ? 'CONFLICT' : 'TO_BUY';
    needs.push({
      canonicalProductId: canonicalId,
      canonicalName: canonical.name,
      unit: canonical.defaultUnit,
      grossQuantity: gross.toTrimmedString(QUANTITY_SCALE),
      netQuantity: net.toTrimmedString(QUANTITY_SCALE),
      firstOccurrence: entries.flatMap((entry) => entry.occurrences).sort(compareText)[0] as string,
      inventory: inventoryView,
      constraints,
      sources,
      status,
    });
  }

  needs.sort(
    (a, b) =>
      compareText(normalizeName(a.canonicalName), normalizeName(b.canonicalName)) ||
      compareText(a.canonicalProductId, b.canonicalProductId),
  );
  return { needs, skippedItems };
}
