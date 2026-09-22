/**
 * Elegibilidad de una promoción: vigencia, día de la semana en Argentina y
 * alcance comercial/de producto.
 *
 * Lo que no se puede comprobar no se promete: una promoción atada a un banco,
 * un medio de pago o una membresía queda informada pero sin aplicar hasta
 * P10-01, y un tope que abarca varias compras necesita saber cuánto beneficio
 * ya se usó (docs/DOMAIN.md).
 */
import { ARGENTINA_TIME_ZONE } from './promotion.types';
import type { PromotionRule, PromotionSkipReason, PromotionTarget } from './promotion.types';

const ISO_WEEKDAY: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ARGENTINA_TIME_ZONE,
  weekday: 'short',
});

/** Día ISO (1 = lunes) del instante, leído en el calendario argentino. */
export function argentineIsoWeekday(instant: Date): number {
  const label = weekdayFormatter.format(instant);
  const day = ISO_WEEKDAY[label];
  if (!day) throw new RangeError(`No se pudo interpretar el día de la semana: ${label}`);
  return day;
}

/** Vigencia `[validFrom, validUntil)`: el último instante no está incluido. */
export function isWithinValidity(rule: PromotionRule, instant: Date): boolean {
  return instant.getTime() >= rule.validFrom.getTime() && instant.getTime() < rule.validUntil.getTime();
}

export function matchesTarget(rule: PromotionRule, target: PromotionTarget): boolean {
  const commercial = rule.storeId ? rule.storeId === target.storeId : rule.chainId === target.chainId;
  if (!commercial) return false;
  if (rule.productId) return rule.productId === target.productId;
  if (rule.canonicalProductId) return rule.canonicalProductId === target.canonicalProductId;
  // Sin alcance de producto la promoción cubre todo el comercio.
  return true;
}

/**
 * Motivo por el que la promoción no corresponde, o `null` si es elegible.
 * No evalúa cantidades ni importes: eso lo decide el calculador.
 */
export function promotionSkipReason(
  rule: PromotionRule,
  target: PromotionTarget,
  instant: Date,
): PromotionSkipReason | null {
  if (instant.getTime() < rule.validFrom.getTime()) return 'NOT_STARTED';
  if (instant.getTime() >= rule.validUntil.getTime()) return 'EXPIRED';
  if (!matchesTarget(rule, target)) {
    const commercial = rule.storeId ? rule.storeId === target.storeId : rule.chainId === target.chainId;
    return commercial ? 'SCOPE_PRODUCT' : 'SCOPE_STORE';
  }
  if (rule.eligibleWeekdays.length && !rule.eligibleWeekdays.includes(argentineIsoWeekday(instant))) {
    return 'WEEKDAY_NOT_ELIGIBLE';
  }
  // Banco, medio de pago y membresía dependen del usuario: no se asumen.
  if (rule.type === 'BANK_DISCOUNT' || rule.bank || rule.paymentMethod) return 'PAYMENT_CONDITIONED';
  if (rule.membershipProgram) return 'MEMBERSHIP_CONDITIONED';
  // Solo el tope por compra es verificable sin conocer el beneficio ya usado.
  if (rule.capPeriod && rule.capPeriod !== 'PURCHASE') return 'CAP_PERIOD_UNSUPPORTED';
  return null;
}

export const isEligible = (rule: PromotionRule, target: PromotionTarget, instant: Date): boolean =>
  promotionSkipReason(rule, target, instant) === null;
