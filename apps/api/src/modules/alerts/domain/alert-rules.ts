/**
 * Reglas de una alerta de precio (P9-01, ADR 0022). Funciones puras: el servicio las
 * aplica al crear y al editar, sobre el resultado final.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { BaseUnit } from '../../catalog/domain/units';

export const MAX_ALERT_RULES_PER_USER = 20;
export const ALERT_CONDITIONS = ['TARGET_PRICE', 'HISTORIC_LOW', 'GOOD_DEAL'] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];
/** Por ahora todo precio observado es en pesos. */
export const ALERT_CURRENCY = 'ARS';
/** Precio objetivo por unidad base, en pesos con hasta dos decimales. */
export const TARGET_PRICE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
export const MIN_ALERT_RADIUS_KM = 0.1;
export const MAX_ALERT_RADIUS_KM = 100;

export type AlertRuleErrorCode =
  | 'TARGET_PRICE_REQUIRED'
  | 'TARGET_PRICE_NOT_ALLOWED'
  | 'TARGET_PRICE_INVALID'
  | 'UNIT_DIMENSION_MISMATCH'
  | 'CURRENCY_NOT_SUPPORTED'
  | 'PREFERRED_PRODUCT_REQUIRED'
  | 'RADIUS_INVALID';

export class AlertRuleError extends Error {
  constructor(
    readonly code: AlertRuleErrorCode,
    message: string,
    readonly fields: readonly string[],
  ) {
    super(message);
    this.name = 'AlertRuleError';
  }
}

export interface AlertRuleShape {
  readonly condition: AlertCondition;
  readonly targetUnitPrice: string | null;
  readonly targetUnit: BaseUnit | null;
  readonly currency: string;
  readonly allowSubstitutes: boolean;
  readonly productId: string | null;
  readonly radiusKm: string | null;
}

/**
 * - `TARGET_PRICE` exige precio objetivo **por unidad base del genérico** (KG, L o UNIT):
 *   es lo que hace comparables dos presentaciones. Las otras condiciones no lo llevan.
 * - Solo pesos. Sin reemplazos hay que elegir la presentación. Radio de 0,1 a 100 km.
 */
export function assertAlertRule(rule: AlertRuleShape, canonicalUnit: BaseUnit): void {
  if (rule.currency !== ALERT_CURRENCY) {
    throw new AlertRuleError('CURRENCY_NOT_SUPPORTED', 'Por ahora las alertas son en pesos (ARS).', ['currency']);
  }
  if (rule.condition === 'TARGET_PRICE') {
    if (rule.targetUnitPrice === null || rule.targetUnit === null) {
      throw new AlertRuleError(
        'TARGET_PRICE_REQUIRED',
        'Indicá el precio objetivo y su unidad.',
        [rule.targetUnitPrice === null ? 'targetUnitPrice' : 'targetUnit'],
      );
    }
    if (!TARGET_PRICE_PATTERN.test(rule.targetUnitPrice) || !DecimalValue.parse(rule.targetUnitPrice).isPositive()) {
      throw new AlertRuleError('TARGET_PRICE_INVALID', 'El precio objetivo tiene que ser mayor que cero, con hasta dos decimales.', ['targetUnitPrice']);
    }
    if (rule.targetUnit !== canonicalUnit) {
      throw new AlertRuleError('UNIT_DIMENSION_MISMATCH', `El precio objetivo de este producto es por ${canonicalUnit}.`, ['targetUnit']);
    }
  } else if (rule.targetUnitPrice !== null || rule.targetUnit !== null) {
    throw new AlertRuleError('TARGET_PRICE_NOT_ALLOWED', 'Solo una alerta de precio objetivo lleva precio.', ['targetUnitPrice', 'targetUnit']);
  }
  if (!rule.allowSubstitutes && rule.productId === null) {
    throw new AlertRuleError('PREFERRED_PRODUCT_REQUIRED', 'Si no aceptás reemplazos, elegí la presentación que querés vigilar.', ['productId']);
  }
  if (rule.radiusKm !== null) {
    const radius = Number(rule.radiusKm);
    if (!Number.isFinite(radius) || radius < MIN_ALERT_RADIUS_KM || radius > MAX_ALERT_RADIUS_KM) {
      throw new AlertRuleError('RADIUS_INVALID', `El radio va de ${MIN_ALERT_RADIUS_KM} a ${MAX_ALERT_RADIUS_KM} km.`, ['radiusKm']);
    }
  }
}
