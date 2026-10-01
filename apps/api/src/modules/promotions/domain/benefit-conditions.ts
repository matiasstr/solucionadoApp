/**
 * Condiciones legibles de una promoción (P10-02, ADR 0024): banco, medio, membresía, días,
 * mínimo, tope, momento del beneficio y acumulación viajan juntas al plan y al comparador,
 * para que ninguna condición importante quede oculta.
 */
import type { BenefitTiming, DiscountCapPeriod, PaymentMethod, PromotionRule, PromotionType } from './promotion.types';

export interface BenefitConditions {
  readonly type: PromotionType;
  readonly discountPercentage: string | null;
  readonly discountAmount: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly bank: string | null;
  readonly membershipProgram: string | null;
  /** ISO 1 = lunes … 7 = domingo; vacío = todos los días. */
  readonly eligibleWeekdays: readonly number[];
  readonly minimumSpend: string | null;
  readonly discountCap: string | null;
  readonly capPeriod: DiscountCapPeriod | null;
  readonly timing: BenefitTiming;
  readonly refundDelayDays: number | null;
  readonly stackable: boolean;
}

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

/** Depende de cómo paga o de qué programa es socia la persona: no se calcula sin sus preferencias. */
export const dependsOnPayer = (rule: PromotionRule): boolean =>
  rule.type === 'BANK_DISCOUNT' || rule.bank !== null || rule.paymentMethod !== null || rule.membershipProgram !== null;
