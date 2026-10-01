const assert = require('node:assert/strict');
const { test } = require('node:test');
const { capKeyOf, capPeriodKey, evaluateBenefits, isoWeekKey } = require('../dist/modules/promotions/domain/benefit-engine');
const { payerEligibility } = require('../dist/modules/promotions/domain/payer-eligibility');
const { validatePromotionRule } = require('../dist/modules/promotions/domain/promotion-rule');
const { normalizePromotionRecord } = require('../dist/modules/imports/domain/import-normalizer');

// Miércoles 30/09/2026 al mediodía argentino; el jueves 01/10 y el lunes 05/10 (otra semana).
const WEDNESDAY = new Date('2026-09-30T15:00:00.000Z');
const THURSDAY = new Date('2026-10-01T15:00:00.000Z');
const NEXT_MONDAY = new Date('2026-10-05T15:00:00.000Z');
const STORE = { storeId: 's-1', chainId: 'c-1' };
const PAYER = { paymentMethods: ['DEBIT_CARD'], banks: ['Banco Demo'], memberships: [] };

let ids = 0;
const rule = (overrides = {}) => ({
  id: `promo-${String(++ids).padStart(3, '0')}`,
  name: 'Promo de prueba',
  type: 'BANK_DISCOUNT',
  storeId: null,
  chainId: 'c-1',
  productId: null,
  canonicalProductId: null,
  discountPercentage: '20.00',
  fixedPrice: null,
  requiredQuantity: null,
  paymentMethod: 'DEBIT_CARD',
  bank: 'Banco Demo',
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
  source: 'test',
  externalId: null,
  validFrom: new Date('2026-09-01T03:00:00.000Z'),
  validUntil: new Date('2026-11-01T03:00:00.000Z'),
  ...overrides,
});
const line = (lineId, unitPrice, quantity = '1', overrides = {}) => ({
  lineId,
  productId: `p-${lineId}`,
  canonicalProductId: `c-${lineId}`,
  unitPrice,
  quantity,
  saleMode: 'PACKAGED',
  ...overrides,
});
const purchase = (purchaseId, lines, instant = WEDNESDAY, store = STORE) => ({ purchaseId, ...store, instant, lines });
const run = (purchases, rules, payer = PAYER, capUsage = []) => evaluateBenefits({ purchases, rules, payer, capUsage });
const evaluationOf = (result, promotionId, purchaseId) =>
  result.evaluations.find((evaluation) => evaluation.promotionId === promotionId && (!purchaseId || evaluation.purchaseId === purchaseId));

test('preferencias declaradas: elegible, no elegible o desconocido, nunca supuesto', () => {
  const bank = rule({ paymentMethod: null });
  assert.deepEqual(payerEligibility(bank, PAYER), { status: 'ELIGIBLE' });
  assert.deepEqual(payerEligibility(bank, { ...PAYER, banks: ['BANCO  demo'] }), { status: 'ELIGIBLE' }, 'sin distinguir mayúsculas ni espacios');
  assert.deepEqual(payerEligibility(bank, { ...PAYER, banks: ['Otro Banco'] }), { status: 'NOT_ELIGIBLE', reason: 'BANK_NOT_ELIGIBLE' });
  assert.deepEqual(payerEligibility(bank, { ...PAYER, banks: [] }), { status: 'UNKNOWN', reason: 'BANK_NOT_DECLARED' }, 'no declarar no es tenerlo');
  const credit = rule({ paymentMethod: 'CREDIT_CARD' });
  assert.deepEqual(payerEligibility(credit, PAYER), { status: 'NOT_ELIGIBLE', reason: 'PAYMENT_METHOD_NOT_ELIGIBLE' });
  assert.deepEqual(payerEligibility(credit, { paymentMethods: [], banks: [], memberships: [] }), { status: 'UNKNOWN', reason: 'BANK_NOT_DECLARED' });
  assert.deepEqual(payerEligibility(credit, { paymentMethods: [], banks: ['Otro'], memberships: [] }), { status: 'NOT_ELIGIBLE', reason: 'BANK_NOT_ELIGIBLE' }, 'un no gana sobre un desconocido');
  const club = rule({ type: 'PERCENTAGE', bank: null, paymentMethod: null, membershipProgram: 'Club Demo' });
  assert.deepEqual(payerEligibility(club, PAYER), { status: 'UNKNOWN', reason: 'MEMBERSHIP_NOT_DECLARED' });
  assert.deepEqual(payerEligibility(club, { ...PAYER, memberships: ['club demo'] }), { status: 'ELIGIBLE' });
});

test('descuento de pago por compra: porcentaje sobre la canasta, una vez, con tope por compra y redondeo', () => {
  const capped = rule({ discountPercentage: '25.00', discountCap: '500.00', capPeriod: 'PURCHASE' });
  const result = run([purchase('compra-1', [line('a', '1333.33'), line('b', '999.99', '2')])], [capped]);
  const [only] = result.purchases;
  // 1333.33 + 2 × 999.99 = 3333.31; 25 % = 833.33 → tope 500 sobre toda la compra, no por ítem.
  assert.deepEqual([only.regularTotal, only.paymentDiscount, only.payToday], ['3333.31', '500.00', '2833.31']);
  assert.deepEqual(only.payment, { promotionId: capped.id, name: 'Promo de prueba', timing: 'IMMEDIATE', refundDelayDays: null, base: '3333.31', amount: '500.00' });
  const uncapped = run([purchase('compra-1', [line('a', '10.01'), line('b', '10.01')])], [rule({ discountPercentage: '33.33' })]).purchases[0];
  assert.equal(uncapped.paymentDiscount, '6.67', '20,02 × 33,33 % = 6,6727 → 6,67 (HALF_UP una sola vez)');
  const amount = run([purchase('compra-1', [line('a', '900.00')])], [rule({ discountPercentage: null, discountAmount: '1500.00' })]).purchases[0];
  assert.equal(amount.paymentDiscount, '900.00', 'un monto fijo no supera lo que se paga');
});

test('reintegro diferido: no baja lo que se paga hoy, sí el costo final, y conserva el plazo', () => {
  const refund = rule({ discountPercentage: '30.00', benefitTiming: 'REFUND', refundDelayDays: 30 });
  const [only] = run([purchase('compra-1', [line('a', '1000.00')])], [refund]).purchases;
  assert.deepEqual([only.payToday, only.refundEstimated, only.costAfterRefund, only.paymentDiscount], ['1000.00', '300.00', '700.00', '0.00']);
  assert.deepEqual([only.payment.timing, only.payment.refundDelayDays], ['REFUND', 30]);
  // Mismo importe: gana el descuento en caja (se paga menos hoy).
  const immediate = rule({ discountPercentage: '30.00' });
  const tie = run([purchase('compra-1', [line('a', '1000.00')])], [refund, immediate]);
  assert.equal(tie.purchases[0].payment.promotionId, immediate.id);
  assert.deepEqual([evaluationOf(tie, refund.id).status, evaluationOf(tie, refund.id).reason], ['NOT_CHOSEN', 'ONE_PAYMENT_BENEFIT_PER_PURCHASE']);
});

test('elegibilidad: banco incorrecto, medio no elegible, sin declarar, día, vigencia horaria y mínimo', () => {
  const lines = [line('a', '10000.00')];
  const statusOf = (promotion, payer = PAYER, instant = WEDNESDAY) => {
    const evaluation = evaluationOf(run([purchase('compra-1', lines, instant)], [promotion], payer), promotion.id);
    return [evaluation.status, evaluation.reason];
  };
  assert.deepEqual(statusOf(rule({ bank: 'Otro Banco' })), ['NOT_ELIGIBLE', 'BANK_NOT_ELIGIBLE']);
  assert.deepEqual(statusOf(rule({ paymentMethod: 'CREDIT_CARD' })), ['NOT_ELIGIBLE', 'PAYMENT_METHOD_NOT_ELIGIBLE']);
  const unknown = run([purchase('compra-1', lines)], [rule()], { paymentMethods: [], banks: [], memberships: [] });
  assert.deepEqual([unknown.evaluations[0].status, unknown.evaluations[0].reason, unknown.evaluations[0].amount], ['CONDITIONAL', 'BANK_NOT_DECLARED', '2000.00']);
  assert.deepEqual([unknown.totals.payToday, unknown.totals.conditionalAmount], ['10000.00', '2000.00'], 'condicionado: se muestra, no se suma');
  // Dos descuentos de pago condicionados son alternativas: cuenta el mejor, no la suma.
  const two = run([purchase('compra-1', lines)], [rule(), rule({ discountPercentage: '15.00' })], { paymentMethods: [], banks: [], memberships: [] });
  assert.equal(two.totals.conditionalAmount, '2000.00');
  // Con uno aplicado, lo condicionado es solo lo que mejoraría.
  const better = run([purchase('compra-1', lines)], [rule({ bank: null }), rule({ discountPercentage: '30.00', paymentMethod: null, bank: 'Banco Nuevo' })], { paymentMethods: ['DEBIT_CARD'], banks: [], memberships: [] });
  assert.deepEqual([better.totals.paymentDiscount, better.totals.conditionalAmount], ['2000.00', '1000.00']);
  assert.deepEqual(statusOf(rule({ eligibleWeekdays: [3] })), ['APPLIED', null], 'miércoles');
  assert.deepEqual(statusOf(rule({ eligibleWeekdays: [3] }), PAYER, THURSDAY), ['NOT_ELIGIBLE', 'WEEKDAY_NOT_ELIGIBLE']);
  // Vigencia con hora: termina el miércoles a las 12:00 en Argentina (15:00 UTC, exclusivo).
  const untilNoon = rule({ validUntil: new Date('2026-09-30T15:00:00.000Z') });
  assert.deepEqual(statusOf(untilNoon), ['NOT_ELIGIBLE', 'EXPIRED']);
  assert.deepEqual(statusOf(untilNoon, PAYER, new Date('2026-09-30T14:59:00.000Z')), ['APPLIED', null]);
  assert.deepEqual(statusOf(rule({ minimumSpend: '15000.00' })), ['NOT_ELIGIBLE', 'MINIMUM_SPEND_NOT_REACHED']);
  assert.deepEqual(statusOf(rule({ minimumSpend: '10000.00' })), ['APPLIED', null], 'alcanzar el mínimo exacto alcanza');
  assert.equal(run([purchase('compra-1', lines, WEDNESDAY, { storeId: 's-9', chainId: 'c-9' })], [rule()]).evaluations.length, 0, 'otra cadena: ni se menciona');
});

test('acumulación: sin declararla, la línea en promoción queda fuera del descuento de pago', () => {
  const twoForOne = rule({ type: 'TWO_FOR_ONE', discountPercentage: null, bank: null, paymentMethod: null, productId: 'p-a' });
  const bank = rule({ discountPercentage: '20.00' });
  const lines = [line('a', '1000.00', '2'), line('b', '500.00')];
  const exclusive = run([purchase('compra-1', lines)], [twoForOne, bank]).purchases[0];
  // 2×1 en A (1000 de descuento); el 20 % solo sobre B (500) = 100.
  assert.deepEqual([exclusive.productDiscount, exclusive.payment.base, exclusive.paymentDiscount, exclusive.payToday], ['1000.00', '500.00', '100.00', '1400.00']);
  const both = run([purchase('compra-1', lines)], [{ ...twoForOne, isStackable: true }, { ...bank, isStackable: true }]).purchases[0];
  // Las dos acumulables: el 20 % sobre lo que queda después del 2×1 (1000 + 500).
  assert.deepEqual([both.payment.base, both.paymentDiscount, both.payToday], ['1500.00', '300.00', '1200.00']);
  const onlyPromoLines = run([purchase('compra-1', [line('a', '1000.00', '2')])], [twoForOne, bank]);
  assert.deepEqual([evaluationOf(onlyPromoLines, bank.id).status, evaluationOf(onlyPromoLines, bank.id).reason], ['NOT_ELIGIBLE', 'NOT_STACKABLE']);
});

test('topes por semana y por mes entre visitas: se informan, se comparten y se agotan', () => {
  const weekly = rule({ discountPercentage: '50.00', discountCap: '1000.00', capPeriod: 'WEEK' });
  const visits = [purchase('v1', [line('a', '1500.00')], WEDNESDAY), purchase('v2', [line('b', '1500.00')], THURSDAY), purchase('v3', [line('c', '1500.00')], NEXT_MONDAY)];
  const key = capKeyOf(weekly);
  // Sin informar lo usado fuera de la app: condicionado en cada semana.
  const unknown = run(visits, [weekly]);
  assert.deepEqual(unknown.purchases.map((entry) => entry.paymentDiscount), ['0.00', '0.00', '0.00']);
  assert.deepEqual(unknown.evaluations.map((entry) => [entry.status, entry.reason, entry.amount]), [
    ['CONDITIONAL', 'CAP_REMAINING_UNKNOWN', '750.00'],
    ['CONDITIONAL', 'CAP_REMAINING_UNKNOWN', '750.00'],
    ['CONDITIONAL', 'CAP_REMAINING_UNKNOWN', '750.00'],
  ]);
  // Informado: 200 usados en la semana del 30/09; la semana siguiente sin usar.
  const informed = run(visits, [weekly], PAYER, [
    { capKey: key, periodKey: '2026-W40', consumed: '200.00' },
    { capKey: key, periodKey: '2026-W41', consumed: '0' },
  ]);
  // Semana 40: quedan 800 → 750 en la primera visita, 50 en la segunda. Semana 41: 750.
  assert.deepEqual(informed.purchases.map((entry) => entry.paymentDiscount), ['750.00', '50.00', '750.00']);
  assert.deepEqual(informed.caps.map((cap) => [cap.periodKey, cap.consumedOutside, cap.usedHere]), [['2026-W40', '200.00', '800.00'], ['2026-W41', '0.00', '750.00']]);
  const exhausted = run(visits.slice(0, 1), [weekly], PAYER, [{ capKey: key, periodKey: '2026-W40', consumed: '1000.00' }]);
  assert.deepEqual([exhausted.evaluations[0].status, exhausted.evaluations[0].reason], ['NOT_ELIGIBLE', 'CAP_EXHAUSTED']);

  const monthly = rule({ discountPercentage: '50.00', discountCap: '1000.00', capPeriod: 'MONTH' });
  const months = run(visits, [monthly], PAYER, [
    { capKey: capKeyOf(monthly), periodKey: '2026-09', consumed: '0' },
    { capKey: capKeyOf(monthly), periodKey: '2026-10', consumed: '600.00' },
  ]);
  // Septiembre: 750 (queda 250 sin usar); octubre: quedan 400 → 400 el jueves y nada el lunes.
  assert.deepEqual(months.purchases.map((entry) => entry.paymentDiscount), ['750.00', '400.00', '0.00']);
});

test('un mismo tope compartido por promociones de distintas cadenas del mismo grupo', () => {
  const group = 'banco-demo-mensual';
  const coto = rule({ chainId: 'c-1', discountPercentage: '30.00', discountCap: '1000.00', capPeriod: 'MONTH', capGroup: group });
  const vea = rule({ chainId: 'c-2', discountPercentage: '20.00', discountCap: '1000.00', capPeriod: 'MONTH', capGroup: group });
  assert.equal(capKeyOf(coto), capKeyOf(vea));
  const result = run(
    [purchase('coto', [line('a', '3000.00')], WEDNESDAY), purchase('vea', [line('b', '3000.00')], THURSDAY, { storeId: 's-2', chainId: 'c-2' })],
    [coto, vea],
    PAYER,
    [{ capKey: `group:${group}`, periodKey: '2026-09', consumed: '0' }, { capKey: `group:${group}`, periodKey: '2026-10', consumed: '500.00' }],
  );
  // 30/09 (septiembre): 900; 01/10 (octubre, ya usados 500 fuera de la app): quedan 500 de 600.
  assert.deepEqual(result.purchases.map((entry) => entry.paymentDiscount), ['900.00', '500.00']);
  const sameMonth = run(
    [purchase('coto', [line('a', '3000.00')], THURSDAY), purchase('vea', [line('b', '3000.00')], new Date('2026-10-02T15:00:00.000Z'), { storeId: 's-2', chainId: 'c-2' })],
    [coto, vea],
    PAYER,
    [{ capKey: `group:${group}`, periodKey: '2026-10', consumed: '0' }],
  );
  // Mismo mes: 900 en Coto deja 100 del tope compartido para Vea.
  assert.deepEqual(sameMonth.purchases.map((entry) => entry.paymentDiscount), ['900.00', '100.00']);
});

test('promociones del producto: tope por compra compartido entre ítems, no por cada uno', () => {
  const storeWide = rule({ type: 'PERCENTAGE', bank: null, paymentMethod: null, discountPercentage: '50.00', discountCap: '300.00', capPeriod: 'PURCHASE' });
  const result = run([purchase('compra-1', [line('a', '400.00'), line('b', '400.00')])], [storeWide]);
  // 50 % de 400 = 200 en cada ítem, pero el tope de 300 es de la compra: 200 + 100.
  assert.deepEqual(result.purchases[0].lines.map((entry) => entry.productDiscount), ['200.00', '100.00']);
  assert.equal(result.purchases[0].productDiscount, '300.00');
  // Una promoción del producto atada a un banco también respeta las preferencias.
  const conditioned = run([purchase('compra-1', [line('a', '400.00')])], [{ ...storeWide, bank: 'Banco Demo' }], { paymentMethods: [], banks: [], memberships: [] });
  assert.deepEqual([conditioned.evaluations[0].status, conditioned.evaluations[0].reason, conditioned.purchases[0].productDiscount], ['CONDITIONAL', 'BANK_NOT_DECLARED', '0.00']);
});

test('reproducible: el orden de entrada no cambia el resultado y la explicación nombra cada regla', () => {
  // Dos descuentos de pago iguales y una promoción del producto acumulable con ambos.
  const rules = [
    rule({ discountPercentage: '10.00', isStackable: true }),
    rule({ discountPercentage: '10.00', isStackable: true }),
    rule({ type: 'PERCENTAGE', bank: null, paymentMethod: null, discountPercentage: '5.00', isStackable: true }),
  ];
  const purchases = [purchase('b', [line('x', '100.00')], THURSDAY), purchase('a', [line('y', '100.00')], WEDNESDAY)];
  const first = run(purchases, rules);
  const second = run([...purchases].reverse(), [...rules].reverse());
  assert.deepEqual(first.totals, second.totals);
  assert.deepEqual(first.purchases.map((entry) => entry.purchaseId), ['b', 'a'], 'el resultado respeta el orden pedido');
  assert.equal(first.purchases[0].payment.promotionId, rules[0].id, 'empate: el id más chico');
  // 100 − 5 % = 95; 10 % de 95 = 9,50.
  assert.deepEqual([first.purchases[0].productDiscount, first.purchases[0].paymentDiscount, first.purchases[0].payToday], ['5.00', '9.50', '85.50']);
  assert.deepEqual(
    first.evaluations.filter((evaluation) => evaluation.purchaseId === 'a').map((evaluation) => [evaluation.promotionId, evaluation.layer, evaluation.status]),
    [[rules[2].id, 'PRODUCT', 'APPLIED'], [rules[0].id, 'PAYMENT', 'APPLIED'], [rules[1].id, 'PAYMENT', 'NOT_CHOSEN']],
  );
});

test('periodos de tope en el calendario argentino', () => {
  assert.equal(isoWeekKey('2026-09-30'), '2026-W40');
  assert.equal(isoWeekKey('2027-01-01'), '2026-W53');
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  const monthly = rule({ discountCap: '1', capPeriod: 'MONTH' });
  // 01/10 a las 01:00 en UTC sigue siendo 30/09 en Argentina.
  assert.equal(capPeriodKey(monthly, new Date('2026-10-01T01:00:00.000Z'), 'x'), '2026-09');
  assert.equal(capPeriodKey(rule({ discountCap: '1', capPeriod: 'CAMPAIGN' }), WEDNESDAY, 'x'), 'CAMPAIGN');
  assert.equal(capPeriodKey(rule({ discountCap: '1', capPeriod: 'PURCHASE' }), WEDNESDAY, 'compra-7'), 'purchase:compra-7');
});

test('reglas nuevas de una promoción: porcentaje o monto, reintegro y tope compartido', () => {
  const code = (expected) => (error) => error.code === expected;
  assert.doesNotThrow(() => validatePromotionRule(rule({ discountPercentage: null, discountAmount: '1500.00' })));
  assert.throws(() => validatePromotionRule(rule({ discountAmount: '1500.00' })), code('DISCOUNT_AMOUNT'));
  assert.throws(() => validatePromotionRule(rule({ discountPercentage: null })), code('DISCOUNT_AMOUNT'));
  assert.throws(() => validatePromotionRule(rule({ type: 'PERCENTAGE', bank: null, paymentMethod: null, discountAmount: '10' })), code('DISCOUNT_AMOUNT'));
  assert.doesNotThrow(() => validatePromotionRule(rule({ benefitTiming: 'REFUND', refundDelayDays: 30 })));
  assert.throws(() => validatePromotionRule(rule({ refundDelayDays: 30 })), code('REFUND'));
  assert.throws(() => validatePromotionRule(rule({ benefitTiming: 'REFUND', refundDelayDays: 181 })), code('REFUND'));
  assert.throws(() => validatePromotionRule(rule({ type: 'PERCENTAGE', bank: null, paymentMethod: null, benefitTiming: 'REFUND' })), code('REFUND'));
  assert.throws(() => validatePromotionRule(rule({ capGroup: 'grupo' })), code('CAP_GROUP'));
});

test('importación: reintegro, plazo, monto y grupo de tope se leen y validan', () => {
  const base = { kind: 'promotion', externalId: 'p-1', name: 'Reintegro', type: 'BANK_DISCOUNT', chain: 'Coto', bank: 'Banco Demo', discountPercentage: '30,00', validFrom: '2026-09-01', validUntil: '2026-10-01' };
  const parsed = normalizePromotionRecord({ ...base, benefitTiming: 'reintegro', refundDelayDays: 30, capGroup: 'mensual', discountCap: '8.000,00', capPeriod: 'MONTH' }, 1, { separator: ',' });
  assert.equal(parsed.ok, true);
  assert.deepEqual([parsed.value.benefitTiming, parsed.value.refundDelayDays, parsed.value.capGroup, parsed.value.discountCap], ['REFUND', 30, 'mensual', '8000.00']);
  assert.equal(normalizePromotionRecord(base, 1, { separator: ',' }).value.benefitTiming, 'IMMEDIATE', 'por defecto, en caja');
  const amount = normalizePromotionRecord({ ...base, discountPercentage: null, discountAmount: '1.500,00' }, 1, { separator: ',' });
  assert.equal(amount.value.discountAmount, '1500.00');
  assert.equal(normalizePromotionRecord({ ...base, benefitTiming: 'cuotas' }, 1, { separator: ',' }).ok, false);
});
