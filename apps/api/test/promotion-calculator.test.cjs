const assert = require('node:assert/strict');
const { test } = require('node:test');
const { priceLine } = require('../dist/modules/promotions/domain/promotion-calculator');
const { planPurchase } = require('../dist/modules/catalog/domain/packaging');

const INSTANT = new Date('2026-09-15T15:00:00.000Z'); // martes 12:00 en Argentina
const TARGET = { storeId: 'store-1', chainId: 'chain-1', productId: 'product-1', canonicalProductId: 'canonical-1' };
const CONTEXT = { target: TARGET, instant: INSTANT };

const BASE_RULE = {
  id: 'promo-1',
  name: 'Promoción demo',
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
  externalId: null,
  validFrom: new Date('2026-09-01T03:00:00.000Z'),
  validUntil: new Date('2026-10-01T03:00:00.000Z'),
};

const rule = (overrides) => ({ ...BASE_RULE, ...overrides });
const line = (unitPrice, quantity, saleMode = 'PACKAGED') => ({ unitPrice, quantity, saleMode });
const reasonOf = (charge, promotionId) =>
  charge.evaluations.find((evaluation) => evaluation.promotionId === promotionId)?.skipReason;

test('sin promociones aplicables se cobra el precio regular', () => {
  const charge = priceLine(line('1290.00', '3'), [], CONTEXT);
  assert.deepEqual(
    { total: charge.total, discount: charge.discount, applied: charge.appliedPromotionId },
    { total: '3870.00', discount: '0.00', applied: null },
  );
  assert.deepEqual(charge.evaluations, []);
});

test('PERCENTAGE descuenta sobre las unidades elegibles', () => {
  const charge = priceLine(line('1290.00', '2'), [rule({})], CONTEXT);
  assert.equal(charge.regularTotal, '2580.00');
  assert.equal(charge.total, '2064.00');
  assert.equal(charge.discount, '516.00');
  assert.equal(charge.appliedPromotionId, 'promo-1');
  assert.equal(charge.evaluations[0].applied, true);
});

test('TWO_FOR_ONE cobra las unidades menos la mitad entera y deja el remanente impar', () => {
  const twoForOne = rule({ type: 'TWO_FOR_ONE', discountPercentage: null });
  const three = priceLine(line('1000.00', '3'), [twoForOne], CONTEXT);
  // Tres unidades pagan dos.
  assert.equal(three.total, '2000.00');
  assert.equal(three.evaluations[0].chargedUnits, '2');
  assert.equal(priceLine(line('1000.00', '4'), [twoForOne], CONTEXT).total, '2000.00');
  assert.equal(priceLine(line('1000.00', '5'), [twoForOne], CONTEXT).total, '3000.00');
  // Una sola unidad no forma par: no hay beneficio que prometer.
  const single = priceLine(line('1000.00', '1'), [twoForOne], CONTEXT);
  assert.equal(single.total, '1000.00');
  assert.equal(single.appliedPromotionId, null);
  assert.equal(reasonOf(single, 'promo-1'), 'NO_SAVINGS');
});

test('SECOND_UNIT descuenta una unidad por cada par completo', () => {
  const secondUnit = rule({ type: 'SECOND_UNIT', discountPercentage: '50.00' });
  // Dos unidades: la segunda al 50%.
  assert.equal(priceLine(line('1000.00', '2'), [secondUnit], CONTEXT).total, '1500.00');
  // Tres: el par tiene beneficio, la tercera se paga entera.
  const three = priceLine(line('1000.00', '3'), [secondUnit], CONTEXT);
  assert.equal(three.total, '2500.00');
  assert.equal(three.evaluations[0].chargedUnits, '2.5');
  // Cuatro: dos pares.
  assert.equal(priceLine(line('1000.00', '4'), [secondUnit], CONTEXT).total, '3000.00');
  assert.equal(reasonOf(priceLine(line('1000.00', '1'), [secondUnit], CONTEXT), 'promo-1'), 'NO_SAVINGS');
});

test('FIXED_PRICE exige la cantidad mínima y nunca encarece', () => {
  const fixed = rule({ type: 'FIXED_PRICE', discountPercentage: null, fixedPrice: '2990.00', requiredQuantity: 2 });
  const two = priceLine(line('3620.00', '2'), [fixed], CONTEXT);
  assert.equal(two.total, '5980.00');
  assert.equal(two.discount, '1260.00');
  const one = priceLine(line('3620.00', '1'), [fixed], CONTEXT);
  assert.equal(one.total, '3620.00');
  assert.equal(reasonOf(one, 'promo-1'), 'QUANTITY_BELOW_MINIMUM');
  // Un "precio fijo" más caro que el regular no es un beneficio.
  const expensive = priceLine(line('2500.00', '2'), [fixed], CONTEXT);
  assert.equal(expensive.total, '5000.00');
  assert.equal(reasonOf(expensive, 'promo-1'), 'NO_SAVINGS');
});

test('BANK_DISCOUNT se informa pero no se aplica', () => {
  const bank = rule({ type: 'BANK_DISCOUNT', discountPercentage: '25.00', bank: 'Banco Demo', paymentMethod: 'CREDIT_CARD' });
  const charge = priceLine(line('1000.00', '2'), [bank], CONTEXT);
  assert.equal(charge.total, '2000.00');
  assert.equal(charge.appliedPromotionId, null);
  assert.equal(reasonOf(charge, 'promo-1'), 'PAYMENT_CONDITIONED');
  // Pero sigue visible en la traza, con su nombre y tipo.
  assert.equal(charge.evaluations[0].type, 'BANK_DISCOUNT');
});

test('un mínimo de compra sin subtotal conocido no se asume cumplido', () => {
  const withMinimum = rule({ minimumSpend: '20000.00' });
  const unknown = priceLine(line('1000.00', '2'), [withMinimum], CONTEXT);
  assert.equal(unknown.appliedPromotionId, null);
  assert.equal(reasonOf(unknown, 'promo-1'), 'MINIMUM_SPEND_UNKNOWN');

  const below = priceLine(line('1000.00', '2'), [withMinimum], { ...CONTEXT, eligibleSubtotal: '5000.00' });
  assert.equal(reasonOf(below, 'promo-1'), 'MINIMUM_SPEND_NOT_REACHED');

  const reached = priceLine(line('1000.00', '2'), [withMinimum], { ...CONTEXT, eligibleSubtotal: '20000.00' });
  assert.equal(reached.total, '1600.00');
});

test('el tope por compra limita el beneficio', () => {
  const capped = rule({ discountPercentage: '50.00', discountCap: '1000.00', capPeriod: 'PURCHASE' });
  // 50% de 10.000 serían 5.000, pero el tope deja el descuento en 1.000.
  const charge = priceLine(line('5000.00', '2'), [capped], CONTEXT);
  assert.equal(charge.discount, '1000.00');
  assert.equal(charge.total, '9000.00');
  // Por debajo del tope, el descuento es el que corresponde.
  assert.equal(priceLine(line('500.00', '2'), [capped], CONTEXT).discount, '500.00');
});

test('las promociones por pares no aplican a venta por peso', () => {
  const twoForOne = rule({ type: 'TWO_FOR_ONE', discountPercentage: null });
  const bulk = priceLine(line('8900.00', '1.5', 'VARIABLE_WEIGHT'), [twoForOne], CONTEXT);
  assert.equal(reasonOf(bulk, 'promo-1'), 'SALE_MODE_UNSUPPORTED');
  // Un porcentaje sí puede aplicarse sobre el peso comprado.
  const percentage = priceLine(line('8900.00', '1.5', 'VARIABLE_WEIGHT'), [rule({})], CONTEXT);
  assert.equal(percentage.regularTotal, '13350.00');
  assert.equal(percentage.total, '10680.00');
  // Un envasado no se compra por fracciones.
  assert.throws(() => priceLine(line('1000.00', '1.5'), [], CONTEXT), RangeError);
  assert.throws(() => priceLine(line('0', '1'), [], CONTEXT), RangeError);
  assert.throws(() => priceLine(line('1000.00', '0'), [], CONTEXT), RangeError);
});

test('elige la promoción que más conviene y no acumula, de forma determinista', () => {
  const percentage = rule({ id: 'b-percentage', discountPercentage: '10.00' });
  const twoForOne = rule({ id: 'a-two-for-one', type: 'TWO_FOR_ONE', discountPercentage: null });
  const charge = priceLine(line('1000.00', '2'), [percentage, twoForOne], CONTEXT);
  // 2x1 ahorra 1.000; el 10% ahorra 200.
  assert.equal(charge.appliedPromotionId, 'a-two-for-one');
  assert.equal(charge.total, '1000.00');
  assert.equal(charge.discount, '1000.00');
  assert.equal(charge.evaluations.filter((evaluation) => evaluation.applied).length, 1, 'no se acumulan');
  // La perdedora conserva su cálculo para poder explicarlo.
  const loser = charge.evaluations.find((evaluation) => evaluation.promotionId === 'b-percentage');
  assert.equal(loser.total, '1800.00');
  assert.equal(loser.applied, false);

  // Empate: gana el id más chico, no el orden de entrada.
  const tieA = rule({ id: 'aaa', discountPercentage: '10.00' });
  const tieB = rule({ id: 'bbb', discountPercentage: '10.00' });
  assert.equal(priceLine(line('1000.00', '2'), [tieA, tieB], CONTEXT).appliedPromotionId, 'aaa');
  assert.equal(priceLine(line('1000.00', '2'), [tieB, tieA], CONTEXT).appliedPromotionId, 'aaa');
});

test('el redondeo monetario ocurre una sola vez y el ahorro cierra con el total', () => {
  // 33,33% de 999,99 x 3: el intermedio no es exacto.
  const charge = priceLine(line('999.99', '3'), [rule({ discountPercentage: '33.33' })], CONTEXT);
  assert.equal(charge.regularTotal, '2999.97');
  assert.equal(charge.total, '2000.08');
  assert.equal(charge.discount, '999.89');
  const regular = Number(charge.regularTotal);
  assert.equal((Number(charge.total) + Number(charge.discount)).toFixed(2), regular.toFixed(2));
  // Importes con dos decimales exactos, sin notación científica ni flotantes.
  for (const value of [charge.regularTotal, charge.total, charge.discount]) assert.match(value, /^\d+\.\d{2}$/);
});

test('una promoción cambia cuál presentación conviene', () => {
  // Sin promoción, el kilo (1290) es más barato por kilo que dos de 500 g (720 c/u).
  const kilo = priceLine(line('1290.00', '1'), [], CONTEXT);
  const medioSinPromo = priceLine(line('720.00', '2'), [], CONTEXT);
  assert.ok(Number(kilo.total) < Number(medioSinPromo.total));

  // Con 2x1 en el paquete de 500 g, comprar dos medios kilos pasa a convenir.
  const twoForOne = rule({ type: 'TWO_FOR_ONE', discountPercentage: null, productId: 'product-1' });
  const medioConPromo = priceLine(line('720.00', '2'), [twoForOne], CONTEXT);
  assert.equal(medioConPromo.total, '720.00');
  assert.ok(Number(medioConPromo.total) < Number(kilo.total));
});

test('los envases se compran enteros y el excedente queda a la vista', () => {
  // Se necesitan 3 L y el envase trae 2 L: dos envases, sobra 1 L.
  assert.deepEqual(planPurchase({ neededQuantity: '3', packageQuantity: '2', saleMode: 'PACKAGED' }), {
    units: '2',
    purchasedQuantity: '4',
    surplus: '1',
  });
  assert.deepEqual(planPurchase({ neededQuantity: '4', packageQuantity: '2', saleMode: 'PACKAGED' }), {
    units: '2',
    purchasedQuantity: '4',
    surplus: '0',
  });
  assert.deepEqual(planPurchase({ neededQuantity: '0.5', packageQuantity: '1', saleMode: 'PACKAGED' }), {
    units: '1',
    purchasedQuantity: '1',
    surplus: '0.5',
  });
  // Venta por peso: se compra exactamente lo necesario.
  assert.deepEqual(planPurchase({ neededQuantity: '1.25', packageQuantity: '1', saleMode: 'VARIABLE_WEIGHT' }), {
    units: '1.25',
    purchasedQuantity: '1.25',
    surplus: '0',
  });
  assert.throws(() => planPurchase({ neededQuantity: '0', packageQuantity: '1', saleMode: 'PACKAGED' }), RangeError);
  assert.throws(() => planPurchase({ neededQuantity: '1', packageQuantity: '0', saleMode: 'PACKAGED' }), RangeError);
});
