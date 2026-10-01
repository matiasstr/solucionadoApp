/**
 * Elegibilidad según lo que la persona declaró (P10-01, ADR 0023): bancos, medios de pago y
 * membresías. Tres estados, nunca dos: si no declaró nada sobre una condición no se asume ni
 * que la cumple ni que no; el beneficio queda **condicionado** y no se suma como ahorro.
 * Nunca se pide número de tarjeta, CVV ni credenciales: alcanza con el nombre del banco.
 */
import { normalizeName } from '../../catalog/domain/naming';
import type { PaymentMethod, PromotionRule } from './promotion.types';

export interface PayerProfile {
  readonly paymentMethods: readonly PaymentMethod[];
  readonly banks: readonly string[];
  readonly memberships: readonly string[];
}

export type PayerReason =
  | 'BANK_NOT_DECLARED'
  | 'PAYMENT_METHOD_NOT_DECLARED'
  | 'MEMBERSHIP_NOT_DECLARED'
  | 'BANK_NOT_ELIGIBLE'
  | 'PAYMENT_METHOD_NOT_ELIGIBLE'
  | 'MEMBERSHIP_NOT_ELIGIBLE';

export type PayerEligibility =
  | { readonly status: 'ELIGIBLE' }
  | { readonly status: 'UNKNOWN'; readonly reason: PayerReason }
  | { readonly status: 'NOT_ELIGIBLE'; readonly reason: PayerReason };

export const EMPTY_PAYER: PayerProfile = { paymentMethods: [], banks: [], memberships: [] };

const includesName = (names: readonly string[], name: string): boolean => {
  const wanted = normalizeName(name);
  return names.some((candidate) => normalizeName(candidate) === wanted);
};

/**
 * Cada condición de la promoción contra lo declarado: una lista vacía es "no lo dijo"
 * (desconocido); una lista sin el valor es "no lo tiene" (no elegible). Si alguna condición no
 * se cumple, no es elegible aunque otras sean desconocidas.
 */
export function payerEligibility(rule: PromotionRule, payer: PayerProfile): PayerEligibility {
  const checks: { required: boolean; declared: boolean; matches: () => boolean; unknown: PayerReason; mismatch: PayerReason }[] = [
    {
      required: rule.bank !== null,
      declared: payer.banks.length > 0,
      matches: () => includesName(payer.banks, rule.bank ?? ''),
      unknown: 'BANK_NOT_DECLARED',
      mismatch: 'BANK_NOT_ELIGIBLE',
    },
    {
      required: rule.paymentMethod !== null,
      declared: payer.paymentMethods.length > 0,
      matches: () => payer.paymentMethods.includes(rule.paymentMethod as PaymentMethod),
      unknown: 'PAYMENT_METHOD_NOT_DECLARED',
      mismatch: 'PAYMENT_METHOD_NOT_ELIGIBLE',
    },
    {
      required: rule.membershipProgram !== null,
      declared: payer.memberships.length > 0,
      matches: () => includesName(payer.memberships, rule.membershipProgram ?? ''),
      unknown: 'MEMBERSHIP_NOT_DECLARED',
      mismatch: 'MEMBERSHIP_NOT_ELIGIBLE',
    },
  ];
  let unknown: PayerReason | null = null;
  for (const check of checks) {
    if (!check.required) continue;
    if (!check.declared) unknown ??= check.unknown;
    else if (!check.matches()) return { status: 'NOT_ELIGIBLE', reason: check.mismatch };
  }
  return unknown ? { status: 'UNKNOWN', reason: unknown } : { status: 'ELIGIBLE' };
}
