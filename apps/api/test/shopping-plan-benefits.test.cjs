const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DecimalValue } = require('../dist/modules/catalog/domain/decimal');
const { evaluateBenefits } = require('../dist/modules/promotions/domain/benefit-engine');
const { buildCandidates } = require('../dist/modules/shopping-plans/domain/candidates');
const { argentineNoon, resolvePlanWindow } = require('../dist/modules/shopping-plans/domain/plan-calendar');
const { costRelevantRules, isLineVerifiable } = require('../dist/modules/shopping-plans/domain/plan-benefits');
const { optimizePlan } = require('../dist/modules/shopping-plans/domain/plan-optimizer');
const { toPlanRecord } = require('../dist/modules/shopping-plans/domain/plan-snapshot');

// Lunes 2026-09-28 a domingo 2026-10-04: miércoles 30; el jueves 1 ya es octubre (otro mes de tope).
const WINDOW = resolvePlanWindow({ startDate: '2026-09-28' }, 28);
const WEEK = WINDOW.dates;
const NOW = new Date('2026-09-28T18:00:00.000Z');
const YESTERDAY = new Date('2026-09-27T12:00:00.000Z');
const COORDINATES = { origin: 'COORDINATES', radiusKm: 5, city: null, province: null };
const LIMITS = { maxStores: 8, maxOffersPerStore: 2, maxDates: 7 };
const SETTINGS = { storeVisitPenalty: '0.00', distancePenaltyPerKm: '0.00', maxStores: 2, maxCombinations: 100000 };
const DEBIT_DEMO = { paymentMethods: ['DEBIT_CARD'], banks: ['Banco Demo'], memberships: [] };
const NOBODY = { paymentMethods: [], banks: [], memberships: [] };

const product = (id, canonicalProductId, overrides = {}) => ({
  id,
  ean: null,
  name: id,
  normalizedName: id,
  brand: null,
  categoryId: 'cat',
  canonicalProductId,
  quantity: '1',
  unit: 'KG',
  saleMode: 'PACKAGED',
  packageCount: 1,
  isActive: true,
  ...overrides,
});
const PRODUCTS = [product('p-x', 'c-x'), product('p-x2', 'c-x'), product('p-y', 'c-y'), product('p-z', 'c-z')];
const store = (id, distanceMeters = null, chainId = `ch-${id}`) => ({
  id,
  name: `Sucursal ${id}`,
  chainId,
  chainName: `Cadena ${chainId}`,
  city: 'Ciudad',
  province: 'Provincia',
  distanceMeters,
});
const price = (productId, storeId, value) => ({
  id: `obs-${productId}-${storeId}`,
  productId,
  storeId,
  price: value,
  unitPrice: value,
  unitPriceUnit: 'KG',
  currency: 'ARS',
  source: 'demo-seed',
  observedAt: YESTERDAY,
  ingestedAt: YESTERDAY,
});
const need = (canonicalProductId, netQuantity = '1') => ({
  canonicalProductId,
  canonicalName: `Producto ${canonicalProductId}`,
  unit: 'KG',
  grossQuantity: netQuantity,
  netQuantity,
  firstOccurrence: '2026-09-28',
  inventory: null,
  sources: [],
  status: 'TO_BUY',
  constraints: { allowSubstitutes: true, requiredProductId: null, preferredProductIds: [], preferredBrands: [], excludedBrands: [] },
});
const promotion = (id, overrides) => ({
  id,
  name: `Promo ${id}`,
  type: 'PERCENTAGE',
  storeId: null,
  chainId: null,
  productId: null,
  canonicalProductId: null,
  discountPercentage: null,
  fixedPrice: null,
  requiredQuantity: null,
  paymentMethod: null,
  bank: null,
  membershipProgram: null,
  minimumSpend: null,
  discountCap: null,
  capPeriod: null,
  discountAmount: null,
  benefitTiming: 'IMMEDIATE',
  refundDelayDays: null,
  capGroup: null,
  eligibleWeekdays: [],
  isStackable: false,
  terms: null,
  source: 'demo-seed',
  externalId: null,
  validFrom: new Date('2026-09-01T12:00:00.000Z'),
  validUntil: new Date('2026-10-30T12:00:00.000Z'),
  ...overrides,
});
const bank = (id, chainId, overrides = {}) =>
  promotion(id, { type: 'BANK_DISCOUNT', chainId, bank: 'Banco Demo', paymentMethod: 'DEBIT_CARD', ...overrides });

function candidatesFrom({ needs, stores, prices, promotions = [], dates = WEEK }) {
  return {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    window: WINDOW,
    scope: COORDINATES,
    limits: LIMITS,
    maxAgeDays: 7,
    needs,
    skippedItems: [],
    candidates: buildCandidates({ needs, products: PRODUCTS, stores, prices, promotions, dates, scope: COORDINATES, limits: LIMITS, now: NOW, maxAgeDays: 7 }),
  };
}
const context = (rules, payer = DEBIT_DEMO, capUsage = [], maxEvaluations = 3000) => ({ rules, payer, capUsage, maxEvaluations });
const plan = (scenario, payer = DEBIT_DEMO, options = {}) => {
  const candidates = candidatesFrom(scenario);
  const result = optimizePlan(candidates, { ...SETTINGS, ...options.settings }, context(scenario.promotions ?? [], payer, options.capUsage ?? [], options.maxEvaluations));
  assertRecordChecks(toPlanRecord(candidates, result));
  return result;
};
const codes = (items) => items.map((item) => item.code);
const at = (result, canonical) => result.lines.find((line) => line.canonicalProductId === canonical);
const sum = (values) => values.reduce((total, value) => total.add(DecimalValue.parse(value)), DecimalValue.zero(2)).toFixed(2);
const minus = (a, b) => DecimalValue.parse(a).subtract(DecimalValue.parse(b)).toFixed(2);

/** Las columnas guardadas cumplen los CHECK de `ShoppingPlan` aun con descuentos de pago. */
function assertRecordChecks(record) {
  const amount = (value) => DecimalValue.parse(value);
  assert.ok(amount(record.effectiveCost).equals(amount(record.optimizedCost).add(amount(record.storeVisitPenaltyCost)).add(amount(record.distancePenaltyCost))));
  assert.ok(amount(record.estimatedSavings).equals(amount(record.estimatedRegularCost).subtract(amount(record.optimizedCost))));
  assert.equal(record.resultSnapshot.schemaVersion, 2);
}

/** Los importes del plan cierran entre sí, por visita y contra la base. */
function assertTotalsClose(result, context = '') {
  const { totals } = result;
  assert.equal(totals.productCost, sum(result.lines.map((line) => line.total)), context);
  assert.equal(totals.payToday, minus(totals.productCost, totals.paymentDiscount), context);
  assert.equal(totals.costAfterRefund, minus(totals.payToday, totals.refundEstimated), context);
  assert.equal(totals.effectiveCost, sum([totals.payToday, totals.storeVisitPenaltyCost, totals.distancePenaltyCost]), context);
  assert.equal(totals.effectiveCostAfterRefund, sum([totals.costAfterRefund, totals.storeVisitPenaltyCost, totals.distancePenaltyCost]), context);
  assert.equal(sum(result.visits.map((visit) => visit.payToday)), totals.payToday, context);
  assert.equal(sum(result.visits.map((visit) => visit.refundEstimated)), totals.refundEstimated, context);
  for (const visit of result.visits) {
    assert.equal(visit.payToday, minus(visit.subtotal, visit.paymentDiscount), context);
    if (visit.payment) assert.equal(visit.payment.timing === 'IMMEDIATE' ? visit.paymentDiscount : visit.refundEstimated, visit.payment.amount, context);
  }
  if (result.savings) {
    // El ahorro nunca incluye reintegros: base contra lo que se paga hoy.
    assert.equal(result.savings.estimatedSavings, minus(result.baseline.productCost, totals.payToday), context);
  }
}

test('qué reglas cambian el costo de una canasta: solo las aplicables que priceLine no cobra', () => {
  const simple = promotion('simple', { chainId: 'ch-a', productId: 'p-x', discountPercentage: '10.00' });
  const minimum = promotion('minimo', { chainId: 'ch-a', discountPercentage: '10.00', minimumSpend: '5000.00' });
  const debit = bank('debito', 'ch-a', { discountPercentage: '20.00' });
  const credit = bank('credito', 'ch-a', { discountPercentage: '20.00', paymentMethod: 'CREDIT_CARD' });
  assert.equal(isLineVerifiable(simple), true);
  assert.deepEqual([minimum, debit, credit].map(isLineVerifiable), [false, false, false]);
  assert.deepEqual(costRelevantRules([simple, minimum, debit, credit], DEBIT_DEMO).map((rule) => rule.id), ['minimo', 'debito']);
  // Sin declarar nada, un beneficio de pago queda condicionado: no cambia el costo.
  assert.deepEqual(costRelevantRules([simple, minimum, debit, credit], NOBODY).map((rule) => rule.id), ['minimo']);
});

test('sin preferencias declaradas: mismo plan que por líneas, el descuento bancario condicionado y sin sumar', () => {
  const scenario = {
    needs: [need('c-x')],
    stores: [store('a'), store('b')],
    prices: [price('p-x', 'a', '1000.00'), price('p-x', 'b', '1050.00')],
    promotions: [bank('b-20', 'ch-b', { discountPercentage: '20.00' })],
  };
  const result = plan(scenario, NOBODY);
  const lineOnly = optimizePlan(candidatesFrom(scenario), SETTINGS);
  assert.equal(result.search.basketSearch, 'NOT_NEEDED');
  assert.equal(result.search.method, lineOnly.search.method);
  assert.equal(at(result, 'c-x').storeId, 'a');
  assert.deepEqual(
    [result.totals.payToday, result.totals.paymentDiscount, result.totals.conditionalAmount],
    [lineOnly.totals.productCost, '0.00', '0.00'],
    'la sucursal elegida no tiene beneficio: no hay nada condicionado en el plan',
  );
  assert.equal(result.benefits.payer.declared, false);
  assert.match(result.benefits.criteria[0], /No declaraste/);
  assert.ok(!codes(result.limitations).includes('PAYMENT_PROMOTIONS_EXCLUDED'), 'la evaluación por canasta reemplaza el aviso genérico');
  assertTotalsClose(result);

  // Si solo existe la sucursal con beneficio, se informa como condicionado con su importe posible.
  const only = plan({ ...scenario, stores: [store('b')] }, NOBODY);
  const visit = only.visits[0];
  assert.equal(visit.payment, null);
  assert.deepEqual(
    visit.benefitNotes.map((note) => [note.promotionId, note.status, note.reason, note.amount]),
    [['b-20', 'CONDITIONAL', 'BANK_NOT_DECLARED', '210.00']],
  );
  assert.equal(visit.benefitNotes[0].conditions.bank, 'Banco Demo');
  assert.equal(only.totals.conditionalAmount, '210.00');
  assert.equal(only.totals.payToday, '1050.00');
  assert.ok(codes(only.limitations).includes('BENEFITS_CONDITIONAL'));
});

test('descuento en caja confirmado: cambia la sucursal elegida y entra en el ahorro estimado', () => {
  const scenario = {
    needs: [need('c-x')],
    stores: [store('a'), store('b')],
    prices: [price('p-x', 'a', '1000.00'), price('p-x', 'b', '1050.00')],
    promotions: [bank('b-20', 'ch-b', { discountPercentage: '20.00' })],
  };
  const result = plan(scenario);
  assert.equal(at(result, 'c-x').storeId, 'b');
  assert.equal(result.search.method, 'EXACT_BOUNDED');
  assert.equal(result.search.basketSearch, 'EXHAUSTIVE');
  assert.deepEqual(
    [result.totals.productCost, result.totals.paymentDiscount, result.totals.payToday, result.totals.refundEstimated],
    ['1050.00', '210.00', '840.00', '0.00'],
  );
  assert.equal(result.visits[0].payment.promotionId, 'b-20');
  assert.equal(result.visits[0].payment.conditions.paymentMethod, 'DEBIT_CARD');
  // Base: la sucursal más barata a precio regular ($1.000); se paga $840 en caja.
  assert.equal(result.savings.estimatedSavings, '160.00');
  assertTotalsClose(result);
});

test('banco incorrecto o medio no elegible: no aplica y se explica por qué', () => {
  const scenario = {
    needs: [need('c-x')],
    stores: [store('b')],
    prices: [price('p-x', 'b', '1000.00')],
    promotions: [bank('b-20', 'ch-b', { discountPercentage: '20.00' })],
  };
  const wrongBank = plan(scenario, { paymentMethods: ['DEBIT_CARD'], banks: ['Otro Banco'], memberships: [] });
  const wrongMethod = plan(scenario, { paymentMethods: ['CREDIT_CARD'], banks: ['Banco Demo'], memberships: [] });
  for (const [result, reason] of [[wrongBank, 'BANK_NOT_ELIGIBLE'], [wrongMethod, 'PAYMENT_METHOD_NOT_ELIGIBLE']]) {
    assert.equal(result.totals.payToday, '1000.00');
    assert.equal(result.totals.conditionalAmount, '0.00');
    assert.deepEqual(result.visits[0].benefitNotes.map((note) => [note.status, note.reason]), [['NOT_ELIGIBLE', reason]]);
  }
});

test('reintegro de los miércoles: hoy se paga entero, el reintegro va aparte y no es ahorro', () => {
  const scenario = {
    needs: [need('c-x', '2')],
    stores: [store('coto')],
    prices: [price('p-x', 'coto', '5000.00')],
    promotions: [bank('miercoles', 'ch-coto', { discountPercentage: '30.00', benefitTiming: 'REFUND', refundDelayDays: 30, eligibleWeekdays: [3], discountCap: '8000.00', capPeriod: 'PURCHASE' })],
  };
  const result = plan(scenario, DEBIT_DEMO, { settings: { storeVisitPenalty: '100.00' } });
  const line = at(result, 'c-x');
  assert.equal(line.date, '2026-09-30', 'el miércoles, aunque el precio de línea sea el mismo el lunes');
  assert.deepEqual(
    [result.totals.payToday, result.totals.refundEstimated, result.totals.costAfterRefund],
    ['10000.00', '3000.00', '7000.00'],
  );
  assert.equal(result.visits[0].payment.timing, 'REFUND');
  assert.equal(result.visits[0].payment.refundDelayDays, 30);
  assert.equal(result.savings.estimatedSavings, '0.00', 'misma sucursal a precio regular: el reintegro no cuenta como ahorro');
  assert.ok(codes(result.limitations).includes('REFUND_PENDING'));
  assertTotalsClose(result);
});

test('compra mínima: conviene llevar un producto más caro a la visita que alcanza el mínimo', () => {
  // Por líneas: x en A ($1.000), z en A ($500) e y en B ($900): B no llega a $2.000 y no hay descuento.
  // Llevando x a B ($1.100) la compra llega a $2.000 y el 10% baja $200: el total pasa de $2.400 a $2.300.
  const scenario = {
    needs: [need('c-x'), need('c-y'), need('c-z')],
    stores: [store('a'), store('b')],
    prices: [price('p-x', 'a', '1000.00'), price('p-z', 'a', '500.00'), price('p-x', 'b', '1100.00'), price('p-y', 'b', '900.00')],
    promotions: [bank('b-minimo', 'ch-b', { discountPercentage: '10.00', minimumSpend: '2000.00' })],
  };
  const lineOnly = optimizePlan(candidatesFrom(scenario), SETTINGS);
  assert.equal(at(lineOnly, 'c-x').storeId, 'a');
  const result = plan(scenario);
  assert.equal(at(result, 'c-x').storeId, 'b');
  assert.ok(at(result, 'c-x').reasonCodes.includes('BASKET_BENEFIT_CHOICE'));
  assert.equal(result.totals.payToday, '2300.00');
  assert.equal(result.visits.find((visit) => visit.storeId === 'b').payment.base, '2000.00');
  assertTotalsClose(result);
});

test('no acumulable: la línea con promoción del producto queda fuera de la base del pago', () => {
  const scenario = {
    needs: [need('c-x'), need('c-y')],
    stores: [store('b')],
    prices: [price('p-x', 'b', '1000.00'), price('p-y', 'b', '2000.00')],
    promotions: [
      promotion('x-10', { chainId: 'ch-b', productId: 'p-x', discountPercentage: '10.00' }),
      bank('b-20', 'ch-b', { discountPercentage: '20.00' }),
    ],
  };
  const result = plan(scenario);
  const visit = result.visits[0];
  assert.equal(visit.subtotal, '2900.00');
  assert.equal(visit.payment.base, '2000.00');
  assert.equal(visit.paymentDiscount, '400.00');
  assert.equal(at(result, 'c-x').promotion.id, 'x-10');

  const stackable = plan({
    ...scenario,
    promotions: [
      promotion('x-10', { chainId: 'ch-b', productId: 'p-x', discountPercentage: '10.00', isStackable: true }),
      bank('b-20', 'ch-b', { discountPercentage: '20.00', isStackable: true }),
    ],
  });
  assert.equal(stackable.visits[0].payment.base, '2900.00');
  assert.equal(stackable.visits[0].paymentDiscount, '580.00');
  assertTotalsClose(stackable);
});

test('tope mensual compartido entre visitas: desconocido, informado y agotado', () => {
  // Dos cadenas del mismo banco comparten un tope mensual de $1.000; cada una sola tiene su producto.
  const promotions = [
    bank('a-20', 'ch-a', { discountPercentage: '20.00', discountCap: '1000.00', capPeriod: 'MONTH', capGroup: 'demo' }),
    bank('b-20', 'ch-b', { discountPercentage: '20.00', discountCap: '1000.00', capPeriod: 'MONTH', capGroup: 'demo' }),
  ];
  const scenario = {
    needs: [need('c-x'), need('c-y')],
    stores: [store('a'), store('b')],
    prices: [price('p-x', 'a', '4000.00'), price('p-y', 'b', '3000.00')],
    promotions,
    dates: WEEK.slice(0, 2),
  };

  const unknown = plan(scenario);
  assert.equal(unknown.totals.paymentDiscount, '0.00', 'sin saber cuánto se usó del tope, no se suma');
  assert.equal(unknown.search.basketSearch, 'EXHAUSTIVE');
  assert.ok(DecimalValue.parse(unknown.totals.conditionalAmount).isPositive());
  assert.ok(unknown.visits.every((visit) => visit.benefitNotes.some((note) => note.reason === 'CAP_REMAINING_UNKNOWN')));
  assert.ok(unknown.benefits.criteria.some((sentence) => sentence.includes('informarlo en Preferencias')));

  // Informado: $700 usados afuera en septiembre. Quedan $300 para las dos compras, en orden de fecha.
  const informed = plan(scenario, DEBIT_DEMO, { capUsage: [{ capKey: 'group:demo', periodKey: '2026-09', consumed: '700.00' }] });
  assert.equal(informed.totals.paymentDiscount, '300.00');
  assert.deepEqual(informed.benefits.caps, [{ key: 'group:demo', periodKey: '2026-09', limit: '1000.00', consumedOutside: '700.00', usedHere: '300.00' }]);
  const second = informed.visits.find((visit) => visit.payToday === visit.subtotal);
  assert.ok(second.benefitNotes.some((note) => note.reason === 'CAP_EXHAUSTED'), 'la segunda compra ya no tiene saldo');
  assertTotalsClose(informed);

  // Agotado afuera: nada que aplicar ni que prometer.
  const exhausted = plan(scenario, DEBIT_DEMO, { capUsage: [{ capKey: 'group:demo', periodKey: '2026-09', consumed: '1000.00' }] });
  assert.equal(exhausted.totals.paymentDiscount, '0.00');
  assert.equal(exhausted.totals.conditionalAmount, '0.00');
});

test('el tope mensual se cuenta por mes argentino: septiembre y octubre son saldos distintos', () => {
  const scenario = {
    needs: [need('c-x', '3')],
    stores: [store('a')],
    prices: [price('p-x', 'a', '1000.00')],
    promotions: [bank('a-20', 'ch-a', { discountPercentage: '20.00', discountCap: '1000.00', capPeriod: 'MONTH', capGroup: 'demo' })],
    dates: ['2026-09-30', '2026-10-01'],
  };
  // Septiembre agotado afuera, octubre informado sin uso: el plan compra el jueves 1.
  const result = plan(scenario, DEBIT_DEMO, {
    capUsage: [
      { capKey: 'group:demo', periodKey: '2026-09', consumed: '1000.00' },
      { capKey: 'group:demo', periodKey: '2026-10', consumed: '0.00' },
    ],
  });
  assert.equal(at(result, 'c-x').date, '2026-10-01');
  assert.equal(result.totals.paymentDiscount, '600.00');
});

// ------------------------------------------------- contraste con enumeración exhaustiva

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScenario(next) {
  const pick = (values) => values[Math.floor(next() * values.length)];
  const chance = (probability) => next() < probability;
  const shared = chance(0.4);
  const stores = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, index) =>
    store(`s${index}`, 100 * (1 + Math.floor(next() * 40)), shared && index > 0 ? 'ch-s1' : `ch-s${index}`),
  );
  const chains = [...new Set(stores.map((entry) => entry.chainId))];
  const start = Math.floor(next() * 3);
  const dates = WEEK.slice(start, start + 1 + Math.floor(next() * 2));
  const canonicals = ['c-x', 'c-y', 'c-z'].slice(0, 1 + Math.floor(next() * 3));
  const needs = canonicals.map((canonical) => need(canonical, String(1 + Math.floor(next() * 3))));
  const productsOf = { 'c-x': ['p-x', 'p-x2'], 'c-y': ['p-y'], 'c-z': ['p-z'] };
  const prices = [];
  for (const entry of stores) {
    for (const canonical of canonicals) {
      for (const productId of productsOf[canonical]) {
        if (chance(0.7)) prices.push(price(productId, entry.id, (500 + Math.floor(next() * 3000) + Math.floor(next() * 100) / 100).toFixed(2)));
      }
    }
  }
  const promotions = [];
  const count = 1 + Math.floor(next() * 3);
  for (let index = 0; index < count; index += 1) {
    const chainId = pick(chains);
    const kind = pick(['product', 'pairs', 'bank', 'bank', 'bank', 'amount', 'minimum']);
    const stackable = chance(0.4);
    if (kind === 'product') {
      promotions.push(promotion(`r${index}`, { chainId, productId: pick(['p-x', 'p-y', 'p-z']), discountPercentage: pick(['10.00', '25.00']), isStackable: stackable }));
    } else if (kind === 'pairs') {
      promotions.push(promotion(`r${index}`, { type: 'TWO_FOR_ONE', chainId, productId: pick(['p-x', 'p-x2']), isStackable: stackable }));
    } else if (kind === 'minimum') {
      promotions.push(promotion(`r${index}`, { chainId, discountPercentage: '10.00', minimumSpend: pick(['2000.00', '5000.00']) }));
    } else {
      const capPeriod = pick([null, 'PURCHASE', 'MONTH', 'MONTH']);
      promotions.push(bank(`r${index}`, chainId, {
        ...(kind === 'amount' ? { discountAmount: pick(['300.00', '1500.00']) } : { discountPercentage: pick(['15.00', '30.00']) }),
        paymentMethod: pick(['DEBIT_CARD', 'DEBIT_CARD', 'CREDIT_CARD']),
        minimumSpend: chance(0.4) ? pick(['1500.00', '4000.00']) : null,
        discountCap: capPeriod ? pick(['400.00', '1200.00']) : null,
        capPeriod,
        capGroup: capPeriod === 'MONTH' && chance(0.6) ? 'demo' : null,
        benefitTiming: chance(0.4) ? 'REFUND' : 'IMMEDIATE',
        refundDelayDays: null,
        eligibleWeekdays: chance(0.3) ? [3] : [],
        isStackable: stackable,
      }));
    }
  }
  const payer = pick([DEBIT_DEMO, DEBIT_DEMO, DEBIT_DEMO, NOBODY, { paymentMethods: ['CREDIT_CARD'], banks: ['Banco Demo'], memberships: [] }]);
  const capUsage = chance(0.7) ? [{ capKey: 'group:demo', periodKey: '2026-09', consumed: pick(['0.00', '300.00', '1500.00']) }] : [];
  for (const rule of promotions) {
    if (rule.capPeriod === 'MONTH' && !rule.capGroup && chance(0.5)) capUsage.push({ capKey: `promotion:${rule.id}`, periodKey: '2026-09', consumed: '100.00' });
  }
  const settings = {
    storeVisitPenalty: pick(['0.00', '50.00', '400.00']),
    distancePenaltyPerKm: pick(['0.00', '10.00']),
    maxStores: pick([null, 1, 2]),
    maxCombinations: 100000,
  };
  return { scenario: { needs, stores, prices, promotions, dates }, payer, capUsage, settings };
}

/**
 * Enumeración independiente: cada necesidad elige una oferta en una fecha (o ninguna), cada visita
 * es una compra del motor y se suman penalidades. Devuelve la mejor cobertura y costo después del reintegro.
 */
function bruteForce(instance, rules, payer, capUsage, settings) {
  const cents = (value) => Math.round(Number(value) * 100);
  const options = instance.candidates.needs
    .filter((entry) => entry.offers.length)
    .map((entry) => [
      null,
      ...entry.offers.flatMap((offer) =>
        offer.dateOptions.map((option) => ({ canonical: entry.canonicalProductId, offer, date: option.date })),
      ),
    ]);
  const distance = new Map(instance.candidates.stores.kept.map((entry) => [entry.id, entry.distanceMeters]));
  let best = null;
  const picked = [];
  const walk = (index) => {
    if (index === options.length) {
      const chosen = picked.filter(Boolean);
      if (settings.maxStores !== null && new Set(chosen.map((option) => option.offer.storeId)).size > settings.maxStores) return;
      const visits = new Map();
      for (const option of chosen) {
        const key = `${option.date}#${option.offer.storeId}`;
        const lines = visits.get(key)?.lines ?? [];
        lines.push({
          lineId: option.canonical,
          productId: option.offer.productId,
          canonicalProductId: option.canonical,
          unitPrice: option.offer.priceBasis.price,
          quantity: option.offer.purchase.units,
          saleMode: option.offer.purchase.saleMode,
        });
        visits.set(key, { purchaseId: key, storeId: option.offer.storeId, chainId: option.offer.chainId, instant: argentineNoon(option.date), lines });
      }
      const engine = evaluateBenefits({ purchases: [...visits.values()], rules, payer, capUsage });
      let cost = cents(engine.totals.costAfterRefund) + visits.size * cents(settings.storeVisitPenalty);
      for (const visit of visits.values()) {
        const meters = distance.get(visit.storeId);
        if (meters !== null) cost += (2 * meters * cents(settings.distancePenaltyPerKm)) / 1000;
      }
      const uncovered = picked.length - chosen.length;
      if (!best || uncovered < best.uncovered || (uncovered === best.uncovered && cost < best.cost)) best = { uncovered, cost };
      return;
    }
    for (const option of options[index]) {
      picked.push(option);
      walk(index + 1);
      picked.pop();
    }
  };
  walk(0);
  return best;
}

const centsOf = (value) => Math.round(Number(value) * 100);

test('contraste con enumeración exhaustiva independiente en 150 canastas chicas con beneficios y topes', () => {
  const next = random(20261001);
  let withPayments = 0;
  for (let run = 0; run < 150; run += 1) {
    const { scenario, payer, capUsage, settings } = randomScenario(next);
    const instance = candidatesFrom(scenario);
    const result = optimizePlan(instance, settings, context(scenario.promotions, payer, capUsage, 1_000_000));
    const label = `corrida ${run}: ${JSON.stringify({ settings, payer, capUsage })}`;
    if (!instance.candidates.needs.some((entry) => entry.offers.length)) {
      assert.equal(result.search.method, 'NO_CANDIDATES', label);
      continue;
    }
    const expected = bruteForce(instance, scenario.promotions, payer, capUsage, settings);
    assert.equal(result.search.method, 'EXACT_BOUNDED', label);
    assert.equal(result.unfulfilled.filter((entry) => entry.reason === 'MAX_STORES_LIMIT').length, expected.uncovered, label);
    assert.equal(centsOf(result.totals.effectiveCostAfterRefund), expected.cost, label);
    if (settings.maxStores !== null) assert.ok(result.totals.storeCount <= settings.maxStores, label);
    assertTotalsClose(result, label);
    if (DecimalValue.parse(result.totals.paymentDiscount).add(DecimalValue.parse(result.totals.refundEstimated)).isPositive()) withPayments += 1;
  }
  assert.ok(withPayments >= 20, `el muestreo debe ejercitar beneficios de pago aplicados (${withPayments})`);
});

test('método aproximado: identificado, determinista, nunca peor que el plan por líneas ni mejor que el óptimo', () => {
  const next = random(4242);
  let approximated = 0;
  let optimal = 0;
  for (let run = 0; run < 120; run += 1) {
    const { scenario, payer, capUsage, settings } = randomScenario(next);
    if (!costRelevantRules(scenario.promotions, payer).length) continue;
    const instance = candidatesFrom(scenario);
    if (!instance.candidates.needs.some((entry) => entry.offers.length)) continue;
    const small = context(scenario.promotions, payer, capUsage, 12);
    const result = optimizePlan(instance, settings, small);
    if (result.search.basketSearch !== 'LOCAL_SEARCH') continue;
    approximated += 1;
    const label = `corrida ${run}`;
    assert.equal(result.search.method, 'HEURISTIC', label);
    assert.ok(codes(result.limitations).includes('BASKET_BENEFITS_APPROXIMATED'), label);
    assert.ok(result.search.basketEvaluations <= 12 + 1, label);
    assert.deepEqual(optimizePlan(instance, settings, small), result, `${label}: determinista`);
    if (settings.maxStores !== null) assert.ok(result.totals.storeCount <= settings.maxStores, label);
    assertTotalsClose(result, label);

    const expected = bruteForce(instance, scenario.promotions, payer, capUsage, settings);
    const uncovered = result.unfulfilled.filter((entry) => entry.reason === 'MAX_STORES_LIMIT').length;
    assert.equal(uncovered, expected.uncovered, `${label}: la cobertura no se resigna`);
    assert.ok(centsOf(result.totals.effectiveCostAfterRefund) >= expected.cost, `${label}: no puede superar al óptimo`);
    if (centsOf(result.totals.effectiveCostAfterRefund) === expected.cost) optimal += 1;

    // El plan por líneas de P5-02, cobrado con el mismo motor, es una cota superior.
    const lineOnly = optimizePlan(instance, settings);
    const visits = new Map();
    for (const line of lineOnly.lines) {
      const key = `${line.date}#${line.storeId}`;
      const offer = instance.candidates.needs.flatMap((entry) => entry.offers).find((candidate) => candidate.id === line.offerId);
      const lines = visits.get(key)?.lines ?? [];
      lines.push({ lineId: line.canonicalProductId, productId: line.productId, canonicalProductId: line.canonicalProductId, unitPrice: offer.priceBasis.price, quantity: offer.purchase.units, saleMode: offer.purchase.saleMode });
      visits.set(key, { purchaseId: key, storeId: line.storeId, chainId: offer.chainId, instant: argentineNoon(line.date), lines });
    }
    const engine = evaluateBenefits({ purchases: [...visits.values()], rules: scenario.promotions, payer, capUsage });
    const lineOnlyCost = DecimalValue.parse(engine.totals.costAfterRefund)
      .add(DecimalValue.parse(lineOnly.totals.storeVisitPenaltyCost))
      .add(DecimalValue.parse(lineOnly.totals.distancePenaltyCost));
    assert.ok(DecimalValue.parse(result.totals.effectiveCostAfterRefund).compare(lineOnlyCost) <= 0, `${label}: nunca peor que por líneas`);
  }
  assert.ok(approximated >= 10, `el muestreo debe forzar el método aproximado (${approximated})`);
  // Informativo: cuántas veces el aproximado igualó al óptimo con solo 12 evaluaciones.
  assert.ok(optimal >= 1, `el aproximado encontró el óptimo ${optimal} de ${approximated} veces`);
});

test('presupuesto de evaluaciones inválido se rechaza', () => {
  const scenario = { needs: [need('c-x')], stores: [store('a')], prices: [price('p-x', 'a', '10.00')] };
  for (const maxEvaluations of [0, 1.5]) {
    assert.throws(() => optimizePlan(candidatesFrom(scenario), SETTINGS, context([], DEBIT_DEMO, [], maxEvaluations)), RangeError);
  }
});
