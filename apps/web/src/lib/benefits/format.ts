import type { DiscountCapPeriod, PaymentMethod, BenefitConditionsDto } from '@tusofertas/shared';
import { formatArs } from '../format';

/**
 * Textos de los beneficios de pago (P10-02, ADR 0023 y 0024): banco, medio, día, mínimo,
 * tope y momento del beneficio se muestran siempre juntos, para que ninguna condición
 * importante quede oculta.
 */

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  TRANSFER: 'Transferencia',
  WALLET: 'Billetera virtual',
};

const PAYMENT_METHOD_SHORT: Record<PaymentMethod, string> = {
  CASH: 'efectivo',
  DEBIT_CARD: 'débito',
  CREDIT_CARD: 'crédito',
  TRANSFER: 'transferencia',
  WALLET: 'billetera virtual',
};

const CAP_PERIOD_LABEL: Record<DiscountCapPeriod, string> = {
  PURCHASE: 'por compra',
  WEEK: 'por semana',
  MONTH: 'por mes',
  CAMPAIGN: 'en toda la promoción',
};

const WEEKDAY_PLURAL = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];

const percent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** "los miércoles", "los lunes y jueves"; vacío = todos los días. */
export function formatWeekdays(days: readonly number[]): string | null {
  if (!days.length || days.length === 7) return null;
  const names = [...days].sort((a, b) => a - b).map((day) => WEEKDAY_PLURAL[day] ?? '');
  const last = names.pop() as string;
  return `los ${names.length ? `${names.join(', ')} y ${last}` : last}`;
}

/** "20%" o "$ 1.500,00". */
export function formatBenefitValue(conditions: Pick<BenefitConditionsDto, 'discountPercentage' | 'discountAmount'>): string | null {
  if (conditions.discountPercentage) return `${percent.format(Number(conditions.discountPercentage))}%`;
  if (conditions.discountAmount) return formatArs(conditions.discountAmount);
  return null;
}

/** "con débito del Banco Demo", "con Billetera Demo", "socios de Club Demo". */
export function formatPayer(conditions: Pick<BenefitConditionsDto, 'paymentMethod' | 'bank' | 'membershipProgram'>): string | null {
  const parts: string[] = [];
  if (conditions.paymentMethod && conditions.bank) parts.push(`con ${PAYMENT_METHOD_SHORT[conditions.paymentMethod]} de ${conditions.bank}`);
  else if (conditions.paymentMethod) parts.push(`con ${PAYMENT_METHOD_SHORT[conditions.paymentMethod]}`);
  else if (conditions.bank) parts.push(`con ${conditions.bank}`);
  if (conditions.membershipProgram) parts.push(`para socios de ${conditions.membershipProgram}`);
  return parts.length ? parts.join(' ') : null;
}

/** Cada condición como frase corta, en el orden en que se leen en la caja. */
export function conditionParts(conditions: BenefitConditionsDto): string[] {
  const parts: string[] = [];
  const value = formatBenefitValue(conditions);
  const payer = formatPayer(conditions);
  if (value || payer) parts.push([value, payer].filter(Boolean).join(' '));
  const days = formatWeekdays(conditions.eligibleWeekdays);
  if (days) parts.push(`solo ${days}`);
  if (conditions.minimumSpend) parts.push(`compra mínima de ${formatArs(conditions.minimumSpend)}`);
  if (conditions.discountCap) {
    parts.push(`tope de ${formatArs(conditions.discountCap)}${conditions.capPeriod ? ` ${CAP_PERIOD_LABEL[conditions.capPeriod]}` : ''}`);
  }
  if (conditions.timing === 'REFUND') {
    parts.push(conditions.refundDelayDays ? `reintegro en ${conditions.refundDelayDays} días` : 'reintegro posterior (sin plazo informado)');
  } else {
    parts.push('descuento en la caja');
  }
  if (!conditions.stackable) parts.push('no acumulable con otras promociones');
  return parts;
}

export const formatConditions = (conditions: BenefitConditionsDto): string => conditionParts(conditions).join(' · ');

/** Motivo de un beneficio no sumado, para mostrar tal cual. */
const REASON_LABEL: Record<string, string> = {
  BANK_NOT_DECLARED: 'No nos dijiste si tenés cuenta en ese banco o billetera.',
  PAYMENT_METHOD_NOT_DECLARED: 'No nos dijiste si pagás con ese medio.',
  MEMBERSHIP_NOT_DECLARED: 'No nos dijiste si sos socio de ese programa.',
  CAP_REMAINING_UNKNOWN: 'No sabemos cuánto del tope ya usaste en el período.',
  BANK_NOT_ELIGIBLE: 'Es de un banco o billetera que no declaraste.',
  PAYMENT_METHOD_NOT_ELIGIBLE: 'Es para un medio de pago que no declaraste.',
  MEMBERSHIP_NOT_ELIGIBLE: 'Es para socios de un programa que no declaraste.',
  WEEKDAY_NOT_ELIGIBLE: 'No vale ese día.',
  EXPIRED: 'No está vigente ese día.',
  NOT_STARTED: 'Todavía no empezó ese día.',
  MINIMUM_SPEND_NOT_REACHED: 'La compra no llega al mínimo.',
  QUANTITY_BELOW_MINIMUM: 'No se llega a la cantidad mínima.',
  SCOPE_STORE: 'No vale en esta sucursal.',
  SCOPE_PRODUCT: 'No incluye este producto.',
  NOT_STACKABLE: 'No se acumula con la promoción del producto.',
  CAP_EXHAUSTED: 'El tope del período ya está usado.',
  NO_ELIGIBLE_ITEMS: 'Ningún producto de esta compra entra en la promoción.',
  NO_SAVINGS: 'No baja el precio en esta compra.',
  BETTER_PROMOTION: 'Otra promoción conviene más.',
  ONE_PAYMENT_BENEFIT_PER_PURCHASE: 'Se paga con un solo medio: usamos otro beneficio que conviene más.',
};

export const formatBenefitReason = (reason: string | null): string | null =>
  reason ? REASON_LABEL[reason] ?? 'No corresponde en esta compra.' : null;

/** El motivo se resuelve informando algo en Preferencias. */
export const isFixableInPreferences = (reason: string | null): boolean =>
  reason === 'BANK_NOT_DECLARED' ||
  reason === 'PAYMENT_METHOD_NOT_DECLARED' ||
  reason === 'MEMBERSHIP_NOT_DECLARED' ||
  reason === 'CAP_REMAINING_UNKNOWN';

/** "Septiembre de 2026", "semana 40 de 2026", "toda la promoción" o "esta compra". */
export function formatCapPeriodKey(periodKey: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 15));
    const text = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (week) return `Semana ${Number(week[2])} de ${week[1]}`;
  if (periodKey === 'CAMPAIGN') return 'Toda la promoción';
  return 'Esta compra';
}
