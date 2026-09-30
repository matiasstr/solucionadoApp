/**
 * Evaluación de una alerta de precio (P9-01, ADR 0022). Funciones puras: reciben productos,
 * precios ya analizados (ADR 0016) y el estado de la regla; no leen ni escriben la base.
 */
import { createHash } from 'node:crypto';
import { DecimalValue } from '../../catalog/domain/decimal';
import { normalizeName } from '../../catalog/domain/naming';
import type { BaseUnit } from '../../catalog/domain/units';
import type { PriceAnalysis } from '../../prices/domain/price-analysis';
import type { AlertCondition } from './alert-rules';

export type AlertOutcome =
  | 'NOTIFIED'
  | 'ALREADY_NOTIFIED'
  | 'COOLDOWN'
  | 'NO_MATCH'
  | 'NO_FRESH_PRICES'
  | 'INSUFFICIENT_DATA'
  | 'NO_ELIGIBLE_PRODUCTS'
  | 'NO_LOCATION'
  | 'NO_STORES_IN_SCOPE'
  | 'PAUSED'
  | 'RULE_CHANGED'
  | 'RULE_DELETED';

export interface RuleForEvaluation {
  readonly condition: AlertCondition;
  readonly canonicalProductId: string;
  /** Presentación preferida. */
  readonly productId: string | null;
  readonly allowSubstitutes: boolean;
  readonly excludedBrands: readonly string[];
  readonly targetUnitPrice: string | null;
  readonly targetUnit: BaseUnit | null;
}

export interface CandidateProduct {
  readonly id: string;
  readonly canonicalProductId: string | null;
  readonly brand: string | null;
  readonly isActive: boolean;
}

export interface CandidatePrice {
  readonly productId: string;
  readonly storeId: string;
  readonly source: string;
  readonly price: string;
  readonly unitPrice: string;
  readonly unitPriceUnit: BaseUnit;
  readonly currency: string;
  readonly observedAt: Date;
  readonly analysis: PriceAnalysis;
}

export interface AlertMatch extends CandidatePrice {
  /** Otra presentación que la preferida: el aviso lo tiene que decir. */
  readonly isAlternative: boolean;
}

export type Evaluation =
  | { readonly kind: 'MATCH'; readonly match: AlertMatch }
  | { readonly kind: 'NO_MATCH' | 'NO_FRESH_PRICES' | 'INSUFFICIENT_DATA' | 'NO_ELIGIBLE_PRODUCTS' | 'NO_LOCATION' | 'NO_STORES_IN_SCOPE' };

/**
 * Presentaciones que la regla acepta: del mismo genérico y activas; sin reemplazos, solo la
 * preferida; con reemplazos, las marcas excluidas quedan afuera (salvo la preferida, que se
 * eligió explícitamente).
 */
export function eligibleProducts<T extends CandidateProduct>(rule: RuleForEvaluation, products: readonly T[]): T[] {
  const excluded = new Set(rule.excludedBrands.map((brand) => normalizeName(brand)));
  return products.filter((product) => {
    if (product.canonicalProductId !== rule.canonicalProductId || !product.isActive) return false;
    if (product.id === rule.productId) return true;
    if (!rule.allowSubstitutes) return false;
    return !(product.brand && excluded.has(normalizeName(product.brand)));
  });
}

const matches = (rule: RuleForEvaluation, price: CandidatePrice): boolean => {
  const classification = price.analysis.classification;
  switch (rule.condition) {
    case 'TARGET_PRICE':
      return (
        rule.targetUnitPrice !== null &&
        price.unitPriceUnit === rule.targetUnit &&
        DecimalValue.parse(price.unitPrice).compare(DecimalValue.parse(rule.targetUnitPrice)) <= 0
      );
    case 'HISTORIC_LOW':
      return classification === 'HISTORIC_LOW';
    default:
      return classification === 'HISTORIC_LOW' || classification === 'GOOD_DEAL';
  }
};

/**
 * Evalúa una regla contra los precios de sus sucursales. Solo cuentan precios **frescos** en
 * pesos (ADR 0008); las oportunidades además exigen el historial mínimo del análisis (7 días
 * con dato), así que con pocos datos no se avisa. Se usan precios observados, sin promociones:
 * una alerta nunca se dispara por una promoción que puede no aplicarle a la persona.
 * Entre varios candidatos gana el menor precio por unidad; ante empate, la preferida, la
 * sucursal más cercana y los ids.
 */
export function evaluateRule(
  rule: RuleForEvaluation,
  products: readonly CandidateProduct[],
  prices: readonly CandidatePrice[],
  distances: ReadonlyMap<string, number> = new Map(),
): Evaluation {
  const eligible = new Set(eligibleProducts(rule, products).map((product) => product.id));
  if (!eligible.size) return { kind: 'NO_ELIGIBLE_PRODUCTS' };
  const fresh = prices.filter(
    (price) => eligible.has(price.productId) && price.currency === 'ARS' && price.analysis.current !== null && !price.analysis.current.isStale,
  );
  if (!fresh.length) return { kind: 'NO_FRESH_PRICES' };
  const found = fresh.filter((price) => matches(rule, price));
  if (!found.length) {
    const opportunity = rule.condition !== 'TARGET_PRICE';
    const insufficient = fresh.every((price) => price.analysis.classification === 'INSUFFICIENT_DATA');
    return { kind: opportunity && insufficient ? 'INSUFFICIENT_DATA' : 'NO_MATCH' };
  }
  const distance = (price: CandidatePrice) => distances.get(price.storeId) ?? Number.POSITIVE_INFINITY;
  const best = [...found].sort(
    (a, b) =>
      DecimalValue.parse(a.unitPrice).compare(DecimalValue.parse(b.unitPrice)) ||
      Number(b.productId === rule.productId) - Number(a.productId === rule.productId) ||
      distance(a) - distance(b) ||
      a.productId.localeCompare(b.productId) ||
      a.storeId.localeCompare(b.storeId) ||
      a.source.localeCompare(b.source),
  )[0] as CandidatePrice;
  return { kind: 'MATCH', match: { ...best, isAlternative: rule.productId !== null && best.productId !== rule.productId } };
}

/** Estado de la regla leído (y bloqueado) en el momento de avisar. */
export interface LockedRuleState {
  readonly active: boolean;
  readonly revision: number;
  /** Precio por unidad del último aviso mientras la condición siga cumpliéndose. */
  readonly notifiedUnitPrice: string | null;
  readonly lastNotifiedAt: Date | null;
}

export type Decision =
  | { readonly action: 'NOTIFY'; readonly outcome: 'NOTIFIED'; readonly notifiedUnitPrice: string }
  /** `notifiedUnitPrice`: `null` vuelve a habilitar avisos; `undefined` no lo cambia. */
  | { readonly action: 'RECORD'; readonly outcome: AlertOutcome; readonly notifiedUnitPrice?: string | null }
  | { readonly action: 'SKIP'; readonly outcome: 'PAUSED' | 'RULE_CHANGED' };

/**
 * Decide con el estado vigente de la regla (no con el que se leyó al evaluar):
 * - pausada o editada mientras tanto → no se toca;
 * - la condición dejó de cumplirse con datos frescos → se vuelve a habilitar el aviso;
 * - se cumple: avisa la primera vez y cuando **mejora** el precio, nunca mientras siga igual,
 *   y nunca antes de `cooldownHours` desde el último aviso.
 */
export function decide(evaluation: Evaluation, state: LockedRuleState, evaluatedRevision: number, now: Date, cooldownHours: number): Decision {
  if (!state.active) return { action: 'SKIP', outcome: 'PAUSED' };
  if (state.revision !== evaluatedRevision) return { action: 'SKIP', outcome: 'RULE_CHANGED' };
  if (evaluation.kind === 'NO_MATCH') return { action: 'RECORD', outcome: 'NO_MATCH', notifiedUnitPrice: null };
  if (evaluation.kind !== 'MATCH') return { action: 'RECORD', outcome: evaluation.kind };
  const price = DecimalValue.parse(evaluation.match.unitPrice);
  if (state.notifiedUnitPrice !== null && price.compare(DecimalValue.parse(state.notifiedUnitPrice)) >= 0) {
    return { action: 'RECORD', outcome: 'ALREADY_NOTIFIED' };
  }
  if (state.lastNotifiedAt && now.getTime() - state.lastNotifiedAt.getTime() < cooldownHours * 3_600_000) {
    return { action: 'RECORD', outcome: 'COOLDOWN' };
  }
  return { action: 'NOTIFY', outcome: 'NOTIFIED', notifiedUnitPrice: evaluation.match.unitPrice };
}

/**
 * La observación que originó el aviso. Única por regla en la base: aunque dos procesos
 * decidan avisar a la vez, la misma observación no genera dos avisos.
 */
export function alertEventKey(condition: AlertCondition, match: CandidatePrice): string {
  const observation = [match.productId, match.storeId, match.source, match.observedAt.toISOString(), match.unitPrice].join('|');
  return `${condition}:${createHash('sha256').update(observation).digest('hex')}`;
}
