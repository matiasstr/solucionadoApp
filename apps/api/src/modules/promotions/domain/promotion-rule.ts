/**
 * Validación de una regla promocional. Una regla incompleta se rechaza: es
 * preferible no ofrecer el beneficio a calcular un ahorro que no existe.
 * Refuerza en la aplicación los mismos CHECK que tiene la tabla `Promotion`.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { PromotionRule, PromotionType } from './promotion.types';

export type PromotionErrorCode =
  | 'NAME_REQUIRED'
  | 'COMMERCIAL_SCOPE'
  | 'PRODUCT_SCOPE'
  | 'VALIDITY_RANGE'
  | 'PERCENTAGE_REQUIRED'
  | 'PERCENTAGE_RANGE'
  | 'PERCENTAGE_NOT_ALLOWED'
  | 'FIXED_PRICE_REQUIRED'
  | 'FIXED_PRICE_NOT_ALLOWED'
  | 'BANK_CONDITION_REQUIRED'
  | 'DISCOUNT_AMOUNT'
  | 'REFUND'
  | 'CAP_GROUP'
  | 'REQUIRED_QUANTITY'
  | 'MINIMUM_SPEND'
  | 'DISCOUNT_CAP'
  | 'WEEKDAYS'
  | 'SOURCE_REQUIRED';

export class PromotionValidationError extends Error {
  constructor(
    readonly code: PromotionErrorCode,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = 'PromotionValidationError';
  }
}

const MAX_REQUIRED_QUANTITY = 100;
const PERCENTAGE_TYPES: readonly PromotionType[] = ['PERCENTAGE', 'SECOND_UNIT'];
const MAX_REFUND_DELAY_DAYS = 180;

function positiveAmount(value: string, code: PromotionErrorCode, field: string): DecimalValue {
  let amount: DecimalValue;
  try {
    amount = DecimalValue.parse(value);
  } catch {
    throw new PromotionValidationError(code, `El valor de ${field} no es un decimal válido.`, [field]);
  }
  if (!amount.isPositive()) {
    throw new PromotionValidationError(code, `El valor de ${field} debe ser mayor que cero.`, [field]);
  }
  return amount;
}

/** Lanza `PromotionValidationError` si la regla no es aplicable tal como está escrita. */
export function validatePromotionRule(rule: PromotionRule): void {
  if (!rule.name.trim()) {
    throw new PromotionValidationError('NAME_REQUIRED', 'La promoción necesita un nombre.', ['name']);
  }
  if (!rule.source.trim()) {
    throw new PromotionValidationError('SOURCE_REQUIRED', 'La promoción necesita una fuente.', ['source']);
  }
  // Una promoción es de una sucursal o de una cadena, nunca de las dos.
  if ((rule.storeId === null) === (rule.chainId === null)) {
    throw new PromotionValidationError('COMMERCIAL_SCOPE', 'Indicá una sucursal o una cadena, no ambas.', [
      'storeId',
      'chainId',
    ]);
  }
  if (rule.productId !== null && rule.canonicalProductId !== null) {
    throw new PromotionValidationError('PRODUCT_SCOPE', 'Una promoción apunta a un producto o a un canónico, no a los dos.', [
      'productId',
      'canonicalProductId',
    ]);
  }
  if (!(rule.validUntil.getTime() > rule.validFrom.getTime())) {
    throw new PromotionValidationError('VALIDITY_RANGE', 'La vigencia debe terminar después de empezar.', [
      'validFrom',
      'validUntil',
    ]);
  }

  // Un descuento bancario es por porcentaje **o** por monto fijo (P10-01).
  if (rule.type === 'BANK_DISCOUNT') {
    if ((rule.discountPercentage === null) === (rule.discountAmount === null)) {
      throw new PromotionValidationError('DISCOUNT_AMOUNT', 'Un descuento bancario es por porcentaje o por monto, uno solo.', [
        'discountPercentage',
        'discountAmount',
      ]);
    }
    if (rule.discountAmount !== null) positiveAmount(rule.discountAmount, 'DISCOUNT_AMOUNT', 'discountAmount');
  } else if (rule.discountAmount !== null) {
    throw new PromotionValidationError('DISCOUNT_AMOUNT', `El tipo ${rule.type} no lleva monto de descuento.`, ['discountAmount']);
  }

  const needsPercentage = PERCENTAGE_TYPES.includes(rule.type);
  if (needsPercentage || (rule.type === 'BANK_DISCOUNT' && rule.discountPercentage !== null)) {
    if (rule.discountPercentage === null) {
      throw new PromotionValidationError('PERCENTAGE_REQUIRED', `El tipo ${rule.type} necesita un porcentaje.`, [
        'discountPercentage',
      ]);
    }
    const percentage = positiveAmount(rule.discountPercentage, 'PERCENTAGE_RANGE', 'discountPercentage');
    if (percentage.compare(DecimalValue.parse('100')) > 0) {
      throw new PromotionValidationError('PERCENTAGE_RANGE', 'El porcentaje debe estar entre 0 y 100.', [
        'discountPercentage',
      ]);
    }
  } else if (rule.discountPercentage !== null) {
    throw new PromotionValidationError('PERCENTAGE_NOT_ALLOWED', `El tipo ${rule.type} no lleva porcentaje.`, [
      'discountPercentage',
    ]);
  }

  if (rule.type === 'FIXED_PRICE') {
    if (rule.fixedPrice === null) {
      throw new PromotionValidationError('FIXED_PRICE_REQUIRED', 'El precio fijo es obligatorio para FIXED_PRICE.', [
        'fixedPrice',
      ]);
    }
    positiveAmount(rule.fixedPrice, 'FIXED_PRICE_REQUIRED', 'fixedPrice');
  } else if (rule.fixedPrice !== null) {
    throw new PromotionValidationError('FIXED_PRICE_NOT_ALLOWED', `El tipo ${rule.type} no lleva precio fijo.`, [
      'fixedPrice',
    ]);
  }

  if (rule.type === 'BANK_DISCOUNT' && rule.bank === null && rule.paymentMethod === null) {
    throw new PromotionValidationError('BANK_CONDITION_REQUIRED', 'Un descuento bancario necesita banco o medio de pago.', [
      'bank',
      'paymentMethod',
    ]);
  }

  if (rule.requiredQuantity !== null) {
    if (!Number.isInteger(rule.requiredQuantity) || rule.requiredQuantity < 1 || rule.requiredQuantity > MAX_REQUIRED_QUANTITY) {
      throw new PromotionValidationError('REQUIRED_QUANTITY', 'La cantidad mínima debe ser un entero positivo razonable.', [
        'requiredQuantity',
      ]);
    }
  }
  if (rule.minimumSpend !== null) positiveAmount(rule.minimumSpend, 'MINIMUM_SPEND', 'minimumSpend');

  // Tope y período van juntos: un tope sin período no se puede evaluar.
  if ((rule.discountCap === null) !== (rule.capPeriod === null)) {
    throw new PromotionValidationError('DISCOUNT_CAP', 'El tope y su período se informan juntos.', [
      'discountCap',
      'capPeriod',
    ]);
  }
  if (rule.discountCap !== null) positiveAmount(rule.discountCap, 'DISCOUNT_CAP', 'discountCap');
  if (rule.capGroup !== null && (rule.discountCap === null || !rule.capGroup.trim())) {
    throw new PromotionValidationError('CAP_GROUP', 'Compartir un tope exige tenerlo.', ['capGroup', 'discountCap']);
  }

  // El reintegro es un beneficio de pago; su plazo solo existe si es reintegro.
  if (rule.benefitTiming === 'REFUND' && rule.type !== 'BANK_DISCOUNT') {
    throw new PromotionValidationError('REFUND', 'Solo un beneficio de pago puede ser un reintegro.', ['benefitTiming']);
  }
  if (rule.refundDelayDays !== null) {
    if (rule.benefitTiming !== 'REFUND') {
      throw new PromotionValidationError('REFUND', 'El plazo de reintegro solo va en un reintegro.', ['refundDelayDays']);
    }
    if (!Number.isInteger(rule.refundDelayDays) || rule.refundDelayDays < 1 || rule.refundDelayDays > MAX_REFUND_DELAY_DAYS) {
      throw new PromotionValidationError('REFUND', `El plazo de reintegro va de 1 a ${MAX_REFUND_DELAY_DAYS} días.`, ['refundDelayDays']);
    }
  }

  const weekdays = rule.eligibleWeekdays;
  if (weekdays.length > 7 || new Set(weekdays).size !== weekdays.length) {
    throw new PromotionValidationError('WEEKDAYS', 'Los días elegibles no pueden repetirse.', ['eligibleWeekdays']);
  }
  if (weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new PromotionValidationError('WEEKDAYS', 'Los días elegibles usan ISO 1 (lunes) a 7 (domingo).', [
      'eligibleWeekdays',
    ]);
  }
}
