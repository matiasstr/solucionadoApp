/**
 * Beneficios de pago en el plan (P10-02, ADR 0024). Función pura sobre los candidatos de P5-01.
 *
 * Una visita del plan es una **compra** para el motor de beneficios (ADR 0023): el costo de un
 * plan ya no es la suma de líneas sueltas, porque un beneficio de pago, una compra mínima o un
 * tope compartido dependen de la canasta entera y de las otras visitas. Acá se evalúan
 * **asignaciones completas** (cada necesidad → oferta y fecha) con `evaluateBenefits`:
 *
 * - `costo efectivo después del reintegro = Σ costAfterRefund + penalidades de visitas y km`.
 *   Solo cuenta lo aplicado (elegible y con tope conocido); lo condicionado se informa aparte.
 * - **Exhaustivo** cuando todas las asignaciones entran en el presupuesto de evaluaciones: el
 *   óptimo entre los candidatos acotados, igual que `EXACT_BOUNDED` (ADR 0014).
 * - Si no, **búsqueda local determinista**: conjuntos de visitas (fechas agrupadas por igual
 *   precio y beneficios), asignación golosa con la tasa de pago de cada visita, y mejoras de a
 *   una necesidad sobre los mejores conjuntos. Nunca peor que el plan por líneas evaluado igual.
 *
 * El presupuesto es de evaluaciones del motor, no de tiempo: el mismo pedido da el mismo plan.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import { capPeriodKey, evaluateBenefits } from '../../promotions/domain/benefit-engine';
import type { BenefitEngineResult, BenefitPurchase, CapUsageEntry } from '../../promotions/domain/benefit-engine';
import { payerEligibility } from '../../promotions/domain/payer-eligibility';
import type { PayerProfile } from '../../promotions/domain/payer-eligibility';
import { argentineIsoWeekday, isWithinValidity } from '../../promotions/domain/promotion-eligibility';
import type { PromotionRule } from '../../promotions/domain/promotion.types';
import type { CalendarDate } from '../../routines/domain/routine-rules';
import { compareText } from './needs';
import { argentineNoon } from './plan-calendar';
import type { CandidateDateOption, CandidateOffer } from './planner.types';

const UNIT_SCALE = 5;
/** Tasa de pago en puntos básicos (1 % = 100) para ordenar la asignación golosa. */
const BASIS_POINTS = 10_000n;
/** Conjuntos de visitas que reciben mejoras de a una necesidad. */
const LOCAL_SEARCH_SEEDS = 4;

const units = (value: string | DecimalValue): bigint => DecimalValue.parse(value).round(UNIT_SCALE).units;
const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** Lo que el plan necesita para cobrar canastas: reglas, preferencias declaradas y topes informados. */
export interface PlanBenefitContext {
  /** Todas las promociones vigentes de la ventana que alcanzan a las sucursales candidatas. */
  readonly rules: readonly PromotionRule[];
  readonly payer: PayerProfile;
  readonly capUsage: readonly CapUsageEntry[];
  /** Evaluaciones del motor permitidas antes de pasar al método aproximado. */
  readonly maxEvaluations: number;
}

/**
 * Una regla que `priceLine` (P5-01) cobra igual que el motor: sin condición de pago, sin mínimo
 * y sin tope. Con ellas el costo es la suma de líneas y alcanza la búsqueda de P5-02.
 */
export const isLineVerifiable = (rule: PromotionRule): boolean =>
  rule.type !== 'BANK_DISCOUNT' &&
  rule.bank === null &&
  rule.paymentMethod === null &&
  rule.membershipProgram === null &&
  rule.minimumSpend === null &&
  rule.discountCap === null &&
  rule.capPeriod === null;

/**
 * Reglas que pueden cambiar el costo de una canasta respecto de la suma de líneas: las que el
 * motor podría aplicar a esta persona y `priceLine` no. Lo condicionado no cambia el costo.
 */
export const costRelevantRules = (rules: readonly PromotionRule[], payer: PayerProfile): PromotionRule[] =>
  rules.filter((rule) => !isLineVerifiable(rule) && payerEligibility(rule, payer).status === 'ELIGIBLE');

/** Una opción de compra de una necesidad: oferta, fecha y total de la línea (1e-5 ARS). */
export interface BasketChoice {
  readonly offer: CandidateOffer;
  readonly option: CandidateDateOption;
  readonly total: bigint;
}

export interface BasketStore {
  readonly id: string;
  readonly chainId: string;
  /** Penalidad completa de una visita (visita + distancia), en 1e-5 ARS. */
  readonly visitCost: bigint;
  /** Ida y vuelta en 1e-5 km; 0 si se desconoce. */
  readonly kmUnits: bigint;
}

export interface BasketOutcome {
  readonly choices: readonly (BasketChoice | null)[];
  /** `storeId|fecha` ordenadas: el desempate final las compara una a una. */
  readonly visitKeys: readonly string[];
  readonly uncovered: number;
  /** Costo después del reintegro aplicado + penalidades, en 1e-5 ARS. */
  readonly effective: bigint;
  readonly kmUnits: bigint;
  readonly result: BenefitEngineResult;
  /** Elecciones como texto: último desempate, determinista. */
  readonly tieKey: string;
}

/** Id de compra para el motor: la visita, con la fecha primero (el motor ordena por instante). */
export const purchaseIdOf = (date: CalendarDate, storeId: string): string => `${date}|${storeId}`;

const visitKeyOf = (choice: BasketChoice): string => `${choice.offer.storeId}|${choice.option.date}`;

/** Orden lexicográfico: cobertura, costo después del reintegro, visitas, km, visitas y elecciones. */
export function compareOutcomes(a: BasketOutcome, b: BasketOutcome): number {
  const byCost =
    a.uncovered - b.uncovered ||
    compareBig(a.effective, b.effective) ||
    a.visitKeys.length - b.visitKeys.length ||
    compareBig(a.kmUnits, b.kmUnits);
  if (byCost) return byCost;
  for (let index = 0; index < a.visitKeys.length; index += 1) {
    const difference = compareText(a.visitKeys[index] as string, b.visitKeys[index] as string);
    if (difference) return difference;
  }
  return compareText(a.tieKey, b.tieKey);
}

/** Cobra asignaciones completas con el motor de beneficios y cuenta las evaluaciones. */
export class BasketEvaluator {
  evaluations = 0;
  private readonly stores: ReadonlyMap<string, BasketStore>;

  constructor(
    stores: readonly BasketStore[],
    private readonly context: PlanBenefitContext,
  ) {
    this.stores = new Map(stores.map((store) => [store.id, store]));
  }

  get exhausted(): boolean {
    return this.evaluations >= this.context.maxEvaluations;
  }

  get remaining(): number {
    return Math.max(0, this.context.maxEvaluations - this.evaluations);
  }

  /** Compras del motor a partir de una asignación: una por visita, una línea por necesidad. */
  static purchasesOf(choices: readonly (BasketChoice | null)[], needIds: readonly string[]): BenefitPurchase[] {
    const byVisit = new Map<string, { date: CalendarDate; offer: CandidateOffer; lines: BenefitPurchase['lines'][number][] }>();
    choices.forEach((choice, index) => {
      if (!choice) return;
      const key = purchaseIdOf(choice.option.date, choice.offer.storeId);
      const entry = byVisit.get(key) ?? { date: choice.option.date, offer: choice.offer, lines: [] };
      entry.lines.push({
        lineId: needIds[index] as string,
        productId: choice.offer.productId,
        canonicalProductId: needIds[index] as string,
        unitPrice: choice.offer.priceBasis.price,
        quantity: choice.offer.purchase.units,
        saleMode: choice.offer.purchase.saleMode,
      });
      byVisit.set(key, entry);
    });
    return [...byVisit.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([purchaseId, entry]) => ({
        purchaseId,
        storeId: entry.offer.storeId,
        chainId: entry.offer.chainId,
        instant: argentineNoon(entry.date),
        lines: entry.lines,
      }));
  }

  evaluate(choices: readonly (BasketChoice | null)[], needIds: readonly string[]): BasketOutcome {
    this.evaluations += 1;
    const purchases = BasketEvaluator.purchasesOf(choices, needIds);
    const result = evaluateBenefits({
      purchases,
      rules: this.context.rules,
      payer: this.context.payer,
      capUsage: this.context.capUsage,
    });
    let effective = units(result.totals.costAfterRefund);
    let kmUnits = 0n;
    for (const purchase of purchases) {
      const store = this.stores.get(purchase.storeId);
      effective += store?.visitCost ?? 0n;
      kmUnits += store?.kmUnits ?? 0n;
    }
    const visitKeys = [...new Set(choices.flatMap((choice) => (choice ? [visitKeyOf(choice)] : [])))].sort(compareText);
    return {
      choices,
      visitKeys,
      uncovered: choices.filter((choice) => !choice).length,
      effective,
      kmUnits,
      result,
      tieKey: choices.map((choice) => (choice ? `${choice.offer.id}@${choice.option.date}` : '-')).join(','),
    };
  }
}

/** Cantidad de asignaciones completas (cada necesidad: una opción o ninguna), con tope para no desbordar. */
export function countAssignments(optionCounts: readonly number[], ceiling: number): number {
  let total = 1;
  for (const count of optionCounts) {
    total *= count + 1;
    if (total > ceiling) return Number.POSITIVE_INFINITY;
  }
  return total;
}

export interface BasketSearchInput {
  readonly needIds: readonly string[];
  /** Todas las opciones de cada necesidad, ordenadas por el desempate de líneas de P5-02. */
  readonly options: readonly (readonly BasketChoice[])[];
  /** Sucursales con ofertas, en orden de id. */
  readonly stores: readonly BasketStore[];
  readonly dates: readonly CalendarDate[];
  readonly maxStores: number;
  /** Plan por líneas de P5-02: siempre se evalúa, así el resultado nunca es peor. */
  readonly seed: readonly (BasketChoice | null)[];
  readonly context: PlanBenefitContext;
}

export type BasketSearchMethod = 'EXHAUSTIVE' | 'LOCAL_SEARCH';

export interface BasketSearchResult {
  readonly best: BasketOutcome;
  readonly method: BasketSearchMethod;
  /** El método aproximado tuvo que achicar los conjuntos de visitas evaluados. */
  readonly budgetExceeded: boolean;
  readonly evaluations: number;
}

/** Fecha comercial de una regla en una visita: vigencia y día, sin mirar a la persona ni al producto. */
function activeAt(rule: PromotionRule, instant: Date): boolean {
  return isWithinValidity(rule, instant) && (!rule.eligibleWeekdays.length || rule.eligibleWeekdays.includes(argentineIsoWeekday(instant)));
}

const commercialMatch = (rule: PromotionRule, store: BasketStore): boolean =>
  rule.storeId ? rule.storeId === store.id : rule.chainId === store.chainId;

export function searchBaskets(input: BasketSearchInput): BasketSearchResult {
  const evaluator = new BasketEvaluator(input.stores, input.context);
  const evaluate = (choices: readonly (BasketChoice | null)[]) => evaluator.evaluate(choices, input.needIds);
  const relevant = costRelevantRules(input.context.rules, input.context.payer);

  // ---------------------------------------------------------------- exhaustivo
  const assignments = countAssignments(input.options.map((options) => options.length), input.context.maxEvaluations);
  if (assignments <= input.context.maxEvaluations) {
    let best: BasketOutcome | null = null;
    const picked: (BasketChoice | null)[] = [];
    const storesUsed = new Map<string, number>();
    const walk = (index: number): void => {
      if (index === input.options.length) {
        const outcome = evaluate([...picked]);
        if (!best || compareOutcomes(outcome, best) < 0) best = outcome;
        return;
      }
      for (const choice of [null, ...(input.options[index] ?? [])]) {
        const storeId = choice?.offer.storeId;
        const used = storeId ? storesUsed.get(storeId) ?? 0 : 0;
        if (storeId && used === 0 && storesUsed.size >= input.maxStores) continue;
        if (storeId) storesUsed.set(storeId, used + 1);
        picked.push(choice);
        walk(index + 1);
        picked.pop();
        if (storeId) {
          if (used === 0) storesUsed.delete(storeId);
          else storesUsed.set(storeId, used);
        }
      }
    };
    walk(0);
    return { best: best as unknown as BasketOutcome, method: 'EXHAUSTIVE', budgetExceeded: false, evaluations: evaluator.evaluations };
  }

  // ---------------------------------------------------------------- aproximado
  // Tasa de pago estimada por visita (porcentaje elegible más alto) para la asignación golosa.
  const rateCache = new Map<string, bigint>();
  const rateAt = (store: BasketStore, date: CalendarDate): bigint => {
    const key = `${store.id}|${date}`;
    const cached = rateCache.get(key);
    if (cached !== undefined) return cached;
    const instant = argentineNoon(date);
    let rate = 0n;
    for (const rule of relevant) {
      if (rule.type !== 'BANK_DISCOUNT' || rule.discountPercentage === null) continue;
      if (!commercialMatch(rule, store) || !activeAt(rule, instant)) continue;
      const points = DecimalValue.parse(rule.discountPercentage).multiply(DecimalValue.parse('100')).round(0).units;
      if (points > rate) rate = points;
    }
    rateCache.set(key, rate);
    return rate;
  };
  const storesById = new Map(input.stores.map((store) => [store.id, store]));

  /** Por necesidad, la opción con menor total neto de la tasa de pago entre esas visitas. */
  const greedy = (visits: ReadonlySet<string>): (BasketChoice | null)[] =>
    input.options.map((options) => {
      let chosen: BasketChoice | null = null;
      let chosenKey = 0n;
      for (const choice of options) {
        if (!visits.has(visitKeyOf(choice))) continue;
        const store = storesById.get(choice.offer.storeId) as BasketStore;
        const key = choice.total * (BASIS_POINTS - rateAt(store, choice.option.date));
        if (!chosen || key < chosenKey) {
          chosen = choice;
          chosenKey = key;
        }
      }
      return chosen;
    });

  // Fechas útiles por sucursal: una por clase de igual oferta y mismos beneficios (con su período de tope).
  const datesByStore = input.stores.map((store) => {
    const seen = new Set<string>();
    const kept: CalendarDate[] = [];
    for (const date of input.dates) {
      const instant = argentineNoon(date);
      const offers = input.options.map((options) =>
        options
          .filter((choice) => choice.offer.storeId === store.id && choice.option.date === date)
          .map((choice) => `${choice.offer.id}:${choice.total}`)
          .join(';'),
      );
      if (offers.every((entry) => !entry)) continue;
      const rules = relevant
        .filter((rule) => commercialMatch(rule, store) && activeAt(rule, instant))
        .map((rule) => `${rule.id}@${capPeriodKey(rule, instant, 'visita')}`);
      const signature = `${offers.join('|')}#${rules.join(',')}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      kept.push(date);
    }
    return kept;
  });

  const ranked: BasketOutcome[] = [];
  const keep = (outcome: BasketOutcome) => {
    if (ranked.some((entry) => entry.tieKey === outcome.tieKey)) return;
    ranked.push(outcome);
    ranked.sort(compareOutcomes);
    if (ranked.length > LOCAL_SEARCH_SEEDS) ranked.pop();
  };
  keep(evaluate(input.seed));

  const visitSetsOf = (alternatives: readonly (readonly string[])[][]): void => {
    const chosen: string[] = [];
    const walk = (store: number, used: number): void => {
      if (store === alternatives.length) {
        if (used && !evaluator.exhausted) keep(evaluate(greedy(new Set(chosen))));
        return;
      }
      walk(store + 1, used);
      if (used >= input.maxStores) return;
      for (const visits of alternatives[store] ?? []) {
        chosen.push(...visits);
        walk(store + 1, used + 1);
        chosen.splice(chosen.length - visits.length, visits.length);
      }
    };
    walk(0, 0);
  };
  const subsets = (store: number): string[][] => {
    const dates = datesByStore[store] ?? [];
    const id = (input.stores[store] as BasketStore).id;
    const result: string[][] = [];
    for (let mask = 1; mask < 2 ** dates.length; mask += 1) {
      result.push(dates.filter((_, index) => mask & (2 ** index)).map((date) => `${id}|${date}`));
    }
    return result;
  };
  const combinations = (weights: readonly number[]): number => {
    const sums = [1, ...Array.from({ length: input.maxStores }, () => 0)];
    for (const weight of weights) {
      for (let size = input.maxStores; size >= 1; size -= 1) sums[size] = (sums[size] ?? 0) + (sums[size - 1] ?? 0) * weight;
    }
    return sums.slice(1).reduce((total, value) => total + value, 0);
  };

  // La mitad del presupuesto para elegir visitas; el resto para mejorar las mejores canastas.
  const visitBudget = Math.floor(evaluator.remaining / 2);
  let budgetExceeded = false;
  if (combinations(datesByStore.map((dates) => 2 ** dates.length - 1)) <= visitBudget) {
    visitSetsOf(input.stores.map((_, store) => subsets(store)));
  } else {
    budgetExceeded = true;
    // Una fecha por sucursal: la que mejor cobra lo que esa sucursal ofrece, sola.
    const singles = input.stores.map((store, index) => {
      let best: { date: CalendarDate; outcome: BasketOutcome } | null = null;
      for (const date of datesByStore[index] ?? []) {
        if (evaluator.evaluations >= visitBudget) break;
        const outcome = evaluate(greedy(new Set([`${store.id}|${date}`])));
        if (!best || compareOutcomes(outcome, best.outcome) < 0) best = { date, outcome };
      }
      return best ? [[`${store.id}|${best.date}`]] : [];
    });
    if (combinations(singles.map((entry) => entry.length)) <= Math.max(0, visitBudget - evaluator.evaluations)) {
      visitSetsOf(singles);
    } else {
      // Sumar de a una la sucursal que más mejora, hasta el máximo o sin mejora.
      let current = new Set<string>();
      let currentOutcome = evaluate(greedy(current));
      const used = new Set<number>();
      while (used.size < input.maxStores && !evaluator.exhausted) {
        let next: { store: number; visits: Set<string>; outcome: BasketOutcome } | null = null;
        for (const [store, entry] of singles.entries()) {
          if (used.has(store) || !entry.length || evaluator.exhausted) continue;
          const visits = new Set([...current, ...(entry[0] as string[])]);
          const outcome = evaluate(greedy(visits));
          if (compareOutcomes(outcome, currentOutcome) < 0 && (!next || compareOutcomes(outcome, next.outcome) < 0)) {
            next = { store, visits, outcome };
          }
        }
        if (!next) break;
        used.add(next.store);
        current = next.visits;
        currentOutcome = next.outcome;
        keep(currentOutcome);
      }
    }
  }

  // Mejoras de a una necesidad dentro de las visitas de cada canasta prometedora.
  for (const start of [...ranked]) {
    let current = start;
    const visits = new Set(start.visitKeys);
    while (!evaluator.exhausted) {
      let move: BasketOutcome | null = null;
      for (const [index, options] of input.options.entries()) {
        for (const choice of options) {
          if (evaluator.exhausted) break;
          const currentChoice = current.choices[index];
          if (!visits.has(visitKeyOf(choice))) continue;
          if (currentChoice && currentChoice.offer.id === choice.offer.id && currentChoice.option.date === choice.option.date) continue;
          const choices = [...current.choices];
          choices[index] = choice;
          const outcome = evaluate(choices);
          if (compareOutcomes(outcome, current) < 0 && (!move || compareOutcomes(outcome, move) < 0)) move = outcome;
        }
      }
      if (!move) break;
      current = move;
    }
    keep(current);
  }

  return { best: ranked[0] as BasketOutcome, method: 'LOCAL_SEARCH', budgetExceeded, evaluations: evaluator.evaluations };
}
