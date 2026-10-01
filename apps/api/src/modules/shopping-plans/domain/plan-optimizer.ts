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
 *
 * P10-02 (ADR 0024): con un contexto de beneficios (reglas, preferencias declaradas y topes
 * informados) cada visita se cobra como una compra con el motor de ADR 0023. Si ninguna regla
 * cambia el costo de la suma de líneas, el resultado es el de arriba; si alguna lo cambia, la
 * canasta se busca en `plan-benefits.ts` y los importes salen del motor.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { BenefitEngineResult, BenefitEvaluation, PurchaseResult } from '../../promotions/domain/benefit-engine';
import type { PaymentMethod, PromotionRule } from '../../promotions/domain/promotion.types';
import type { CalendarDate } from '../../routines/domain/routine-rules';
import { compareText } from './needs';
import { OPTIMIZER_VERSION } from './optimized-plan.types';
import type {
  BaselineUnavailableReason,
  BenefitConditions,
  CoveredByInventory,
  LineAlternative,
  LineReasonCode,
  OptimizationMethod,
  OptimizedPlan,
  OptimizerSettings,
  PlanBaseline,
  PlanBenefitNote,
  PlanBenefitsSummary,
  PlanCoverage,
  PlanLimitation,
  PlanLine,
  PlanTotals,
  PlanVisit,
  SearchSummary,
  UnfulfilledNeed,
} from './optimized-plan.types';
import { BasketEvaluator, costRelevantRules, purchaseIdOf, searchBaskets } from './plan-benefits';
import type { BasketStore, PlanBenefitContext } from './plan-benefits';
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

/** Cada oferta en cada fecha evaluada: el espacio completo de la canasta con beneficios. */
function allChoicesOf(entry: ResolvedNeed, storeIds: ReadonlySet<string>, dates: ReadonlySet<CalendarDate>): Choice[] {
  return entry.candidates.offers
    .filter((offer) => storeIds.has(offer.storeId))
    .flatMap((offer) =>
      offer.dateOptions.filter((option) => dates.has(option.date)).map((option) => ({ offer, option, total: units(option.total) })),
    )
    .sort(compareChoices);
}

/** Importes de una línea cobrada por el motor (P10-02) en lugar de `priceLine`. */
interface PricedLine {
  readonly regularTotal: string;
  readonly total: string;
  readonly discount: string;
  readonly promotion: { readonly id: string; readonly name: string } | null;
}

function buildLine(entry: ResolvedNeed, choice: Choice, priced: PricedLine | null, basketChoice: boolean): PlanLine {
  const { need } = entry;
  const { offer, option } = choice;
  const total = priced ? units(priced.total) : choice.total;
  const alternatives: LineAlternative[] = optionsOf(entry)
    .filter((candidate) => !(candidate.offer.id === offer.id && candidate.option.date === option.date))
    .slice(0, MAX_ALTERNATIVES)
    .map((candidate) => ({
      offerId: candidate.offer.id,
      productName: candidate.offer.productName,
      storeName: candidate.offer.storeName,
      date: candidate.option.date,
      total: candidate.option.total,
      difference: moneyOf(candidate.total - total),
    }));
  const cheaper = alternatives.find((alternative) => DecimalValue.parse(alternative.difference).isNegative());
  const linePromotion = option.appliedPromotionId
    ? option.promotions.find((check) => check.promotionId === option.appliedPromotionId) ?? null
    : null;
  const promotion = priced
    ? priced.promotion
    : linePromotion
      ? { id: linePromotion.promotionId, name: linePromotion.name }
      : null;

  const codes: LineReasonCode[] = [cheaper ? 'CHEAPER_OPTION_NOT_WORTH_IT' : 'CHEAPEST_EVALUATED'];
  const sentences = [
    cheaper
      ? `En ${cheaper.storeName} el ${formatDate(cheaper.date)} cuesta ${formatArs(DecimalValue.parse(cheaper.difference))} menos, pero sumar esa visita no conviene o supera tu máximo de sucursales.`
      : 'Es la opción más barata entre las sucursales y fechas evaluadas.',
  ];
  if (basketChoice) {
    codes.push('BASKET_BENEFIT_CHOICE');
    sentences.push('Hay una opción más barata en otra compra del plan, pero llevarlo en esta suma al beneficio de pago o al mínimo de esta compra.');
  }
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
    regularTotal: priced ? priced.regularTotal : offer.regularTotal,
    total: priced ? priced.total : option.total,
    discount: priced ? priced.discount : option.discount,
    promotion,
    reasonCodes: codes,
    reason: sentences.join(' '),
    alternatives,
  };
}

/** Condiciones de una regla tal como se muestran: nada de la regla queda oculto. */
export function conditionsOf(rule: PromotionRule): BenefitConditions {
  return {
    type: rule.type,
    discountPercentage: rule.discountPercentage,
    discountAmount: rule.discountAmount,
    paymentMethod: rule.paymentMethod,
    bank: rule.bank,
    membershipProgram: rule.membershipProgram,
    eligibleWeekdays: [...rule.eligibleWeekdays],
    minimumSpend: rule.minimumSpend,
    discountCap: rule.discountCap,
    capPeriod: rule.capPeriod,
    timing: rule.benefitTiming,
    refundDelayDays: rule.refundDelayDays,
    stackable: rule.isStackable,
  };
}

/** Lo que el motor dijo de una compra: el pago aplicado y lo que no se sumó, con su motivo. */
interface PurchaseBenefits {
  readonly result: PurchaseResult;
  readonly evaluations: readonly BenefitEvaluation[];
}

function buildVisits(
  lines: readonly PlanLine[],
  stores: readonly StoreEntry[],
  purchases: ReadonlyMap<string, PurchaseBenefits> | null,
  rulesById: ReadonlyMap<string, PromotionRule>,
): PlanVisit[] {
  const byId = new Map(stores.map((store) => [store.summary.id, store]));
  const grouped = new Map<string, PlanLine[]>();
  for (const line of lines) {
    const key = purchaseIdOf(line.date, line.storeId);
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, visitLines]) => {
      const first = visitLines[0] as PlanLine;
      const store = byId.get(first.storeId) as StoreEntry;
      const subtotal = visitLines.reduce((sum, line) => sum + units(line.total), 0n);
      const benefits = purchases?.get(key) ?? null;
      const applied = benefits?.evaluations.find((evaluation) => evaluation.layer === 'PAYMENT' && evaluation.status === 'APPLIED') ?? null;
      const payment = benefits?.result.payment ?? null;
      const rule = payment ? rulesById.get(payment.promotionId) : undefined;
      const notes: PlanBenefitNote[] = [];
      for (const evaluation of benefits?.evaluations ?? []) {
        const noteRule = rulesById.get(evaluation.promotionId);
        if (!noteRule || evaluation.status === 'APPLIED') continue;
        // De la capa de producto solo importa lo condicionado: el resto ya explica la línea.
        if (evaluation.layer === 'PRODUCT' && evaluation.status !== 'CONDITIONAL') continue;
        notes.push({
          promotionId: evaluation.promotionId,
          name: evaluation.name,
          layer: evaluation.layer,
          canonicalProductId: evaluation.layer === 'PRODUCT' ? evaluation.lineId : null,
          status: evaluation.status,
          reason: evaluation.reason,
          amount: evaluation.amount,
          conditions: conditionsOf(noteRule),
          cap: evaluation.cap,
        });
      }
      const paymentDiscount = benefits ? units(benefits.result.paymentDiscount) : 0n;
      return {
        storeId: first.storeId,
        storeName: first.storeName,
        chainName: first.chainName,
        date: first.date,
        distanceMeters: store.summary.distanceMeters,
        roundTripKm: store.roundTripKm ? store.roundTripKm.toFixed(KM_SCALE) : null,
        lineCount: visitLines.length,
        subtotal: moneyOf(subtotal),
        paymentDiscount: moneyOf(paymentDiscount),
        payToday: moneyOf(subtotal - paymentDiscount),
        refundEstimated: benefits ? benefits.result.refundEstimated : '0.00',
        payment: payment && rule
          ? {
              promotionId: payment.promotionId,
              name: payment.name,
              timing: payment.timing,
              refundDelayDays: payment.refundDelayDays,
              base: payment.base,
              amount: payment.amount,
              conditions: conditionsOf(rule),
              cap: applied?.cap ?? null,
            }
          : null,
        benefitNotes: notes,
      };
    });
}

function buildTotals(
  lines: readonly PlanLine[],
  visits: readonly PlanVisit[],
  stores: readonly StoreEntry[],
  settings: OptimizerSettings,
  conditionalAmount: string,
): PlanTotals {
  const byId = new Map(stores.map((store) => [store.summary.id, store]));
  const product = lines.reduce((sum, line) => sum + units(line.total), 0n);
  const regular = lines.reduce((sum, line) => sum + units(line.regularTotal), 0n);
  const payment = visits.reduce((sum, visit) => sum + units(visit.paymentDiscount), 0n);
  const refund = visits.reduce((sum, visit) => sum + units(visit.refundEstimated), 0n);
  const visitPenalty = units(settings.storeVisitPenalty) * BigInt(visits.length);
  const distancePenalty = visits.reduce((sum, visit) => sum + (byId.get(visit.storeId)?.distancePenalty ?? 0n), 0n);
  // Cada componente se redondea una vez a centavos y el efectivo es su suma: cierra con el CHECK de la tabla.
  const productCost = decimalOf(product).round(MONEY_SCALE);
  const payToday = decimalOf(product - payment).round(MONEY_SCALE);
  const costAfterRefund = decimalOf(product - payment - refund).round(MONEY_SCALE);
  const visitCost = decimalOf(visitPenalty).round(MONEY_SCALE);
  const distanceCost = decimalOf(distancePenalty).round(MONEY_SCALE);
  const allKnown = visits.every((visit) => visit.roundTripKm !== null);
  const km = visits.reduce((sum, visit) => sum.add(DecimalValue.parse(visit.roundTripKm ?? '0')), DecimalValue.zero(KM_SCALE));
  return {
    productCost: productCost.toFixed(MONEY_SCALE),
    regularProductCost: moneyOf(regular),
    promotionDiscount: moneyOf(regular - product),
    paymentDiscount: moneyOf(payment),
    payToday: payToday.toFixed(MONEY_SCALE),
    refundEstimated: moneyOf(refund),
    costAfterRefund: costAfterRefund.toFixed(MONEY_SCALE),
    conditionalAmount,
    visitCount: visits.length,
    storeCount: new Set(visits.map((visit) => visit.storeId)).size,
    storeVisitPenaltyCost: visitCost.toFixed(MONEY_SCALE),
    distancePenaltyCost: distanceCost.toFixed(MONEY_SCALE),
    effectiveCost: payToday.add(visitCost).add(distanceCost).toFixed(MONEY_SCALE),
    effectiveCostAfterRefund: costAfterRefund.add(visitCost).add(distanceCost).toFixed(MONEY_SCALE),
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

interface SearchOutcome {
  readonly method: OptimizationMethod;
  /** El presupuesto obligó a achicar la búsqueda de visitas o de canastas. */
  readonly budgetExceeded: boolean;
  readonly basketSearch: SearchSummary['basketSearch'];
}

function buildLimitations(
  input: PlanCandidates,
  outcome: SearchOutcome,
  lines: readonly PlanLine[],
  visits: readonly PlanVisit[],
  coverage: PlanCoverage,
  baseline: PlanBaseline | null,
  totals: PlanTotals,
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
  if (outcome.budgetExceeded) {
    add('SEARCH_BUDGET_EXCEEDED', 'Había demasiadas combinaciones para revisarlas todas: el plan es una buena opción, no necesariamente la mejor.');
  }
  if (outcome.basketSearch === 'LOCAL_SEARCH') {
    add('BASKET_BENEFITS_APPROXIMATED', 'Los beneficios que dependen del total de cada compra se evaluaron sobre las combinaciones más prometedoras: puede existir una mejor.');
  }
  if (coverage === 'PARTIAL') add('PARTIAL_PLAN', 'Hay productos que no pudimos incluir: figuran como faltantes.');
  if (!baseline && lines.length) {
    add('NO_BASELINE', 'Ninguna sucursal tiene todos los productos del plan: no hay con qué comparar y no mostramos ahorro.');
  }
  if (outcome.basketSearch === null) {
    // Sin evaluación por canasta: lo que depende de la compra entera o de la persona no se aplicó.
    const skipped = new Set(chosen.flatMap((choice) => choice.option.promotions.map((check) => check.skipReason)));
    if (skipped.has('MINIMUM_SPEND_UNKNOWN')) {
      add('MINIMUM_SPEND_NOT_EVALUATED', 'Las promociones con mínimo de compra no se aplicaron: no están incluidas en los importes.');
    }
    if (skipped.has('PAYMENT_CONDITIONED') || skipped.has('MEMBERSHIP_CONDITIONED')) {
      add('PAYMENT_PROMOTIONS_EXCLUDED', 'Las promociones con banco, medio de pago o membresía no se aplicaron.');
    }
    return limitations;
  }
  if (DecimalValue.parse(totals.refundEstimated).isPositive()) {
    add(
      'REFUND_PENDING',
      `Incluye reintegros estimados por ${formatArs(DecimalValue.parse(totals.refundEstimated))}: en las cajas pagás ${formatArs(DecimalValue.parse(totals.payToday))} y el reintegro llega después. No se cuenta como ahorro.`,
    );
  }
  if (DecimalValue.parse(totals.conditionalAmount).isPositive()) {
    add(
      'BENEFITS_CONDITIONAL',
      `Hay beneficios que dependen de datos que no informaste (banco, medio de pago, membresía o lo usado de un tope): podrías ahorrar hasta ${formatArs(DecimalValue.parse(totals.conditionalAmount))} más, pero no está sumado.`,
    );
  }
  return limitations;
}

const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: 'efectivo',
  DEBIT_CARD: 'débito',
  CREDIT_CARD: 'crédito',
  TRANSFER: 'transferencia',
  WALLET: 'billetera virtual',
};

function buildBenefitsSummary(context: PlanBenefitContext, engine: BenefitEngineResult | null): PlanBenefitsSummary {
  const { payer } = context;
  const declared = payer.paymentMethods.length + payer.banks.length + payer.memberships.length > 0;
  const caps = engine?.caps ?? [];
  const parts = [
    payer.paymentMethods.length ? `medios de pago: ${payer.paymentMethods.map((method) => PAYMENT_METHOD_LABELS[method]).join(', ')}` : null,
    payer.banks.length ? `bancos y billeteras: ${payer.banks.join(', ')}` : null,
    payer.memberships.length ? `membresías: ${payer.memberships.join(', ')}` : null,
  ].filter((part): part is string => part !== null);
  const criteria = [
    declared
      ? `Usamos lo que declaraste en Preferencias (${parts.join('; ')}). Lo que no declaraste queda como condicionado y no se suma.`
      : 'No declaraste medios de pago, bancos ni membresías: los beneficios que dependen de eso figuran como condicionados y no se suman.',
    'Cada visita es una compra: se aplica un solo beneficio de pago, sobre los productos sin otra promoción (salvo que las dos sean acumulables).',
    'El plan elige las compras por lo que pagás después de los reintegros confirmados, más las penalidades de visitas y distancia. El ahorro estimado no incluye reintegros.',
  ];
  if (caps.some((cap) => !cap.periodKey.startsWith('purchase:'))) {
    criteria.push('Los topes por semana, mes o campaña se cuentan entre todas las compras del plan, en orden de fecha.');
  }
  if (caps.some((cap) => cap.consumedOutside === null)) {
    criteria.push('Sin lo que ya usaste de un tope en el período, ese beneficio queda condicionado: podés informarlo en Preferencias.');
  }
  return { payer: { ...payer, declared }, caps, criteria };
}

export function optimizePlan(input: PlanCandidates, settings: OptimizerSettings, benefits?: PlanBenefitContext): OptimizedPlan {
  assertSettings(settings);
  if (benefits && (!Number.isInteger(benefits.maxEvaluations) || benefits.maxEvaluations < 1)) {
    throw new RangeError('maxEvaluations debe ser un entero positivo.');
  }
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

  // Canasta por visita con el motor de beneficios (P10-02).
  let assignment: readonly (Choice | null)[] = resolved.map((_, index) => best?.choices[index] ?? null);
  let engine: BenefitEngineResult | null = null;
  let outcome: SearchOutcome = { method, budgetExceeded: method === 'HEURISTIC', basketSearch: null };
  let basketEvaluations = 0;
  if (benefits && best) {
    const stores: BasketStore[] = search.stores.map((store) => ({
      id: store.summary.id,
      chainId: store.summary.chainId,
      visitCost: store.visitCost,
      kmUnits: store.roundTripKm ? units(store.roundTripKm) : 0n,
    }));
    const needIds = resolved.map((entry) => entry.need.canonicalProductId);
    if (!costRelevantRules(benefits.rules, benefits.payer).length) {
      // Ninguna regla cambia la suma de líneas: el plan de arriba es el de la canasta.
      engine = new BasketEvaluator(stores, benefits).evaluate(assignment, needIds).result;
      basketEvaluations = 1;
      outcome = { ...outcome, basketSearch: 'NOT_NEEDED' };
    } else {
      const storeIds = new Set(stores.map((store) => store.id));
      const dates = new Set(input.candidates.dates.evaluated);
      const found = searchBaskets({
        needIds,
        options: resolved.map((entry) => allChoicesOf(entry, storeIds, dates)),
        stores,
        dates: input.candidates.dates.evaluated,
        maxStores: search.maxStores,
        seed: assignment,
        context: benefits,
      });
      assignment = found.best.choices as readonly (Choice | null)[];
      engine = found.best.result;
      basketEvaluations = found.evaluations;
      outcome = found.method === 'EXHAUSTIVE'
        ? { method: 'EXACT_BOUNDED', budgetExceeded: false, basketSearch: 'EXHAUSTIVE' }
        : { method: 'HEURISTIC', budgetExceeded: method === 'HEURISTIC' || found.budgetExceeded, basketSearch: 'LOCAL_SEARCH' };
    }
  } else if (benefits) {
    outcome = { ...outcome, basketSearch: 'NOT_NEEDED' };
  }

  const rulesById = new Map((benefits?.rules ?? []).map((rule) => [rule.id, rule]));
  const purchases = engine
    ? new Map(
        engine.purchases.map((result) => [
          result.purchaseId,
          { result, evaluations: (engine as BenefitEngineResult).evaluations.filter((evaluation) => evaluation.purchaseId === result.purchaseId) },
        ]),
      )
    : null;
  const pricedLine = (choice: Choice, canonicalProductId: string): PricedLine | null => {
    const purchase = purchases?.get(purchaseIdOf(choice.option.date, choice.offer.storeId));
    const line = purchase?.result.lines.find((entry) => entry.lineId === canonicalProductId);
    if (!line) return null;
    const rule = line.productPromotionId ? rulesById.get(line.productPromotionId) : undefined;
    return {
      regularTotal: line.regularTotal,
      total: line.total,
      discount: line.productDiscount,
      promotion: line.productPromotionId ? { id: line.productPromotionId, name: rule?.name ?? line.productPromotionId } : null,
    };
  };
  const planVisits = new Set(assignment.flatMap((choice) => (choice ? [purchaseIdOf(choice.option.date, choice.offer.storeId)] : [])));

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
    const choice = index === undefined ? null : assignment[index] ?? null;
    if (choice && index !== undefined) {
      const entry = resolved[index] as ResolvedNeed;
      // Más cara que otra opción de las mismas visitas del plan: la eligió la canasta, no la línea.
      const basketChoice = outcome.basketSearch !== null && outcome.basketSearch !== 'NOT_NEEDED' &&
        entry.candidates.offers.some((offer) =>
          offer.dateOptions.some((option) => planVisits.has(purchaseIdOf(option.date, offer.storeId)) && units(option.total) < choice.total),
        );
      chosen.push(choice);
      lines.push(buildLine(entry, choice, pricedLine(choice, need.canonicalProductId), basketChoice));
    } else {
      unfulfill(need, candidates.unresolvedReason ?? 'MAX_STORES_LIMIT');
    }
  }

  const visits = buildVisits(lines, search.stores, purchases, rulesById);
  const totals = buildTotals(lines, visits, search.stores, settings, engine?.totals.conditionalAmount ?? '0.00');
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
      method: outcome.method,
      exactCombinations,
      evaluatedCombinations: search.evaluated,
      maxCombinations: settings.maxCombinations,
      storesConsidered: search.stores.length,
      datesPerStore: Object.fromEntries(search.stores.map((store) => [store.summary.id, [...store.dates]])),
      basketSearch: outcome.basketSearch,
      basketEvaluations,
      maxBasketEvaluations: benefits?.maxEvaluations ?? null,
    },
    lines,
    visits,
    totals,
    baseline,
    baselineUnavailableReason,
    savings: baseline
      ? {
          // Solo lo que no se paga en la caja: los reintegros no son ahorro (ADR 0024).
          estimatedSavings: DecimalValue.parse(baseline.productCost).subtract(DecimalValue.parse(totals.payToday)).toFixed(MONEY_SCALE),
          effectiveCostDifference: DecimalValue.parse(baseline.effectiveCost)
            .subtract(DecimalValue.parse(totals.effectiveCost))
            .toFixed(MONEY_SCALE),
        }
      : null,
    unfulfilled,
    coveredByInventory,
    limitations: buildLimitations(input, outcome, lines, visits, coverage, baseline, totals, chosen),
    benefits: benefits ? buildBenefitsSummary(benefits, engine) : null,
  };
}
