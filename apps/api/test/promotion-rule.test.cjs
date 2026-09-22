const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PromotionValidationError,
  validatePromotionRule,
} = require('../dist/modules/promotions/domain/promotion-rule');
const {
  argentineIsoWeekday,
  isWithinValidity,
  matchesTarget,
  promotionSkipReason,
} = require('../dist/modules/promotions/domain/promotion-eligibility');

const BASE = {
  id: 'promo-1',
  name: '20% en arroz',
  type: 'PERCENTAGE',
  storeId: 'store-1',
  chainId: null,
  productId: 'product-1',
  canonicalProductId: null,
  discountPercentage: '20.00',
  fixedPrice: null,
  requiredQuantity: null,
  paymentMethod: null,
  bank: null,
  membershipProgram: null,
  minimumSpend: null,
  discountCap: null,
  capPeriod: null,
  eligibleWeekdays: [],
  isStackable: false,
  terms: null,
  source: 'demo-seed',
  externalId: 'promo-1',
  validFrom: new Date('2026-09-01T03:00:00.000Z'),
  validUntil: new Date('2026-10-01T03:00:00.000Z'),
};

const rule = (overrides) => ({ ...BASE, ...overrides });
const rejects = (overrides, code) =>
  assert.throws(
    () => validatePromotionRule(rule(overrides)),
    (error) => error instanceof PromotionValidationError && error.code === code,
    `debería fallar con ${code}: ${JSON.stringify(Object.keys(overrides))}`,
  );

const TARGET = { storeId: 'store-1', chainId: 'chain-1', productId: 'product-1', canonicalProductId: 'canonical-1' };

test('acepta las cuatro promociones simples bien formadas', () => {
  validatePromotionRule(rule({}));
  validatePromotionRule(rule({ type: 'SECOND_UNIT', discountPercentage: '50.00' }));
  validatePromotionRule(rule({ type: 'TWO_FOR_ONE', discountPercentage: null }));
  validatePromotionRule(rule({ type: 'FIXED_PRICE', discountPercentage: null, fixedPrice: '2990.00', requiredQuantity: 2 }));
  validatePromotionRule(rule({ type: 'BANK_DISCOUNT', bank: 'Banco Demo', paymentMethod: 'CREDIT_CARD' }));
  // Sin alcance de producto cubre todo el comercio.
  validatePromotionRule(rule({ productId: null, canonicalProductId: null }));
  validatePromotionRule(rule({ storeId: null, chainId: 'chain-1' }));
});

test('rechaza reglas incompletas en vez de calcular un ahorro inexistente', () => {
  rejects({ name: '   ' }, 'NAME_REQUIRED');
  rejects({ source: '' }, 'SOURCE_REQUIRED');
  // Una sucursal o una cadena, nunca las dos ni ninguna.
  rejects({ chainId: 'chain-1' }, 'COMMERCIAL_SCOPE');
  rejects({ storeId: null, chainId: null }, 'COMMERCIAL_SCOPE');
  rejects({ canonicalProductId: 'canonical-1' }, 'PRODUCT_SCOPE');
  rejects({ validUntil: BASE.validFrom }, 'VALIDITY_RANGE');
  rejects({ discountPercentage: null }, 'PERCENTAGE_REQUIRED');
  rejects({ discountPercentage: '0' }, 'PERCENTAGE_RANGE');
  rejects({ discountPercentage: '100.01' }, 'PERCENTAGE_RANGE');
  rejects({ discountPercentage: '-10' }, 'PERCENTAGE_RANGE');
  rejects({ type: 'TWO_FOR_ONE' }, 'PERCENTAGE_NOT_ALLOWED');
  rejects({ type: 'FIXED_PRICE', discountPercentage: null }, 'FIXED_PRICE_REQUIRED');
  rejects({ fixedPrice: '100.00' }, 'FIXED_PRICE_NOT_ALLOWED');
  rejects({ type: 'BANK_DISCOUNT' }, 'BANK_CONDITION_REQUIRED');
  rejects({ requiredQuantity: 0 }, 'REQUIRED_QUANTITY');
  rejects({ requiredQuantity: 1.5 }, 'REQUIRED_QUANTITY');
  rejects({ minimumSpend: '0' }, 'MINIMUM_SPEND');
  // Tope y período van juntos o no van.
  rejects({ discountCap: '5000.00' }, 'DISCOUNT_CAP');
  rejects({ capPeriod: 'PURCHASE' }, 'DISCOUNT_CAP');
  rejects({ eligibleWeekdays: [1, 1] }, 'WEEKDAYS');
  rejects({ eligibleWeekdays: [0] }, 'WEEKDAYS');
  rejects({ eligibleWeekdays: [8] }, 'WEEKDAYS');
});

test('la vigencia incluye el inicio y excluye el final', () => {
  const promotion = rule({});
  assert.equal(isWithinValidity(promotion, new Date('2026-09-01T03:00:00.000Z')), true);
  assert.equal(isWithinValidity(promotion, new Date('2026-09-30T23:59:59.999Z')), true);
  assert.equal(isWithinValidity(promotion, new Date('2026-10-01T03:00:00.000Z')), false);
  assert.equal(promotionSkipReason(promotion, TARGET, new Date('2026-08-31T00:00:00.000Z')), 'NOT_STARTED');
  assert.equal(promotionSkipReason(promotion, TARGET, new Date('2026-10-02T00:00:00.000Z')), 'EXPIRED');
  assert.equal(promotionSkipReason(promotion, TARGET, new Date('2026-09-15T12:00:00.000Z')), null);
});

test('el alcance distingue sucursal, cadena, producto y canónico', () => {
  assert.equal(matchesTarget(rule({}), TARGET), true);
  assert.equal(matchesTarget(rule({ storeId: 'otra' }), TARGET), false);
  assert.equal(matchesTarget(rule({ storeId: null, chainId: 'chain-1' }), TARGET), true);
  assert.equal(matchesTarget(rule({ storeId: null, chainId: 'otra' }), TARGET), false);
  assert.equal(matchesTarget(rule({ productId: null, canonicalProductId: 'canonical-1' }), TARGET), true);
  assert.equal(matchesTarget(rule({ productId: null, canonicalProductId: 'otro' }), TARGET), false);
  // Sin alcance de producto alcanza a todo el comercio.
  assert.equal(matchesTarget(rule({ productId: null, canonicalProductId: null }), TARGET), true);

  const instant = new Date('2026-09-15T12:00:00.000Z');
  assert.equal(promotionSkipReason(rule({ storeId: 'otra' }), TARGET, instant), 'SCOPE_STORE');
  assert.equal(promotionSkipReason(rule({ productId: 'otro' }), TARGET, instant), 'SCOPE_PRODUCT');
});

test('los días elegibles se leen en el calendario argentino, no en UTC', () => {
  // Domingo 21:00 en Argentina es lunes 00:00 UTC: vale el día argentino.
  const sundayNight = new Date('2026-09-14T00:00:00.000Z');
  assert.equal(argentineIsoWeekday(sundayNight), 7);
  assert.equal(new Date(sundayNight).getUTCDay(), 1);
  const mondayMorning = new Date('2026-09-14T15:00:00.000Z');
  assert.equal(argentineIsoWeekday(mondayMorning), 1);

  const onlyMonday = rule({ eligibleWeekdays: [1] });
  assert.equal(promotionSkipReason(onlyMonday, TARGET, sundayNight), 'WEEKDAY_NOT_ELIGIBLE');
  assert.equal(promotionSkipReason(onlyMonday, TARGET, mondayMorning), null);
  // Lista vacía significa todos los días.
  assert.equal(promotionSkipReason(rule({}), TARGET, sundayNight), null);
});

test('lo que depende del usuario o de compras previas no se aplica solo', () => {
  const instant = new Date('2026-09-15T12:00:00.000Z');
  assert.equal(
    promotionSkipReason(rule({ type: 'BANK_DISCOUNT', bank: 'Banco Demo' }), TARGET, instant),
    'PAYMENT_CONDITIONED',
  );
  assert.equal(promotionSkipReason(rule({ paymentMethod: 'DEBIT_CARD' }), TARGET, instant), 'PAYMENT_CONDITIONED');
  assert.equal(promotionSkipReason(rule({ membershipProgram: 'Club Demo' }), TARGET, instant), 'MEMBERSHIP_CONDITIONED');
  // Un tope semanal exige saber cuánto beneficio ya se usó.
  assert.equal(
    promotionSkipReason(rule({ discountCap: '5000.00', capPeriod: 'WEEK' }), TARGET, instant),
    'CAP_PERIOD_UNSUPPORTED',
  );
  assert.equal(promotionSkipReason(rule({ discountCap: '5000.00', capPeriod: 'PURCHASE' }), TARGET, instant), null);
});
