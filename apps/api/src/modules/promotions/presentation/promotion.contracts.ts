/**
 * Contrato público de promociones (P2-03). Se refleja en `packages/shared/src/index.ts`.
 *
 * Listar una promoción no afirma que le corresponda a quien mira: `automatic`
 * distingue las que el sistema puede calcular solo de las que dependen de banco,
 * medio de pago, membresía o de un tope que abarca varias compras.
 */
import type { DecimalString } from '../../catalog/presentation/catalog.contracts';
import type { DiscountCapPeriod, PaymentMethod, PromotionRule, PromotionType } from '../domain/promotion.types';

export interface PromotionScopeDto {
  /** Exactamente uno de los dos tiene valor. */
  storeId: string | null;
  chainId: string | null;
  /** Como máximo uno; ninguno significa todo el comercio. */
  productId: string | null;
  canonicalProductId: string | null;
}

export interface PromotionConditionsDto {
  paymentMethod: PaymentMethod | null;
  bank: string | null;
  membershipProgram: string | null;
  minimumSpend: DecimalString | null;
  discountCap: DecimalString | null;
  capPeriod: DiscountCapPeriod | null;
  /** ISO 1 = lunes … 7 = domingo; vacío significa todos los días. */
  eligibleWeekdays: number[];
}

export interface PromotionDto {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScopeDto;
  discountPercentage: DecimalString | null;
  /** Precio final por unidad de venta, no el total del lote. */
  fixedPrice: DecimalString | null;
  requiredQuantity: number | null;
  conditions: PromotionConditionsDto;
  /** false cuando el beneficio depende de datos del usuario o de compras previas. */
  automatic: boolean;
  terms: string | null;
  source: string;
  /** Vigencia `[validFrom, validUntil)`, ISO 8601 en UTC. */
  validFrom: string;
  validUntil: string;
}

/** Una promoción se calcula sola cuando no depende de datos que el sistema no tiene. */
export const isAutomatic = (rule: PromotionRule): boolean =>
  rule.type !== 'BANK_DISCOUNT' &&
  rule.bank === null &&
  rule.paymentMethod === null &&
  rule.membershipProgram === null &&
  (rule.capPeriod === null || rule.capPeriod === 'PURCHASE');

export const toPromotionDto = (rule: PromotionRule): PromotionDto => ({
  id: rule.id,
  name: rule.name,
  type: rule.type,
  scope: {
    storeId: rule.storeId,
    chainId: rule.chainId,
    productId: rule.productId,
    canonicalProductId: rule.canonicalProductId,
  },
  discountPercentage: rule.discountPercentage,
  fixedPrice: rule.fixedPrice,
  requiredQuantity: rule.requiredQuantity,
  conditions: {
    paymentMethod: rule.paymentMethod,
    bank: rule.bank,
    membershipProgram: rule.membershipProgram,
    minimumSpend: rule.minimumSpend,
    discountCap: rule.discountCap,
    capPeriod: rule.capPeriod,
    eligibleWeekdays: [...rule.eligibleWeekdays],
  },
  automatic: isAutomatic(rule),
  terms: rule.terms,
  source: rule.source,
  validFrom: rule.validFrom.toISOString(),
  validUntil: rule.validUntil.toISOString(),
});
