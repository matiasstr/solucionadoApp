/**
 * Calculador de promociones: función pura, sin Prisma ni Nest (P2-03).
 *
 * Cobra una línea de compra (un producto, en una sucursal, una cantidad) y
 * devuelve el total con la mejor promoción aplicable **y** por qué las demás no
 * se aplicaron. Nunca acumula dos promociones: `isStackable` no habilita
 * acumulación hasta definir compatibilidades (docs/DOMAIN.md).
 *
 * El redondeo monetario ocurre una sola vez, sobre el total de la línea; los
 * cálculos intermedios conservan precisión (ADR 0002).
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { SaleMode } from '../../catalog/domain/units';
import { promotionSkipReason } from './promotion-eligibility';
import type { PromotionRule, PromotionSkipReason, PromotionTarget, PromotionType } from './promotion.types';

/** Escala de importes finales (ARS) y de los cálculos intermedios. */
const MONEY_SCALE = 2;
const WORK_SCALE = 6;
/** Escala de cantidades informadas (unidades cobradas). */
const QUANTITY_SCALE = 4;
const HUNDRED = DecimalValue.parse('100');
const TWO = DecimalValue.parse('2');

export interface PromotionLine {
  /** Precio por unidad de venta: el paquete completo o la base de cotización. */
  readonly unitPrice: string;
  /** Unidades enteras para envasados; cantidad en unidad base para venta por peso. */
  readonly quantity: string;
  readonly saleMode: SaleMode;
}

export interface PromotionContext {
  readonly target: PromotionTarget;
  readonly instant: Date;
  /**
   * Subtotal elegible de la compra en esa sucursal. Sin él no se puede verificar
   * `minimumSpend`, y una promoción con mínimo no se aplica a ciegas.
   */
  readonly eligibleSubtotal?: string;
}

export interface PromotionEvaluation {
  readonly promotionId: string;
  readonly name: string;
  readonly type: PromotionType;
  readonly applied: boolean;
  readonly skipReason: PromotionSkipReason | null;
  /** Total de la línea con esta promoción; null si no se pudo aplicar. */
  readonly total: string | null;
  readonly discount: string | null;
  /** Unidades efectivamente cobradas (2×1, segunda unidad); null si no cambia. */
  readonly chargedUnits: string | null;
}

/**
 * Unidades que hay que llevar para que la promoción tenga efecto: las de pares
 * necesitan al menos dos, el resto respeta su cantidad mínima declarada.
 */
export function minimumQuantityFor(rule: PromotionRule): number {
  const required = rule.requiredQuantity ?? 1;
  return rule.type === 'TWO_FOR_ONE' || rule.type === 'SECOND_UNIT' ? Math.max(2, required) : required;
}

export interface LineCharge {
  readonly regularTotal: string;
  readonly total: string;
  readonly discount: string;
  readonly appliedPromotionId: string | null;
  /** Todas las promociones consideradas, apliquen o no: la decisión es trazable. */
  readonly evaluations: readonly PromotionEvaluation[];
}

interface Outcome {
  readonly total: DecimalValue;
  readonly chargedUnits: DecimalValue | null;
}

function parseLine(line: PromotionLine): { unitPrice: DecimalValue; quantity: DecimalValue } {
  const unitPrice = DecimalValue.parse(line.unitPrice);
  const quantity = DecimalValue.parse(line.quantity);
  if (!unitPrice.isPositive()) throw new RangeError('El precio unitario debe ser mayor que cero.');
  if (!quantity.isPositive()) throw new RangeError('La cantidad debe ser mayor que cero.');
  // Un envasado se compra entero: media caja no es una compra posible.
  if (line.saleMode === 'PACKAGED' && !quantity.isInteger()) {
    throw new RangeError('Un producto envasado se compra en unidades enteras.');
  }
  return { unitPrice, quantity };
}

/** Aplica el tope por compra: el beneficio nunca supera `discountCap`. */
function applyPurchaseCap(rule: PromotionRule, regularTotal: DecimalValue, total: DecimalValue): DecimalValue {
  if (!rule.discountCap || rule.capPeriod !== 'PURCHASE') return total;
  const cap = DecimalValue.parse(rule.discountCap);
  const discount = regularTotal.subtract(total);
  return discount.compare(cap) > 0 ? regularTotal.subtract(cap) : total;
}

function computeOutcome(
  rule: PromotionRule,
  line: PromotionLine,
  unitPrice: DecimalValue,
  quantity: DecimalValue,
  regularTotal: DecimalValue,
): Outcome | PromotionSkipReason {
  if (rule.requiredQuantity !== null && quantity.compare(DecimalValue.parse(String(rule.requiredQuantity))) < 0) {
    return 'QUANTITY_BELOW_MINIMUM';
  }
  switch (rule.type) {
    case 'PERCENTAGE': {
      const percentage = DecimalValue.parse(rule.discountPercentage ?? '0');
      const discount = regularTotal.multiply(percentage).divide(HUNDRED, WORK_SCALE);
      return { total: regularTotal.subtract(discount), chargedUnits: null };
    }
    case 'SECOND_UNIT': {
      // Un descuento por cada par completo del mismo producto: no aplica a granel.
      if (line.saleMode !== 'PACKAGED') return 'SALE_MODE_UNSUPPORTED';
      const pairs = quantity.divide(TWO, WORK_SCALE).floorToInteger();
      if (!pairs.isPositive()) return 'NO_SAVINGS';
      const percentage = DecimalValue.parse(rule.discountPercentage ?? '0');
      const discountedUnits = pairs.multiply(percentage).divide(HUNDRED, WORK_SCALE);
      return {
        total: unitPrice.multiply(quantity.subtract(discountedUnits)),
        chargedUnits: quantity.subtract(discountedUnits),
      };
    }
    case 'TWO_FOR_ONE': {
      if (line.saleMode !== 'PACKAGED') return 'SALE_MODE_UNSUPPORTED';
      // Tres unidades pagan dos: el remanente impar se cobra completo.
      const free = quantity.divide(TWO, WORK_SCALE).floorToInteger();
      if (!free.isPositive()) return 'NO_SAVINGS';
      const charged = quantity.subtract(free);
      return { total: unitPrice.multiply(charged), chargedUnits: charged };
    }
    case 'FIXED_PRICE': {
      const fixedPrice = DecimalValue.parse(rule.fixedPrice ?? '0');
      // Un "beneficio" más caro que el precio regular no es un beneficio.
      if (fixedPrice.compare(unitPrice) >= 0) return 'NO_SAVINGS';
      return { total: fixedPrice.multiply(quantity), chargedUnits: null };
    }
    case 'BANK_DISCOUNT':
      // Modelado pero no aplicado hasta P10-01.
      return 'PAYMENT_CONDITIONED';
    default:
      return 'NO_SAVINGS';
  }
}

function evaluate(
  rule: PromotionRule,
  line: PromotionLine,
  unitPrice: DecimalValue,
  quantity: DecimalValue,
  regularTotal: DecimalValue,
  context: PromotionContext,
): { evaluation: PromotionEvaluation; total: DecimalValue | null; discount: DecimalValue | null } {
  const skip = (reason: PromotionSkipReason) => ({
    evaluation: {
      promotionId: rule.id,
      name: rule.name,
      type: rule.type,
      applied: false,
      skipReason: reason,
      total: null,
      discount: null,
      chargedUnits: null,
    },
    total: null,
    discount: null,
  });

  const ineligible = promotionSkipReason(rule, context.target, context.instant);
  if (ineligible) return skip(ineligible);

  if (rule.minimumSpend !== null) {
    if (context.eligibleSubtotal === undefined) return skip('MINIMUM_SPEND_UNKNOWN');
    if (DecimalValue.parse(context.eligibleSubtotal).compare(DecimalValue.parse(rule.minimumSpend)) < 0) {
      return skip('MINIMUM_SPEND_NOT_REACHED');
    }
  }

  const outcome = computeOutcome(rule, line, unitPrice, quantity, regularTotal);
  if (typeof outcome === 'string') return skip(outcome);

  const total = applyPurchaseCap(rule, regularTotal, outcome.total).round(MONEY_SCALE);
  const discount = regularTotal.round(MONEY_SCALE).subtract(total);
  if (!discount.isPositive()) return skip('NO_SAVINGS');

  return {
    evaluation: {
      promotionId: rule.id,
      name: rule.name,
      type: rule.type,
      applied: true,
      skipReason: null,
      total: total.toFixed(MONEY_SCALE),
      discount: discount.toFixed(MONEY_SCALE),
      chargedUnits: outcome.chargedUnits ? outcome.chargedUnits.toTrimmedString(QUANTITY_SCALE) : null,
    },
    total,
    discount,
  };
}

/**
 * Cobra una línea con la promoción que más conviene al comprador. Ante igual
 * ahorro gana el id más chico: el resultado no depende del orden de entrada.
 */
export function priceLine(
  line: PromotionLine,
  rules: readonly PromotionRule[],
  context: PromotionContext,
): LineCharge {
  const { unitPrice, quantity } = parseLine(line);
  const regularTotal = unitPrice.multiply(quantity);
  const roundedRegular = regularTotal.round(MONEY_SCALE);

  const evaluations: PromotionEvaluation[] = [];
  let best: { total: DecimalValue; discount: DecimalValue; id: string } | null = null;

  for (const rule of rules) {
    const result = evaluate(rule, line, unitPrice, quantity, regularTotal, context);
    evaluations.push(result.evaluation);
    if (!result.total || !result.discount) continue;
    const better =
      !best ||
      result.discount.compare(best.discount) > 0 ||
      (result.discount.compare(best.discount) === 0 && rule.id < best.id);
    if (better) best = { total: result.total, discount: result.discount, id: rule.id };
  }

  const applied = evaluations.map((evaluation) => ({
    ...evaluation,
    applied: evaluation.applied && evaluation.promotionId === best?.id,
    // Las que podían aplicar pero perdieron conservan su cálculo, sin ser la elegida.
  }));

  return {
    regularTotal: roundedRegular.toFixed(MONEY_SCALE),
    total: (best?.total ?? roundedRegular).toFixed(MONEY_SCALE),
    discount: (best?.discount ?? DecimalValue.zero(MONEY_SCALE)).toFixed(MONEY_SCALE),
    appliedPromotionId: best?.id ?? null,
    evaluations: applied,
  };
}
