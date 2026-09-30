const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AlertRuleError, assertAlertRule } = require('../dist/modules/alerts/domain/alert-rules');
const { alertEventKey, decide, eligibleProducts, evaluateRule } = require('../dist/modules/alerts/domain/alert-evaluation');
const { buildNotificationContent, formatArs } = require('../dist/modules/alerts/domain/notification-content');

const CANONICAL = 'c0000000-0000-4000-8000-000000000001';
const PAMPA_1KG = 'p0000000-0000-4000-8000-000000000001';
const PAMPA_500 = 'p0000000-0000-4000-8000-000000000002';
const DELSUR_1KG = 'p0000000-0000-4000-8000-000000000003';
const products = [
  { id: PAMPA_1KG, canonicalProductId: CANONICAL, brand: 'Pampa', isActive: true },
  { id: PAMPA_500, canonicalProductId: CANONICAL, brand: 'Pampa', isActive: true },
  { id: DELSUR_1KG, canonicalProductId: CANONICAL, brand: 'Del Sur', isActive: true },
  { id: 'p-inactivo', canonicalProductId: CANONICAL, brand: 'Otra', isActive: false },
  { id: 'p-otro', canonicalProductId: 'c-otro', brand: 'Pampa', isActive: true },
];
const NOW = new Date('2026-09-30T15:00:00Z');

const shape = (overrides = {}) => ({
  condition: 'TARGET_PRICE',
  targetUnitPrice: '1200',
  targetUnit: 'KG',
  currency: 'ARS',
  allowSubstitutes: true,
  productId: null,
  radiusKm: null,
  ...overrides,
});
const rule = (overrides = {}) => ({
  condition: 'TARGET_PRICE',
  canonicalProductId: CANONICAL,
  productId: null,
  allowSubstitutes: true,
  excludedBrands: [],
  targetUnitPrice: '1200.000000',
  targetUnit: 'KG',
  ...overrides,
});
const analysis = ({ classification = 'NORMAL', isStale = false, average = '1300.000000' } = {}) => ({
  classification,
  current: { price: '0', unitPrice: '0', observedAt: NOW, date: '2026-09-30', ageDays: isStale ? 10 : 0, isStale },
  baseWindow: null,
  average,
  lowest: '1100.000000',
  lowestDate: null,
  highest: null,
  ratioToAverage: '0.9000',
});
const price = (overrides = {}) => ({
  productId: PAMPA_1KG,
  storeId: 's-1',
  source: 'fuente',
  price: '1150.00',
  unitPrice: '1150.000000',
  unitPriceUnit: 'KG',
  currency: 'ARS',
  observedAt: new Date('2026-09-30T12:00:00Z'),
  analysis: analysis(),
  ...overrides,
});
const code = (expected) => (error) => error instanceof AlertRuleError && error.code === expected;

test('reglas: objetivo solo en TARGET_PRICE, por unidad base del genérico y en pesos', () => {
  assert.doesNotThrow(() => assertAlertRule(shape(), 'KG'));
  assert.doesNotThrow(() => assertAlertRule(shape({ condition: 'HISTORIC_LOW', targetUnitPrice: null, targetUnit: null }), 'KG'));
  assert.throws(() => assertAlertRule(shape({ targetUnitPrice: null }), 'KG'), code('TARGET_PRICE_REQUIRED'));
  assert.throws(() => assertAlertRule(shape({ targetUnit: null }), 'KG'), code('TARGET_PRICE_REQUIRED'));
  assert.throws(() => assertAlertRule(shape({ condition: 'GOOD_DEAL' }), 'KG'), code('TARGET_PRICE_NOT_ALLOWED'));
  assert.throws(() => assertAlertRule(shape({ targetUnitPrice: '0' }), 'KG'), code('TARGET_PRICE_INVALID'));
  assert.throws(() => assertAlertRule(shape({ targetUnitPrice: '1.234' }), 'KG'), code('TARGET_PRICE_INVALID'));
  assert.throws(() => assertAlertRule(shape({ targetUnit: 'L' }), 'KG'), code('UNIT_DIMENSION_MISMATCH'));
  assert.throws(() => assertAlertRule(shape({ currency: 'USD' }), 'KG'), code('CURRENCY_NOT_SUPPORTED'));
  assert.throws(() => assertAlertRule(shape({ allowSubstitutes: false }), 'KG'), code('PREFERRED_PRODUCT_REQUIRED'));
  assert.doesNotThrow(() => assertAlertRule(shape({ allowSubstitutes: false, productId: PAMPA_1KG }), 'KG'));
  assert.throws(() => assertAlertRule(shape({ radiusKm: '0.05' }), 'KG'), code('RADIUS_INVALID'));
  assert.throws(() => assertAlertRule(shape({ radiusKm: '101' }), 'KG'), code('RADIUS_INVALID'));
});

test('presentaciones: sin reemplazos solo la elegida; con reemplazos, sin marcas excluidas', () => {
  const ids = (list) => list.map((product) => product.id);
  assert.deepEqual(ids(eligibleProducts(rule(), products)), [PAMPA_1KG, PAMPA_500, DELSUR_1KG], 'activas del mismo genérico');
  assert.deepEqual(ids(eligibleProducts(rule({ productId: PAMPA_500, allowSubstitutes: false }), products)), [PAMPA_500]);
  assert.deepEqual(ids(eligibleProducts(rule({ excludedBrands: ['PAMPA'] }), products)), [DELSUR_1KG], 'sin distinguir mayúsculas');
  assert.deepEqual(ids(eligibleProducts(rule({ productId: PAMPA_1KG, excludedBrands: ['Pampa'] }), products)), [PAMPA_1KG, DELSUR_1KG], 'la preferida se eligió a propósito');
});

test('precio objetivo: cruza el umbral (o lo iguala) con un precio fresco', () => {
  assert.equal(evaluateRule(rule(), products, [price()]).kind, 'MATCH');
  assert.equal(evaluateRule(rule(), products, [price({ unitPrice: '1200.000000' })]).kind, 'MATCH', 'igualar alcanza');
  assert.equal(evaluateRule(rule(), products, [price({ unitPrice: '1200.010000' })]).kind, 'NO_MATCH');
  assert.equal(evaluateRule(rule(), products, [price({ analysis: analysis({ isStale: true }) })]).kind, 'NO_FRESH_PRICES', 'un precio viejo no avisa');
  assert.equal(evaluateRule(rule(), products, [price({ currency: 'USD' })]).kind, 'NO_FRESH_PRICES');
  assert.equal(evaluateRule(rule(), products, [price({ unitPriceUnit: 'UNIT' })]).kind, 'NO_MATCH', 'otra unidad no se compara');
  assert.equal(evaluateRule(rule(), products, [price({ productId: 'p-otro' })]).kind, 'NO_FRESH_PRICES', 'otro genérico no cuenta');
  assert.equal(evaluateRule(rule({ productId: DELSUR_1KG, allowSubstitutes: false }), products, [price()]).kind, 'NO_FRESH_PRICES', 'sustituto no permitido');
  assert.equal(evaluateRule(rule({ excludedBrands: ['Pampa', 'Del Sur'] }), products, [price()]).kind, 'NO_ELIGIBLE_PRODUCTS');
});

test('oportunidades: mínimo histórico, buena oferta y pocos datos', () => {
  const low = price({ analysis: analysis({ classification: 'HISTORIC_LOW' }) });
  const deal = price({ analysis: analysis({ classification: 'GOOD_DEAL' }) });
  const few = price({ analysis: analysis({ classification: 'INSUFFICIENT_DATA' }) });
  assert.equal(evaluateRule(rule({ condition: 'HISTORIC_LOW', targetUnitPrice: null, targetUnit: null }), products, [low]).kind, 'MATCH');
  assert.equal(evaluateRule(rule({ condition: 'HISTORIC_LOW', targetUnitPrice: null, targetUnit: null }), products, [deal]).kind, 'NO_MATCH');
  assert.equal(evaluateRule(rule({ condition: 'GOOD_DEAL', targetUnitPrice: null, targetUnit: null }), products, [low]).kind, 'MATCH', 'un mínimo también es buena oferta');
  assert.equal(evaluateRule(rule({ condition: 'GOOD_DEAL', targetUnitPrice: null, targetUnit: null }), products, [few]).kind, 'INSUFFICIENT_DATA');
  assert.equal(evaluateRule(rule(), products, [few]).kind, 'MATCH', 'el objetivo no necesita historial: el precio observado alcanza');
});

test('entre varios candidatos: menor precio por unidad, después la preferida y la más cercana', () => {
  const cheaper = price({ productId: DELSUR_1KG, unitPrice: '1100.000000', storeId: 's-2' });
  const result = evaluateRule(rule({ productId: PAMPA_1KG }), products, [price(), cheaper]);
  assert.deepEqual([result.match.productId, result.match.isAlternative], [DELSUR_1KG, true], 'la alternativa se informa como tal');
  const tie = evaluateRule(rule({ productId: PAMPA_1KG }), products, [price({ productId: DELSUR_1KG }), price()]);
  assert.deepEqual([tie.match.productId, tie.match.isAlternative], [PAMPA_1KG, false], 'empate: la preferida');
  const near = evaluateRule(rule(), products, [price({ storeId: 's-lejos' }), price({ storeId: 's-cerca' })], new Map([['s-lejos', 4000], ['s-cerca', 300]]));
  assert.equal(near.match.storeId, 's-cerca');
});

test('decisión: avisa al cumplirse y al mejorar, nunca repite, respeta pausa, cambios y espera', () => {
  const match = { kind: 'MATCH', match: { ...price(), isAlternative: false } };
  const fresh = { active: true, revision: 2, notifiedUnitPrice: null, lastNotifiedAt: null };
  assert.deepEqual(decide(match, fresh, 2, NOW, 24), { action: 'NOTIFY', outcome: 'NOTIFIED', notifiedUnitPrice: '1150.000000' });
  assert.equal(decide(match, { ...fresh, active: false }, 2, NOW, 24).outcome, 'PAUSED');
  assert.equal(decide(match, fresh, 1, NOW, 24).outcome, 'RULE_CHANGED', 'se evaluó una versión vieja de la regla');
  const notified = { ...fresh, notifiedUnitPrice: '1150.000000', lastNotifiedAt: new Date(NOW.getTime() - 48 * 3_600_000) };
  assert.equal(decide(match, notified, 2, NOW, 24).outcome, 'ALREADY_NOTIFIED', 'mismo precio: no se repite');
  const better = { kind: 'MATCH', match: { ...price({ unitPrice: '1000.000000' }), isAlternative: false } };
  assert.equal(decide(better, notified, 2, NOW, 24).outcome, 'NOTIFIED', 'mejoró el precio');
  assert.equal(decide(better, { ...notified, lastNotifiedAt: new Date(NOW.getTime() - 3_600_000) }, 2, NOW, 24).outcome, 'COOLDOWN');
  assert.equal(decide(better, { ...notified, lastNotifiedAt: new Date(NOW.getTime() - 3_600_000) }, 2, NOW, 0).outcome, 'NOTIFIED', 'sin espera configurada');
  assert.deepEqual(decide({ kind: 'NO_MATCH' }, notified, 2, NOW, 24), { action: 'RECORD', outcome: 'NO_MATCH', notifiedUnitPrice: null }, 'dejó de cumplirse: vuelve a habilitar');
  assert.deepEqual(decide({ kind: 'NO_FRESH_PRICES' }, notified, 2, NOW, 24), { action: 'RECORD', outcome: 'NO_FRESH_PRICES' }, 'sin datos no se sabe: no cambia');
});

test('clave del evento: una por observación, estable y apta para la base', () => {
  const first = alertEventKey('TARGET_PRICE', price());
  assert.equal(alertEventKey('TARGET_PRICE', price()), first);
  assert.notEqual(alertEventKey('TARGET_PRICE', price({ unitPrice: '1149.000000' })), first);
  assert.notEqual(alertEventKey('TARGET_PRICE', price({ observedAt: new Date('2026-09-30T13:00:00Z') })), first);
  assert.notEqual(alertEventKey('GOOD_DEAL', price()), first);
  assert.ok(first.length <= 200);
});

test('aviso: importes en pesos, motivo, fuente, fecha, alternativa y enlace', () => {
  assert.equal(formatArs('1234.5'), '$ 1.234,50');
  assert.equal(formatArs('0.99'), '$ 0,99');
  assert.equal(formatArs('1000000'), '$ 1.000.000,00');
  const content = buildNotificationContent({
    condition: 'TARGET_PRICE',
    match: { ...price({ productId: DELSUR_1KG }), isAlternative: true },
    canonical: { id: CANONICAL, name: 'Arroz largo fino' },
    product: { id: DELSUR_1KG, name: 'Arroz Del Sur 1 kg', brand: 'Del Sur' },
    preferredProduct: { id: PAMPA_1KG, name: 'Arroz Pampa 1 kg' },
    store: { id: 's-1', name: 'Coto Centro', chainName: 'Coto', distanceMeters: 850 },
    target: { unitPrice: '1200.00', unit: 'KG' },
  });
  assert.equal(content.title, 'Arroz largo fino llegó a tu precio objetivo');
  assert.equal(
    content.message,
    'Arroz Del Sur 1 kg a $ 1.150,00 ($ 1.150,00 por kg) en Coto Centro, precio visto el 30/09 (fuente fuente). Tu objetivo: $ 1.200,00 por kg. Es una alternativa a Arroz Pampa 1 kg.',
  );
  assert.equal(content.link, `/producto/${DELSUR_1KG}`);
  assert.deepEqual(
    [content.snapshot.reason, content.snapshot.isAlternative, content.snapshot.source, content.snapshot.observedAt, content.snapshot.target],
    ['TARGET_PRICE', true, 'fuente', '2026-09-30T12:00:00.000Z', { unitPrice: '1200.00', unit: 'KG', currency: 'ARS' }],
  );
  const deal = buildNotificationContent({
    condition: 'HISTORIC_LOW',
    match: { ...price(), isAlternative: false },
    canonical: { id: CANONICAL, name: 'Arroz largo fino' },
    product: { id: PAMPA_1KG, name: 'Arroz Pampa 1 kg', brand: 'Pampa' },
    preferredProduct: null,
    store: { id: 's-1', name: 'Coto Centro', chainName: 'Coto', distanceMeters: null },
    target: null,
  });
  assert.match(deal.title, /precio más bajo del último mes/);
  assert.match(deal.message, /Promedio del último mes: \$ 1\.300,00 por kg\./);
  assert.ok(!deal.message.includes('alternativa'));
});
