/**
 * Optimizador determinista del plan (P5-02, ADR 0004 y 0014). Función pura.
 *
 * Una **visita** es una sucursal en una fecha. Dado un conjunto de visitas, cada
 * necesidad toma su opción más barata entre ellas, así que optimizar es elegir
 * visitas: `costo efectivo = productos + penalidad por visita × visitas +
 * penalidad por km × km de ida y vuelta`. Ir a la misma sucursal dos días son
 * dos visitas pero una sola sucursal para el máximo del usuario.
 *
 * 1. Por sucursal se descartan las fechas dominadas (ninguna necesidad sale más
 *    barata ese día que en otro que se conserva): es exacto, no aproxima.
 * 2. Si las combinaciones (subconjuntos de sucursales hasta el máximo y, en cada
 *    una, subconjuntos de sus fechas útiles) entran en el presupuesto, se evalúan
 *    todas: `EXACT_BOUNDED`, óptimo entre los candidatos acotados de P5-01.
 * 3. Si no, una fecha por sucursal y todos los subconjuntos de sucursales; y si
 *    tampoco entra, se agregan sucursales de a una mientras mejoren: `HEURISTIC`.
 *
 * El orden es lexicográfico: primero cubrir la mayor cantidad de necesidades,
 * después el menor costo efectivo, menos visitas, menos km y, por último, el id.
 * Importes internos en enteros de 1e-5 ARS: nunca `number` binario para dinero.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { CalendarDate } from '../../routines/domain/routine-rules';
import { compareText } from './needs';
import { OPTIMIZER_VERSION } from './optimized-plan.types';
import type {
  BaselineUnavailableReason,
  CoveredByInventory,
  LineAlternative,
  LineReasonCode,
  OptimizationMethod,
  OptimizedPlan,
  OptimizerSettings,
  PlanBaseline,
  PlanCoverage,
  PlanLimitation,
  PlanLine,
  PlanTotals,
  PlanVisit,
  UnfulfilledNeed,
} from './optimized-plan.types';
import type {
  CandidateDateOption,
  CandidateOffer,
  CandidateStoreSummary,
  NeedCandidates,
  PlanCandidates,
  PlanNeed,
} from './planner.types';

const UNIT_SCALE = 5;
const MONEY_SCALE = 2;
const KM_SCALE = 3;
const MAX_ALTERNATIVES = 2;

const units = (value: string | DecimalValue): bigint => DecimalValue.parse(value).round(UNIT_SCALE).units;
const decimalOf = (value: bigint): DecimalValue => DecimalValue.fromUnits(value, UNIT_SCALE);
const moneyOf = (value: bigint): string => decimalOf(value).toFixed(MONEY_SCALE);
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

interface ResolvedNeed {
  readonly need: PlanNeed;
  readonly candidates: NeedCandidates;
}

interface StoreEntry {
  readonly summary: CandidateStoreSummary;
  readonly roundTripKm: DecimalValue | null;
  /** Penalidad por distancia de una visita, en 1e-5 ARS. */
  readonly distancePenalty: bigint;
  /** Penalidad completa de una visita: visita + distancia. */
  readonly visitCost: bigint;
  dates: CalendarDate[];
}

/** Una visita: sucursal (índice) y fecha. `slot` las numera en orden de id de sucursal y fecha. */
interface Visit {
  readonly store: number;
  readonly date: CalendarDate;
  readonly slot: number;
}

interface Choice {
  readonly offer: CandidateOffer;
  readonly option: CandidateDateOption;
  readonly total: bigint;
}

interface Evaluation {
  /** Ordenadas por `slot`: el desempate final compara estas listas. */
  readonly visits: readonly Visit[];
  readonly choices: readonly (Choice | null)[];
  readonly uncovered: number;
  readonly effective: bigint;
  readonly kmUnits: bigint;
}

/** Más barata; ante empate, la preferida, la marca preferida, la fecha más temprana y los ids. */
function compareChoices(a: Choice, b: Choice): number {
  return (
    compareBig(a.total, b.total) ||
    Number(b.offer.matchType === 'EXACT') - Number(a.offer.matchType === 'EXACT') ||
    Number(b.offer.preferredBrand) - Number(a.offer.preferredBrand) ||
    compareText(a.option.date, b.option.date) ||
    compareText(a.offer.storeId, b.offer.storeId) ||
    compareText(a.offer.productId, b.offer.productId)
  );
}

/** Último desempate: las visitas en orden de sucursal (id) y fecha, comparadas una a una. */
function compareVisits(a: readonly Visit[], b: readonly Visit[]): number {
  for (let index = 0; index < a.length; index += 1) {
    const difference = (a[index] as Visit).slot - (b[index] as Visit).slot;
    if (difference) return difference;
  }
  return 0;
}

function compareEvaluations(a: Evaluation, b: Evaluation): number {
  return (
    a.uncovered - b.uncovered ||
    compareBig(a.effective, b.effective) ||
    a.visits.length - b.visits.length ||
    compareBig(a.kmUnits, b.kmUnits) ||
    compareVisits(a.visits, b.visits)
  );
}

/** Cantidad de subconjuntos de 1..m sucursales, con `weights[i]` opciones cada una. */
export function countCombinations(weights: readonly number[], maxStores: number): number {
  const sums = [1, ...Array.from({ length: maxStores }, () => 0)];
  for (const weight of weights) {
    for (let size = maxStores; size >= 1; size -= 1) sums[size] = (sums[size] ?? 0) + (sums[size - 1] ?? 0) * weight;
  }
  return sums.slice(1).reduce((total, value) => total + value, 0);
}

function assertSettings(settings: OptimizerSettings): void {
  for (const [field, value] of [
    ['storeVisitPenalty', settings.storeVisitPenalty],
    ['distancePenaltyPerKm', settings.distancePenaltyPerKm],
  ] as const) {
    if (DecimalValue.parse(value).isNegative()) throw new RangeError(`${field} no puede ser negativa.`);
  }
  if (settings.maxStores !== null && (!Number.isInteger(settings.maxStores) || settings.maxStores < 1)) {
    throw new RangeError('maxStores debe ser un entero positivo o null.');
  }
  if (!Number.isInteger(settings.maxCombinations) || settings.maxCombinations < 1) {
    throw new RangeError('maxCombinations debe ser un entero positivo.');
  }
}

const formatDate = (date: CalendarDate): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function formatArs(value: DecimalValue): string {
  const [integer = '0', fraction = '00'] = value.toFixed(MONEY_SCALE).replace('-', '').split('.');
  return `$${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}

class Search {
  readonly stores: StoreEntry[];
  private readonly dates: readonly CalendarDate[];
  private readonly dateIndex: Map<CalendarDate, number>;
  /** Por necesidad y `slot`: la mejor opción de esa visita, si la hay. */
  private readonly bestAt: (Choice | undefined)[][];
  evaluated = 0;

  constructor(
    needs: readonly ResolvedNeed[],
    storeSummaries: readonly CandidateStoreSummary[],
    dates: readonly CalendarDate[],
    private readonly settings: OptimizerSettings,
  ) {
    const visitPenalty = units(settings.storeVisitPenalty);
    const perKm = DecimalValue.parse(settings.distancePenaltyPerKm);
    const byId = new Map(storeSummaries.map((store) => [store.id, store]));
    const used = new Set(needs.flatMap((entry) => entry.candidates.offers.map((offer) => offer.storeId)));
    this.dates = [...dates];
    this.dateIndex = new Map(this.dates.map((date, index) => [date, index]));
    this.stores = [...used]
      .sort(compareText)
      .map((id) => byId.get(id))
      .filter((store): store is CandidateStoreSummary => Boolean(store))
      .map((summary) => {
        const roundTripKm = summary.distanceMeters === null
          ? null
          : DecimalValue.parse((summary.distanceMeters / 1000).toFixed(KM_SCALE)).multiply(DecimalValue.parse('2'));
        const distancePenalty = roundTripKm ? units(roundTripKm.multiply(perKm)) : 0n;
        return { summary, roundTripKm, distancePenalty, visitCost: visitPenalty + distancePenalty, dates: [...dates] };
      });

    const storeIndex = new Map(this.stores.map((store, index) => [store.summary.id, index]));
    this.bestAt = needs.map((entry) => {
      const best: (Choice | undefined)[] = [];
      for (const offer of entry.candidates.offers) {
        const store = storeIndex.get(offer.storeId);
        if (store === undefined) continue;
        for (const option of offer.dateOptions) {
          const date = this.dateIndex.get(option.date);
          if (date === undefined) continue;
          const choice = { offer, option, total: units(option.total) };
          const slot = store * this.dates.length + date;
          const current = best[slot];
          if (!current || compareChoices(choice, current) < 0) best[slot] = choice;
        }
      }
      return best;
    });
    for (const [index, store] of this.stores.entries()) store.dates = this.usefulDates(index, store.dates);
  }

  get maxStores(): number {
    return Math.min(this.settings.maxStores ?? this.stores.length, this.stores.length);
  }

  visit(store: number, date: CalendarDate): Visit {
    return { store, date, slot: store * this.dates.length + (this.dateIndex.get(date) ?? 0) };
  }

  private profile(store: number, date: CalendarDate): (bigint | null)[] {
    const { slot } = this.visit(store, date);
    return this.bestAt.map((best) => best[slot]?.total ?? null);
  }

  /** Quita las fechas en las que ninguna necesidad sale más barata que en otra conservada. */
  private usefulDates(store: number, dates: readonly CalendarDate[]): CalendarDate[] {
    const profiles = dates.map((date) => this.profile(store, date));
    const dominates = (better: (bigint | null)[], worse: (bigint | null)[], earlier: boolean): boolean => {
      let strictly = false;
      for (const [index, value] of worse.entries()) {
        const candidate = better[index] ?? null;
        if (value === null) {
          if (candidate !== null) strictly = true;
          continue;
        }
        if (candidate === null || candidate > value) return false;
        if (candidate < value) strictly = true;
      }
      return strictly || earlier;
    };
    return dates.filter(
      (_, index) =>
        !profiles.some(
          (other, otherIndex) => otherIndex !== index && dominates(other, profiles[index] ?? [], otherIndex < index),
        ),
    );
  }

  evaluate(unsorted: readonly Visit[]): Evaluation {
    this.evaluated += 1;
    const visits = [...unsorted].sort((a, b) => a.slot - b.slot);
    let uncovered = 0;
    let products = 0n;
    const choices = this.bestAt.map((best) => {
      let chosen: Choice | null = null;
      for (const visit of visits) {
        const choice = best[visit.slot];
        if (choice && (!chosen || compareChoices(choice, chosen) < 0)) chosen = choice;
      }
      if (chosen) products += chosen.total;
      else uncovered += 1;
      return chosen;
    });
    let penalty = 0n;
    let kmUnits = 0n;
    for (const visit of visits) {
      const store = this.stores[visit.store] as StoreEntry;
      penalty += store.visitCost;
      if (store.roundTripKm) kmUnits += units(store.roundTripKm);
    }
    return { visits, choices, uncovered, effective: products + penalty, kmUnits };
  }

  /** Todas las combinaciones de hasta `maxStores` sucursales, cada una con una de sus alternativas de visitas. */
  enumerate(alternatives: readonly (readonly Visit[])[][]): Evaluation | null {
    let best: Evaluation | null = null;
    const chosen: Visit[] = [];
    const walk = (store: number, storesUsed: number): void => {
      if (store === alternatives.length) {
        if (!storesUsed) return;
        const evaluation = this.evaluate(chosen);
        if (!best || compareEvaluations(evaluation, best) < 0) best = evaluation;
        return;
      }
      walk(store + 1, storesUsed);
      if (storesUsed >= this.maxStores) return;
      for (const visits of alternatives[store] ?? []) {
        chosen.push(...visits);
        walk(store + 1, storesUsed + 1);
        chosen.splice(chosen.length - visits.length, visits.length);
      }
    };
    walk(0, 0);
    return best;
  }

  /** Subconjuntos no vacíos de las fechas útiles: más de una fecha son varias visitas. */
  dateSubsets(store: number): Visit[][] {
    const dates = (this.stores[store] as StoreEntry).dates;
    const subsets: Visit[][] = [];
    for (let mask = 1; mask < 2 ** dates.length; mask += 1) {
      subsets.push(dates.filter((_, index) => mask & (2 ** index)).map((date) => this.visit(store, date)));
    }
    return subsets;
  }

  /** Para el método aproximado: la fecha que cubre más necesidades y más barato; ante empate, la primera. */
  bestSingleDate(store: number): Visit {
    let best: { date: CalendarDate; covered: number; total: bigint } | null = null;
    for (const date of (this.stores[store] as StoreEntry).dates) {
      const profile = this.profile(store, date);
      const covered = profile.filter((value) => value !== null).length;
      const total = profile.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
      if (!best || covered > best.covered || (covered === best.covered && total < best.total)) {
        best = { date, covered, total };
      }
    }
    return this.visit(store, (best as { date: CalendarDate }).date);
  }

  /** Agrega de a una la sucursal que más mejora el resultado, hasta el máximo o sin mejora. */
  greedy(): Evaluation {
    let current = this.evaluate([]);
    const used = new Set<number>();
    while (used.size < this.maxStores) {
      let next: { store: number; evaluation: Evaluation } | null = null;
      for (let store = 0; store < this.stores.length; store += 1) {
        if (used.has(store)) continue;
        const evaluation = this.evaluate([...current.visits, this.bestSingleDate(store)]);
        if (compareEvaluations(evaluation, current) < 0 && (!next || compareEvaluations(evaluation, next.evaluation) < 0)) {
          next = { store, evaluation };
        }
      }
      if (!next) break;
      used.add(next.store);
      current = next.evaluation;
    }
    return current;
  }
}

/** Todas las opciones de una necesidad (oferta × fecha), la mejor fecha por oferta. */
function optionsOf(entry: ResolvedNeed): Choice[] {
  const bestByOffer = new Map<string, Choice>();
  for (const offer of entry.candidates.offers) {
    for (const option of offer.dateOptions) {
      const choice = { offer, option, total: units(option.total) };
      const current = bestByOffer.get(offer.id);
      if (!current || compareChoices(choice, current) < 0) bestByOffer.set(offer.id, choice);
    }
  }
  return [...bestByOffer.values()].sort(compareChoices);
}

function buildLine(entry: ResolvedNeed, choice: Choice): PlanLine {
  const { need } = entry;
  const { offer, option } = choice;
  const alternatives: LineAlternative[] = optionsOf(entry)
    .filter((candidate) => !(candidate.offer.id === offer.id && candidate.option.date === option.date))
    .slice(0, MAX_ALTERNATIVES)
    .map((candidate) => ({
      offerId: candidate.offer.id,
      productName: candidate.offer.productName,
      storeName: candidate.offer.storeName,
      date: candidate.option.date,
      total: candidate.option.total,
      difference: moneyOf(candidate.total - choice.total),
    }));
  const cheaper = alternatives.find((alternative) => DecimalValue.parse(alternative.difference).isNegative());
  const promotion = option.appliedPromotionId
    ? option.promotions.find((check) => check.promotionId === option.appliedPromotionId) ?? null
    : null;

  const codes: LineReasonCode[] = [cheaper ? 'CHEAPER_OPTION_NOT_WORTH_IT' : 'CHEAPEST_EVALUATED'];
  const sentences = [
    cheaper
      ? `En ${cheaper.storeName} el ${formatDate(cheaper.date)} cuesta ${formatArs(DecimalValue.parse(cheaper.difference))} menos, pero sumar esa visita no conviene o supera tu máximo de sucursales.`
      : 'Es la opción más barata entre las sucursales y fechas evaluadas.',
  ];
  if (need.constraints.requiredProductId === offer.productId) {
    codes.push('EXACT_PRODUCT_REQUIRED');
    sentences.push('Es la presentación que pediste, sin reemplazos.');
  } else if (need.constraints.preferredProductIds.includes(offer.productId)) {
    codes.push('PREFERRED_PRODUCT');
    sentences.push('Es tu presentación preferida.');
  }
  if (promotion) {
    codes.push('PROMOTION_APPLIED');
    sentences.push(`Aplica "${promotion.name}" comprando el ${formatDate(option.date)}.`);
  }

  return {
    canonicalProductId: need.canonicalProductId,
    canonicalName: need.canonicalName,
    neededQuantity: need.netQuantity,
    unit: need.unit,
    offerId: offer.id,
    productId: offer.productId,
    productName: offer.productName,
    brand: offer.brand,
    storeId: offer.storeId,
    storeName: offer.storeName,
    chainName: offer.chainName,
    date: option.date,
    matchType: offer.matchType,
    purchase: offer.purchase,
    priceBasis: offer.priceBasis,
    regularTotal: offer.regularTotal,
    total: option.total,
    discount: option.discount,
    promotion: promotion ? { id: promotion.promotionId, name: promotion.name } : null,
    reasonCodes: codes,
    reason: sentences.join(' '),
    alternatives,
  };
}

function buildVisits(lines: readonly PlanLine[], stores: readonly StoreEntry[]): PlanVisit[] {
  const byId = new Map(stores.map((store) => [store.summary.id, store]));
  const grouped = new Map<string, PlanLine[]>();
  for (const line of lines) {
    const key = `${line.date}|${line.storeId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, visitLines]) => {
      const first = visitLines[0] as PlanLine;
      const store = byId.get(first.storeId) as StoreEntry;
      return {
        storeId: first.storeId,
        storeName: first.storeName,
        chainName: first.chainName,
        date: first.date,
        distanceMeters: store.summary.distanceMeters,
        roundTripKm: store.roundTripKm ? store.roundTripKm.toFixed(KM_SCALE) : null,
        lineCount: visitLines.length,
        subtotal: moneyOf(visitLines.reduce((sum, line) => sum + units(line.total), 0n)),
      };
    });
}

function buildTotals(lines: readonly PlanLine[], visits: readonly PlanVisit[], stores: readonly StoreEntry[], settings: OptimizerSettings): PlanTotals {
  const byId = new Map(stores.map((store) => [store.summary.id, store]));
  const product = lines.reduce((sum, line) => sum + units(line.total), 0n);
  const regular = lines.reduce((sum, line) => sum + units(line.regularTotal), 0n);
  const visitPenalty = units(settings.storeVisitPenalty) * BigInt(visits.length);
  const distancePenalty = visits.reduce((sum, visit) => sum + (byId.get(visit.storeId)?.distancePenalty ?? 0n), 0n);
  // Cada componente se redondea una vez a centavos y el efectivo es su suma: cierra con el CHECK de la tabla.
  const productCost = decimalOf(product).round(MONEY_SCALE);
  const visitCost = decimalOf(visitPenalty).round(MONEY_SCALE);
  const distanceCost = decimalOf(distancePenalty).round(MONEY_SCALE);
  const allKnown = visits.every((visit) => visit.roundTripKm !== null);
  const km = visits.reduce((sum, visit) => sum.add(DecimalValue.parse(visit.roundTripKm ?? '0')), DecimalValue.zero(KM_SCALE));
  return {
    productCost: productCost.toFixed(MONEY_SCALE),
    regularProductCost: moneyOf(regular),
    promotionDiscount: moneyOf(regular - product),
    visitCount: visits.length,
    storeCount: new Set(visits.map((visit) => visit.storeId)).size,
    storeVisitPenaltyCost: visitCost.toFixed(MONEY_SCALE),
    distancePenaltyCost: distanceCost.toFixed(MONEY_SCALE),
    effectiveCost: productCost.add(visitCost).add(distanceCost).toFixed(MONEY_SCALE),
    totalDistanceKm: visits.length && allKnown ? km.toFixed(KM_SCALE) : null,
  };
}

/** La sucursal más barata que tiene **todas** las necesidades del plan, a precio regular. */
function buildBaseline(
  lines: readonly PlanLine[],
  resolved: readonly ResolvedNeed[],
  stores: readonly StoreEntry[],
  settings: OptimizerSettings,
): PlanBaseline | null {
  const covered = new Set(lines.map((line) => line.canonicalProductId));
  const needs = resolved.filter((entry) => covered.has(entry.need.canonicalProductId));
  let best: { store: StoreEntry; product: bigint; baselineLines: PlanBaseline['lines'] } | null = null;
  for (const store of stores) {
    const baselineLines = [];
    let product = 0n;
    for (const entry of needs) {
      const offers = entry.candidates.offers
        .filter((offer) => offer.storeId === store.summary.id)
        .sort((a, b) => compareBig(units(a.regularTotal), units(b.regularTotal)) || compareText(a.productId, b.productId));
      const cheapest = offers[0];
      if (!cheapest) break;
      product += units(cheapest.regularTotal);
      baselineLines.push({
        canonicalProductId: entry.need.canonicalProductId,
        offerId: cheapest.id,
        observationId: cheapest.priceBasis.observationId,
        regularTotal: cheapest.regularTotal,
      });
    }
    if (baselineLines.length !== needs.length) continue;
    const better =
      !best ||
      product < best.product ||
      (product === best.product &&
        ((store.summary.distanceMeters ?? Number.POSITIVE_INFINITY) < (best.store.summary.distanceMeters ?? Number.POSITIVE_INFINITY) ||
          ((store.summary.distanceMeters ?? Number.POSITIVE_INFINITY) === (best.store.summary.distanceMeters ?? Number.POSITIVE_INFINITY) &&
            compareText(store.summary.id, best.store.summary.id) < 0)));
    if (better) best = { store, product, baselineLines };
  }
  if (!best) return null;
  const productCost = decimalOf(best.product).round(MONEY_SCALE);
  const visitCost = DecimalValue.parse(settings.storeVisitPenalty).round(MONEY_SCALE);
  const distanceCost = decimalOf(best.store.distancePenalty).round(MONEY_SCALE);
  return {
    method: 'SINGLE_STORE_REGULAR_PRICES',
    storeId: best.store.summary.id,
    storeName: best.store.summary.name,
    productCost: productCost.toFixed(MONEY_SCALE),
    storeVisitPenaltyCost: visitCost.toFixed(MONEY_SCALE),
    distancePenaltyCost: distanceCost.toFixed(MONEY_SCALE),
    effectiveCost: productCost.add(visitCost).add(distanceCost).toFixed(MONEY_SCALE),
    lines: best.baselineLines,
  };
}

function buildLimitations(
  input: PlanCandidates,
  method: OptimizationMethod,
  lines: readonly PlanLine[],
  visits: readonly PlanVisit[],
  coverage: PlanCoverage,
  baseline: PlanBaseline | null,
  chosen: readonly Choice[],
): PlanLimitation[] {
  const limitations: PlanLimitation[] = [];
  const add = (code: PlanLimitation['code'], message: string) => limitations.push({ code, message });
  if (lines.length) {
    add('PRICES_ARE_ESTIMATES', 'Los importes usan el último precio observado de cada sucursal: pueden cambiar al momento de comprar.');
  }
  if (visits.some((visit) => visit.roundTripKm !== null)) {
    add('DISTANCE_IS_ESTIMATE', 'La distancia es ida y vuelta en línea recta desde tu ubicación, por visita: no es un recorrido real.');
  }
  if (visits.some((visit) => visit.roundTripKm === null)) {
    add('DISTANCE_UNKNOWN', 'Sin tu ubicación exacta no calculamos distancias y no sumamos penalidad por kilómetro.');
  }
  const trimmed =
    input.candidates.stores.trimmed.length > 0 ||
    input.candidates.dates.trimmed.length > 0 ||
    input.candidates.needs.some((need) => need.exclusions.some((exclusion) => exclusion.reason === 'OFFER_LIMIT' || exclusion.reason === 'STORE_LIMIT'));
  if (trimmed) {
    add('CANDIDATES_TRIMMED', 'Se evaluó un conjunto acotado de sucursales, ofertas y fechas: puede haber opciones fuera de él.');
  }
  if (method === 'HEURISTIC') {
    add('SEARCH_BUDGET_EXCEEDED', 'Había demasiadas combinaciones para revisarlas todas: el plan es una buena opción, no necesariamente la mejor.');
  }
  if (coverage === 'PARTIAL') add('PARTIAL_PLAN', 'Hay productos que no pudimos incluir: figuran como faltantes.');
  if (!baseline && lines.length) {
    add('NO_BASELINE', 'Ninguna sucursal tiene todos los productos del plan: no hay con qué comparar y no mostramos ahorro.');
  }
  const skipped = new Set(chosen.flatMap((choice) => choice.option.promotions.map((check) => check.skipReason)));
  if (skipped.has('MINIMUM_SPEND_UNKNOWN')) {
    add('MINIMUM_SPEND_NOT_EVALUATED', 'Las promociones con mínimo de compra no se aplicaron: no están incluidas en los importes.');
  }
  if (skipped.has('PAYMENT_CONDITIONED') || skipped.has('MEMBERSHIP_CONDITIONED')) {
    add('PAYMENT_PROMOTIONS_EXCLUDED', 'Las promociones con banco, medio de pago o membresía no se aplicaron.');
  }
  return limitations;
}

export function optimizePlan(input: PlanCandidates, settings: OptimizerSettings): OptimizedPlan {
  assertSettings(settings);
  const needsById = new Map(input.needs.map((need) => [need.canonicalProductId, need]));
  const resolved: ResolvedNeed[] = input.candidates.needs
    .filter((candidates) => candidates.offers.length > 0)
    .map((candidates) => ({ need: needsById.get(candidates.canonicalProductId) as PlanNeed, candidates }))
    .filter((entry) => Boolean(entry.need));

  const search = new Search(resolved, input.candidates.stores.kept, input.candidates.dates.evaluated, settings);
  const exactCombinations = countCombinations(
    search.stores.map((store) => 2 ** store.dates.length - 1),
    search.maxStores,
  );

  let method: OptimizationMethod = 'NO_CANDIDATES';
  let best: Evaluation | null = null;
  if (resolved.length && search.stores.length) {
    if (exactCombinations <= settings.maxCombinations) {
      method = 'EXACT_BOUNDED';
      best = search.enumerate(search.stores.map((_, store) => search.dateSubsets(store)));
    } else {
      method = 'HEURISTIC';
      const singles = search.stores.map((_, store) => [[search.bestSingleDate(store)]]);
      best = countCombinations(singles.map(() => 1), search.maxStores) <= settings.maxCombinations
        ? search.enumerate(singles)
        : search.greedy();
    }
  }

  const chosen: Choice[] = [];
  const lines: PlanLine[] = [];
  const unfulfilled: UnfulfilledNeed[] = [];
  const unfulfill = (need: PlanNeed, reason: UnfulfilledNeed['reason']) =>
    unfulfilled.push({
      canonicalProductId: need.canonicalProductId,
      canonicalName: need.canonicalName,
      netQuantity: need.netQuantity,
      unit: need.unit,
      reason,
    });
  const resolvedIndex = new Map(resolved.map((entry, index) => [entry.need.canonicalProductId, index]));
  for (const candidates of input.candidates.needs) {
    const need = needsById.get(candidates.canonicalProductId);
    if (!need) continue;
    const index = resolvedIndex.get(candidates.canonicalProductId);
    const choice = index === undefined ? null : best?.choices[index] ?? null;
    if (choice && index !== undefined) {
      chosen.push(choice);
      lines.push(buildLine(resolved[index] as ResolvedNeed, choice));
    } else {
      unfulfill(need, candidates.unresolvedReason ?? 'MAX_STORES_LIMIT');
    }
  }

  const visits = buildVisits(lines, search.stores);
  const totals = buildTotals(lines, visits, search.stores, settings);
  const toBuy = input.needs.filter((need) => need.status !== 'COVERED_BY_INVENTORY');
  const coverage: PlanCoverage = !toBuy.length ? 'EMPTY' : unfulfilled.length ? 'PARTIAL' : 'COMPLETE';
  const baseline = lines.length ? buildBaseline(lines, resolved, search.stores, settings) : null;
  const baselineUnavailableReason: BaselineUnavailableReason | null = baseline
    ? null
    : lines.length
      ? 'NO_SINGLE_STORE_COVERS_PLAN'
      : 'NOTHING_TO_BUY';
  const coveredByInventory: CoveredByInventory[] = input.needs
    .filter((need) => need.status === 'COVERED_BY_INVENTORY')
    .map((need) => ({
      canonicalProductId: need.canonicalProductId,
      canonicalName: need.canonicalName,
      grossQuantity: need.grossQuantity,
      unit: need.unit,
      inventory: need.inventory,
    }));

  return {
    optimizerVersion: OPTIMIZER_VERSION,
    coverage,
    settings,
    locationOrigin: input.scope.origin,
    search: {
      method,
      exactCombinations,
      evaluatedCombinations: search.evaluated,
      maxCombinations: settings.maxCombinations,
      storesConsidered: search.stores.length,
      datesPerStore: Object.fromEntries(search.stores.map((store) => [store.summary.id, [...store.dates]])),
    },
    lines,
    visits,
    totals,
    baseline,
    baselineUnavailableReason,
    savings: baseline
      ? {
          estimatedSavings: DecimalValue.parse(baseline.productCost).subtract(DecimalValue.parse(totals.productCost)).toFixed(MONEY_SCALE),
          effectiveCostDifference: DecimalValue.parse(baseline.effectiveCost)
            .subtract(DecimalValue.parse(totals.effectiveCost))
            .toFixed(MONEY_SCALE),
        }
      : null,
    unfulfilled,
    coveredByInventory,
    limitations: buildLimitations(input, method, lines, visits, coverage, baseline, chosen),
  };
}
