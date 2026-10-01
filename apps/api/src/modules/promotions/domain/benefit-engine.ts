/**
 * Motor de beneficios (P10-01, ADR 0023): cobra compras completas —no líneas sueltas— con las
 * preferencias de pago declaradas y los topes ya usados. Función pura y reproducible: mismas
 * entradas, mismo resultado y la misma explicación.
 *
 * Orden de cálculo de cada compra:
 * 1. Promociones del producto (`PERCENTAGE`, `SECOND_UNIT`, `TWO_FOR_ONE`, `FIXED_PRICE`): una
 *    por línea, la que más conviene (ADR 0009).
 * 2. Un beneficio de pago (`BANK_DISCOUNT`) por compra —se paga con un solo medio— sobre la base
 *    elegible: las líneas de su alcance, con su precio después del paso 1; una línea con promoción
 *    queda afuera salvo que **las dos** promociones se declaren acumulables.
 * 3. Compra mínima sobre esa base; porcentaje o monto fijo; tope.
 * 4. Redondeo HALF_UP a centavos una vez por importe.
 *
 * Topes: por compra, o compartidos por semana, mes o campaña entre ítems, compras y promociones
 * del mismo grupo (`capGroup`). Lo usado fuera de la app se informa; si no se informó, el saldo es
 * desconocido y el beneficio queda **condicionado**: se muestra, no se suma.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { SaleMode } from '../../catalog/domain/units';
import { argentineDate } from '../../prices/domain/price-analysis';
import { lineOutcome } from './promotion-calculator';
import { calendarOrScopeSkipReason, matchesTarget } from './promotion-eligibility';
import { payerEligibility } from './payer-eligibility';
import type { PayerProfile, PayerReason } from './payer-eligibility';
import type { BenefitTiming, PromotionRule, PromotionSkipReason, PromotionTarget, PromotionType } from './promotion.types';

const MONEY_SCALE = 2;
const WORK_SCALE = 6;
const HUNDRED = DecimalValue.parse('100');
const ZERO = DecimalValue.zero(MONEY_SCALE);

export interface BenefitLine {
  readonly lineId: string;
  readonly productId: string;
  readonly canonicalProductId: string | null;
  /** Precio por unidad de venta (envase o base de cotización). */
  readonly unitPrice: string;
  readonly quantity: string;
  readonly saleMode: SaleMode;
}

export interface BenefitPurchase {
  readonly purchaseId: string;
  readonly storeId: string;
  readonly chainId: string;
  /** Momento de la compra: vigencia, día de la semana y período del tope. */
  readonly instant: Date;
  readonly lines: readonly BenefitLine[];
}

/** Beneficio de un tope ya usado fuera de la app en un período, informado por la persona. */
export interface CapUsageEntry {
  readonly capKey: string;
  readonly periodKey: string;
  readonly consumed: string;
}

export type BenefitStatus = 'APPLIED' | 'NOT_CHOSEN' | 'CONDITIONAL' | 'NOT_ELIGIBLE';

export type BenefitReason =
  | PromotionSkipReason
  | PayerReason
  | 'CAP_REMAINING_UNKNOWN'
  | 'CAP_EXHAUSTED'
  | 'NOT_STACKABLE'
  | 'NO_ELIGIBLE_ITEMS'
  | 'BETTER_PROMOTION'
  | 'ONE_PAYMENT_BENEFIT_PER_PURCHASE';

export interface CapStatus {
  readonly key: string;
  readonly periodKey: string;
  readonly limit: string;
  /** Usado fuera de la app en el período; null = no se informó. */
  readonly consumedOutside: string | null;
  /** Usado en esta evaluación antes de esta promoción. */
  readonly usedBefore: string;
  /** Saldo antes de aplicar; null = desconocido. */
  readonly remaining: string | null;
}

export interface BenefitEvaluation {
  readonly promotionId: string;
  readonly name: string;
  readonly type: PromotionType;
  readonly layer: 'PRODUCT' | 'PAYMENT';
  readonly purchaseId: string;
  /** Línea a la que se refiere; null en un beneficio de pago (toda la compra). */
  readonly lineId: string | null;
  readonly status: BenefitStatus;
  readonly reason: BenefitReason | null;
  /** Aplicado (`APPLIED`), posible (`NOT_CHOSEN`, `CONDITIONAL`) o null si no corresponde. */
  readonly amount: string | null;
  readonly timing: BenefitTiming;
  readonly refundDelayDays: number | null;
  readonly cap: CapStatus | null;
}

export interface LineResult {
  readonly lineId: string;
  readonly regularTotal: string;
  readonly productPromotionId: string | null;
  readonly productDiscount: string;
  readonly total: string;
}

export interface PaymentResult {
  readonly promotionId: string;
  readonly name: string;
  readonly timing: BenefitTiming;
  readonly refundDelayDays: number | null;
  readonly base: string;
  readonly amount: string;
}

export interface PurchaseResult {
  readonly purchaseId: string;
  readonly regularTotal: string;
  readonly productDiscount: string;
  /** Descuento de pago en caja. */
  readonly paymentDiscount: string;
  /** Lo que se paga en la caja. */
  readonly payToday: string;
  /** Reintegro posterior estimado: no baja lo que se paga hoy. */
  readonly refundEstimated: string;
  readonly costAfterRefund: string;
  readonly lines: readonly LineResult[];
  readonly payment: PaymentResult | null;
}

export interface BenefitTotals {
  readonly regularTotal: string;
  readonly productDiscount: string;
  readonly paymentDiscount: string;
  readonly payToday: string;
  readonly refundEstimated: string;
  readonly costAfterRefund: string;
  /**
   * Beneficio extra posible si se confirmara lo que la persona no informó (banco, medio, tope):
   * no está sumado en los totales. Por línea y por compra cuenta el mejor, no la suma.
   */
  readonly conditionalAmount: string;
}

export interface BenefitEngineResult {
  readonly purchases: readonly PurchaseResult[];
  readonly totals: BenefitTotals;
  readonly evaluations: readonly BenefitEvaluation[];
  readonly caps: readonly { readonly key: string; readonly periodKey: string; readonly limit: string; readonly consumedOutside: string | null; readonly usedHere: string }[];
}

// ---------------------------------------------------------------- períodos y topes

/** Clave del tope: el grupo compartido o la promoción sola. */
export const capKeyOf = (rule: PromotionRule): string => (rule.capGroup ? `group:${rule.capGroup}` : `promotion:${rule.id}`);

/** Semana ISO (`2026-W40`) del día argentino. */
export function isoWeekKey(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const weekYear = utc.getUTCFullYear();
  const week = Math.ceil(((utc.getTime() - Date.UTC(weekYear, 0, 1)) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

/** Período del tope en el calendario argentino; un tope por compra es de esa compra. */
export function capPeriodKey(rule: PromotionRule, instant: Date, purchaseId: string): string {
  const date = argentineDate(instant);
  switch (rule.capPeriod) {
    case 'WEEK':
      return isoWeekKey(date);
    case 'MONTH':
      return date.slice(0, 7);
    case 'CAMPAIGN':
      return 'CAMPAIGN';
    default:
      return `purchase:${purchaseId}`;
  }
}

class CapLedger {
  private readonly outside = new Map<string, DecimalValue>();
  private readonly used = new Map<string, DecimalValue>();
  private readonly seen = new Map<string, { key: string; periodKey: string; limit: DecimalValue }>();

  constructor(usage: readonly CapUsageEntry[]) {
    for (const entry of usage) this.outside.set(`${entry.capKey}|${entry.periodKey}`, DecimalValue.parse(entry.consumed));
  }

  status(rule: PromotionRule, purchase: BenefitPurchase): CapStatus | null {
    if (!rule.discountCap || !rule.capPeriod) return null;
    const key = capKeyOf(rule);
    const periodKey = capPeriodKey(rule, purchase.instant, purchase.purchaseId);
    const id = `${key}|${periodKey}`;
    const limit = DecimalValue.parse(rule.discountCap);
    const known = this.seen.get(id);
    // Un grupo con topes distintos (dato inconsistente de la fuente) usa el menor.
    if (!known || limit.compare(known.limit) < 0) this.seen.set(id, { key, periodKey, limit });
    // Un tope por compra empieza en cero: no hay nada usado fuera de esta compra.
    const outside = rule.capPeriod === 'PURCHASE' ? ZERO : this.outside.get(id) ?? null;
    const used = this.used.get(id) ?? ZERO;
    const remaining = outside === null ? null : maxZero(limit.subtract(outside).subtract(used));
    return {
      key,
      periodKey,
      limit: limit.toFixed(MONEY_SCALE),
      consumedOutside: outside === null ? null : outside.toFixed(MONEY_SCALE),
      usedBefore: used.toFixed(MONEY_SCALE),
      remaining: remaining === null ? null : remaining.toFixed(MONEY_SCALE),
    };
  }

  consume(cap: CapStatus, amount: DecimalValue): void {
    const id = `${cap.key}|${cap.periodKey}`;
    this.used.set(id, (this.used.get(id) ?? ZERO).add(amount));
  }

  summary(): BenefitEngineResult['caps'] {
    return [...this.seen.entries()]
      .map(([id, entry]) => ({
        key: entry.key,
        periodKey: entry.periodKey,
        limit: entry.limit.toFixed(MONEY_SCALE),
        consumedOutside: entry.periodKey.startsWith('purchase:') ? '0.00' : this.outside.get(id)?.toFixed(MONEY_SCALE) ?? null,
        usedHere: (this.used.get(id) ?? ZERO).toFixed(MONEY_SCALE),
      }))
      .sort((a, b) => `${a.key}|${a.periodKey}`.localeCompare(`${b.key}|${b.periodKey}`));
  }
}

const maxZero = (value: DecimalValue): DecimalValue => (value.isNegative() ? ZERO : value);
const minOf = (a: DecimalValue, b: DecimalValue): DecimalValue => (a.compare(b) <= 0 ? a : b);
const money = (value: DecimalValue): string => value.round(MONEY_SCALE).toFixed(MONEY_SCALE);

// ---------------------------------------------------------------- evaluación

/**
 * Resultado de una regla antes de elegir: aplicable con su importe, condicionada con el importe
 * posible, o no elegible con el motivo.
 */
type Candidate =
  | { readonly kind: 'APPLICABLE'; readonly amount: DecimalValue; readonly cap: CapStatus | null }
  | { readonly kind: 'CONDITIONAL'; readonly reason: BenefitReason; readonly amount: DecimalValue; readonly cap: CapStatus | null }
  | { readonly kind: 'NOT_ELIGIBLE'; readonly reason: BenefitReason; readonly cap: CapStatus | null };

/** Tope y elegibilidad declarada sobre un importe ya calculado. */
function settle(amount: DecimalValue, cap: CapStatus | null, payerReason: PayerReason | null): Candidate {
  if (!amount.isPositive()) return { kind: 'NOT_ELIGIBLE', reason: 'NO_SAVINGS', cap };
  let capped = amount;
  let capUnknown = false;
  if (cap) {
    if (cap.remaining === null) {
      capUnknown = true;
      // Lo máximo posible si no se usó nada fuera: el tope menos lo usado en esta evaluación.
      capped = minOf(amount, maxZero(DecimalValue.parse(cap.limit).subtract(DecimalValue.parse(cap.usedBefore))));
    } else {
      const remaining = DecimalValue.parse(cap.remaining);
      if (!remaining.isPositive()) return { kind: 'NOT_ELIGIBLE', reason: 'CAP_EXHAUSTED', cap };
      capped = minOf(amount, remaining);
    }
    if (!capped.isPositive()) return { kind: 'NOT_ELIGIBLE', reason: 'CAP_EXHAUSTED', cap };
  }
  if (payerReason) return { kind: 'CONDITIONAL', reason: payerReason, amount: capped, cap };
  if (capUnknown) return { kind: 'CONDITIONAL', reason: 'CAP_REMAINING_UNKNOWN', amount: capped, cap };
  return { kind: 'APPLICABLE', amount: capped, cap };
}

function payerGate(rule: PromotionRule, payer: PayerProfile): { notEligible: PayerReason | null; unknown: PayerReason | null } {
  const eligibility = payerEligibility(rule, payer);
  if (eligibility.status === 'NOT_ELIGIBLE') return { notEligible: eligibility.reason, unknown: null };
  if (eligibility.status === 'UNKNOWN') return { notEligible: null, unknown: eligibility.reason };
  return { notEligible: null, unknown: null };
}

const targetOf = (purchase: BenefitPurchase, line: BenefitLine): PromotionTarget => ({
  storeId: purchase.storeId,
  chainId: purchase.chainId,
  productId: line.productId,
  canonicalProductId: line.canonicalProductId,
});

const commercialMatch = (rule: PromotionRule, purchase: BenefitPurchase): boolean =>
  rule.storeId ? rule.storeId === purchase.storeId : rule.chainId === purchase.chainId;

const byId = (a: PromotionRule, b: PromotionRule) => a.id.localeCompare(b.id);

/**
 * Cobra las compras en orden cronológico (los topes se consumen en ese orden) y devuelve el
 * resultado en el orden recibido, con la evaluación de cada promoción considerada.
 */
export function evaluateBenefits(input: {
  readonly purchases: readonly BenefitPurchase[];
  readonly rules: readonly PromotionRule[];
  readonly payer: PayerProfile;
  readonly capUsage?: readonly CapUsageEntry[];
}): BenefitEngineResult {
  const ledger = new CapLedger(input.capUsage ?? []);
  const productRules = input.rules.filter((rule) => rule.type !== 'BANK_DISCOUNT').sort(byId);
  const paymentRules = input.rules.filter((rule) => rule.type === 'BANK_DISCOUNT').sort(byId);
  const evaluations: BenefitEvaluation[] = [];
  const results = new Map<string, PurchaseResult>();

  const record = (rule: PromotionRule, layer: 'PRODUCT' | 'PAYMENT', purchase: BenefitPurchase, lineId: string | null, status: BenefitStatus, reason: BenefitReason | null, amount: DecimalValue | null, cap: CapStatus | null) =>
    evaluations.push({
      promotionId: rule.id,
      name: rule.name,
      type: rule.type,
      layer,
      purchaseId: purchase.purchaseId,
      lineId,
      status,
      reason,
      amount: amount === null ? null : money(amount),
      timing: rule.benefitTiming,
      refundDelayDays: rule.refundDelayDays,
      cap,
    });

  const chronological = [...input.purchases].sort((a, b) => a.instant.getTime() - b.instant.getTime() || a.purchaseId.localeCompare(b.purchaseId));
  for (const purchase of chronological) {
    const lines = [...purchase.lines].sort((a, b) => a.lineId.localeCompare(b.lineId));
    const regularOf = new Map<string, DecimalValue>();
    for (const line of lines) {
      regularOf.set(line.lineId, DecimalValue.parse(line.unitPrice).multiply(DecimalValue.parse(line.quantity)).round(MONEY_SCALE));
    }

    // 1. Promociones del producto: una por línea.
    const lineResults = new Map<string, { result: LineResult; rule: PromotionRule | null }>();
    for (const line of lines) {
      const regular = regularOf.get(line.lineId) as DecimalValue;
      const target = targetOf(purchase, line);
      const candidates: { rule: PromotionRule; candidate: Candidate }[] = [];
      for (const rule of productRules) {
        // Lo que no alcanza a este producto ni a esta sucursal no es parte de la explicación.
        if (!matchesTarget(rule, target)) continue;
        const calendar = calendarOrScopeSkipReason(rule, target, purchase.instant);
        if (calendar) {
          candidates.push({ rule, candidate: { kind: 'NOT_ELIGIBLE', reason: calendar, cap: null } });
          continue;
        }
        const payer = payerGate(rule, input.payer);
        if (payer.notEligible) {
          candidates.push({ rule, candidate: { kind: 'NOT_ELIGIBLE', reason: payer.notEligible, cap: null } });
          continue;
        }
        if (rule.minimumSpend !== null) {
          const scopeSubtotal = lines
            .filter((other) => matchesTarget(rule, targetOf(purchase, other)))
            .reduce((total, other) => total.add(regularOf.get(other.lineId) as DecimalValue), ZERO);
          if (scopeSubtotal.compare(DecimalValue.parse(rule.minimumSpend)) < 0) {
            candidates.push({ rule, candidate: { kind: 'NOT_ELIGIBLE', reason: 'MINIMUM_SPEND_NOT_REACHED', cap: null } });
            continue;
          }
        }
        const outcome = lineOutcome(rule, line);
        if (typeof outcome === 'string') {
          candidates.push({ rule, candidate: { kind: 'NOT_ELIGIBLE', reason: outcome, cap: null } });
          continue;
        }
        const discount = regular.subtract(outcome.total.round(MONEY_SCALE));
        candidates.push({ rule, candidate: settle(discount, ledger.status(rule, purchase), payer.unknown) });
      }
      const best = pickBest(candidates, () => 0);
      for (const { rule, candidate } of candidates) {
        if (best && rule.id === best.rule.id) record(rule, 'PRODUCT', purchase, line.lineId, 'APPLIED', null, best.amount, candidate.cap);
        else if (candidate.kind === 'APPLICABLE') record(rule, 'PRODUCT', purchase, line.lineId, 'NOT_CHOSEN', 'BETTER_PROMOTION', candidate.amount, candidate.cap);
        else if (candidate.kind === 'CONDITIONAL') record(rule, 'PRODUCT', purchase, line.lineId, 'CONDITIONAL', candidate.reason, candidate.amount, candidate.cap);
        else record(rule, 'PRODUCT', purchase, line.lineId, 'NOT_ELIGIBLE', candidate.reason, null, candidate.cap);
      }
      if (best?.cap) ledger.consume(best.cap, best.amount);
      const discount = best?.amount ?? ZERO;
      lineResults.set(line.lineId, {
        rule: best?.rule ?? null,
        result: {
          lineId: line.lineId,
          regularTotal: money(regular),
          productPromotionId: best?.rule.id ?? null,
          productDiscount: money(discount),
          total: money(regular.subtract(discount)),
        },
      });
    }

    // 2 y 3. Un beneficio de pago por compra, sobre la base elegible.
    const paymentCandidates: { rule: PromotionRule; candidate: Candidate; base: DecimalValue }[] = [];
    for (const rule of paymentRules) {
      if (!commercialMatch(rule, purchase)) continue;
      const scoped = lines.filter((line) => matchesTarget(rule, targetOf(purchase, line)));
      const anyLine = scoped[0] ?? lines[0];
      const calendar = anyLine ? calendarOrScopeSkipReason(rule, targetOf(purchase, anyLine), purchase.instant) : null;
      const reject = (reason: BenefitReason) => paymentCandidates.push({ rule, candidate: { kind: 'NOT_ELIGIBLE', reason, cap: null }, base: ZERO });
      if (calendar && calendar !== 'SCOPE_PRODUCT') {
        reject(calendar);
        continue;
      }
      const payer = payerGate(rule, input.payer);
      if (payer.notEligible) {
        reject(payer.notEligible);
        continue;
      }
      if (!scoped.length) {
        reject('NO_ELIGIBLE_ITEMS');
        continue;
      }
      // "No acumulable": una línea con promoción del producto queda fuera, salvo que ambas lo permitan.
      const stackable = scoped.filter((line) => {
        const applied = lineResults.get(line.lineId)?.rule;
        return !applied || (applied.isStackable && rule.isStackable);
      });
      if (!stackable.length) {
        reject('NOT_STACKABLE');
        continue;
      }
      const base = stackable.reduce((total, line) => total.add(DecimalValue.parse(lineResults.get(line.lineId)?.result.total ?? '0')), ZERO);
      if (rule.minimumSpend !== null && base.compare(DecimalValue.parse(rule.minimumSpend)) < 0) {
        reject('MINIMUM_SPEND_NOT_REACHED');
        continue;
      }
      const amount = rule.discountAmount !== null
        ? minOf(DecimalValue.parse(rule.discountAmount), base)
        : base.multiply(DecimalValue.parse(rule.discountPercentage ?? '0')).divide(HUNDRED, WORK_SCALE).round(MONEY_SCALE);
      paymentCandidates.push({ rule, candidate: settle(amount, ledger.status(rule, purchase), payer.unknown), base });
    }
    // Ante igual importe, el descuento en caja antes que el reintegro (se paga menos hoy).
    const payment = pickBest(paymentCandidates, (rule) => (rule.benefitTiming === 'IMMEDIATE' ? 0 : 1));
    for (const { rule, candidate } of paymentCandidates) {
      if (payment && rule.id === payment.rule.id) record(rule, 'PAYMENT', purchase, null, 'APPLIED', null, payment.amount, candidate.cap);
      else if (candidate.kind === 'APPLICABLE') record(rule, 'PAYMENT', purchase, null, 'NOT_CHOSEN', 'ONE_PAYMENT_BENEFIT_PER_PURCHASE', candidate.amount, candidate.cap);
      else if (candidate.kind === 'CONDITIONAL') record(rule, 'PAYMENT', purchase, null, 'CONDITIONAL', candidate.reason, candidate.amount, candidate.cap);
      else record(rule, 'PAYMENT', purchase, null, 'NOT_ELIGIBLE', candidate.reason, null, candidate.cap);
    }
    if (payment?.cap) ledger.consume(payment.cap, payment.amount);

    // 4. Totales de la compra.
    const lineList = lines.map((line) => (lineResults.get(line.lineId) as { result: LineResult }).result);
    const regularTotal = lineList.reduce((total, line) => total.add(DecimalValue.parse(line.regularTotal)), ZERO);
    const productDiscount = lineList.reduce((total, line) => total.add(DecimalValue.parse(line.productDiscount)), ZERO);
    const immediate = payment && payment.rule.benefitTiming === 'IMMEDIATE' ? payment.amount : ZERO;
    const refund = payment && payment.rule.benefitTiming === 'REFUND' ? payment.amount : ZERO;
    const payToday = regularTotal.subtract(productDiscount).subtract(immediate);
    results.set(purchase.purchaseId, {
      purchaseId: purchase.purchaseId,
      regularTotal: money(regularTotal),
      productDiscount: money(productDiscount),
      paymentDiscount: money(immediate),
      payToday: money(payToday),
      refundEstimated: money(refund),
      costAfterRefund: money(payToday.subtract(refund)),
      lines: lineList,
      payment: payment
        ? {
            promotionId: payment.rule.id,
            name: payment.rule.name,
            timing: payment.rule.benefitTiming,
            refundDelayDays: payment.rule.refundDelayDays,
            base: money(paymentCandidates.find((entry) => entry.rule.id === payment.rule.id)?.base ?? ZERO),
            amount: money(payment.amount),
          }
        : null,
    });
  }

  const purchases = input.purchases.map((purchase) => results.get(purchase.purchaseId) as PurchaseResult);
  const sum = (pick: (purchase: PurchaseResult) => string) => money(purchases.reduce((total, purchase) => total.add(DecimalValue.parse(pick(purchase))), ZERO));
  // Lo posible si se confirmara lo que falta: por línea y por compra, el mejor beneficio
  // condicionado por encima del aplicado. Son alternativas, no se suman entre sí.
  let conditional = ZERO;
  const groups = new Map<string, { best: DecimalValue; applied: DecimalValue }>();
  for (const evaluation of evaluations) {
    const group = `${evaluation.purchaseId}|${evaluation.layer}|${evaluation.lineId ?? ''}`;
    const entry = groups.get(group) ?? { best: ZERO, applied: ZERO };
    const amount = evaluation.amount === null ? ZERO : DecimalValue.parse(evaluation.amount);
    if (evaluation.status === 'CONDITIONAL' && amount.compare(entry.best) > 0) entry.best = amount;
    if (evaluation.status === 'APPLIED') entry.applied = amount;
    groups.set(group, entry);
  }
  for (const entry of groups.values()) conditional = conditional.add(maxZero(entry.best.subtract(entry.applied)));
  const conditionalAmount = money(conditional);
  return {
    purchases,
    totals: {
      regularTotal: sum((purchase) => purchase.regularTotal),
      productDiscount: sum((purchase) => purchase.productDiscount),
      paymentDiscount: sum((purchase) => purchase.paymentDiscount),
      payToday: sum((purchase) => purchase.payToday),
      refundEstimated: sum((purchase) => purchase.refundEstimated),
      costAfterRefund: sum((purchase) => purchase.costAfterRefund),
      conditionalAmount,
    },
    evaluations,
    caps: ledger.summary(),
  };
}

/** Mayor importe; ante empate, la preferencia indicada y después el id más chico (determinista). */
function pickBest<T extends { rule: PromotionRule; candidate: Candidate }>(
  entries: readonly T[],
  preference: (rule: PromotionRule) => number,
): { rule: PromotionRule; amount: DecimalValue; cap: CapStatus | null } | null {
  let best: { rule: PromotionRule; amount: DecimalValue; cap: CapStatus | null } | null = null;
  for (const { rule, candidate } of entries) {
    if (candidate.kind !== 'APPLICABLE') continue;
    const better =
      !best ||
      candidate.amount.compare(best.amount) > 0 ||
      (candidate.amount.compare(best.amount) === 0 &&
        (preference(rule) < preference(best.rule) || (preference(rule) === preference(best.rule) && rule.id < best.rule.id)));
    if (better) best = { rule, amount: candidate.amount, cap: candidate.cap };
  }
  return best;
}
