const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  isValidGtin,
  normalizePriceRecord,
  normalizePromotionRecord,
  parseLocalizedDecimal,
  parseObservedAt,
  parseSaleMode,
  parseUnit,
} = require('../dist/modules/imports/domain/import-normalizer');
const { demoEan } = require('../dist/seed/demo-catalog');

const NOW = new Date('2026-09-29T15:00:00.000Z');
const record = (overrides = {}) => ({
  kind: 'price',
  recordId: null,
  store: {
    externalId: 'suc-1',
    chain: 'Coto',
    name: 'Coto Centro',
    address: 'Av. Siempreviva 742',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    latitude: '-34.6',
    longitude: '-58.4',
    ...overrides.store,
  },
  product: {
    externalId: 'prod-1',
    ean: demoEan('290000000001'),
    name: 'Arroz largo fino 1 kg',
    brand: 'Pampa',
    quantity: '1',
    unit: 'kg',
    ...overrides.product,
  },
  price: overrides.price ?? '1.234,56',
  observedAt: overrides.observedAt ?? '2026-09-28',
});
const normalize = (raw, separator = ',') => normalizePriceRecord(raw, 7, { separator, now: NOW });
const reasonOf = (result) => (result.ok ? null : result.rejection.reason);

test('decimales con coma: el punto solo agrupa miles; sin ambigüedades ni negativos', () => {
  const comma = (value) => parseLocalizedDecimal(value, ',');
  assert.equal(comma('1.234,56'), '1234.56');
  assert.equal(comma('1234,56'), '1234.56');
  assert.equal(comma('12.345.678,9'), '12345678.9');
  assert.equal(comma('1234'), '1234');
  assert.equal(comma(' 999,99 '), '999.99');
  assert.equal(comma('1.23'), null, 'un punto que no agrupa de a tres es ambiguo');
  assert.equal(comma('1,234.56'), null);
  assert.equal(comma('-10,00'), null);
  assert.equal(comma('abc'), null);
  assert.equal(comma(''), null);
  const dot = (value) => parseLocalizedDecimal(value, '.');
  assert.equal(dot('1234.56'), '1234.56');
  assert.equal(dot('1.234,56'), null);
  assert.equal(dot('1,5'), null);
});

test('GTIN: longitudes admitidas y dígito de control', () => {
  assert.equal(isValidGtin(demoEan('290000000001')), true);
  assert.equal(isValidGtin('7790001000014'.slice(0, 12) + '0'), false);
  assert.equal(isValidGtin('96385074'), true, 'EAN-8');
  assert.equal(isValidGtin('96385075'), false);
  assert.equal(isValidGtin('036000291452'), true, 'UPC-A');
  assert.equal(isValidGtin('10012345678902'), true, 'GTIN-14');
  assert.equal(isValidGtin('123'), false);
  assert.equal(isValidGtin('12345678901234567'), false);
});

test('unidades, modalidad y fechas: alias conocidos o rechazo, nunca adivinar', () => {
  assert.deepEqual(['kg', 'Kilos', 'gr', 'lts', 'cc', 'un', 'UNIT', 'ML'].map(parseUnit), ['KG', 'KG', 'G', 'L', 'ML', 'UNIT', 'UNIT', 'ML']);
  assert.equal(parseUnit('libras'), null);
  assert.deepEqual([null, '', 'pesable', 'Granel', 'PACKAGED', 'otra'].map(parseSaleMode), ['PACKAGED', 'PACKAGED', 'VARIABLE_WEIGHT', 'VARIABLE_WEIGHT', 'PACKAGED', null]);
  assert.equal(parseObservedAt('2026-09-28').toISOString(), '2026-09-28T15:00:00.000Z', 'un día sin hora es el mediodía argentino');
  assert.equal(parseObservedAt('2026-09-28T09:30:00-03:00').toISOString(), '2026-09-28T12:30:00.000Z');
  assert.equal(parseObservedAt('2026-02-30'), null);
  assert.equal(parseObservedAt('28/09/2026'), null);
  assert.equal(parseObservedAt('2026-09-28T09:30:00'), null, 'sin zona horaria es ambiguo');
});

test('un registro válido se normaliza sin redondear el precio ni perder el origen', () => {
  const result = normalize(record());
  assert.equal(result.ok, true);
  const { value } = result;
  assert.equal(value.position, 7);
  assert.equal(value.price, '1234.56');
  assert.equal(value.observedAt.toISOString(), '2026-09-28T15:00:00.000Z');
  assert.deepEqual([value.product.unit, value.product.saleMode, value.product.quantity, value.product.eanDiscarded], ['KG', 'PACKAGED', '1', false]);
  assert.deepEqual([value.store.latitude, value.store.longitude], ['-34.6', '-58.4']);
  const withoutEan = normalize(record({ product: { ean: null } }));
  assert.deepEqual([withoutEan.value.product.ean, withoutEan.value.product.eanDiscarded], [null, false], 'sin EAN también se importa');
  const badEan = normalize(record({ product: { ean: '7790000000000' } }));
  assert.deepEqual([badEan.value.product.ean, badEan.value.product.eanDiscarded], [null, true], 'un EAN inválido se descarta y se informa');
});

test('rechazos con motivo, sin volcar el contenido del registro', () => {
  const cases = [
    [record({ price: 'abc' }), 'PRICE_INVALID'],
    [record({ price: '0,00' }), 'PRICE_INVALID'],
    [record({ price: '-10,00' }), 'PRICE_INVALID'],
    [record({ product: { unit: 'XX' } }), 'UNIT_UNKNOWN'],
    [record({ product: { saleMode: 'otra' } }), 'SALE_MODE_UNKNOWN'],
    [record({ product: { quantity: '0' } }), 'QUANTITY_INVALID'],
    [record({ product: { name: '  ' } }), 'PRODUCT_INVALID'],
    [record({ product: { externalId: '' } }), 'PRODUCT_INVALID'],
    [record({ store: { name: ' ' } }), 'STORE_INVALID'],
    [record({ store: { latitude: '-34.6', longitude: null } }), 'STORE_INVALID'],
    [record({ store: { latitude: '-134.6', longitude: '-58.4' } }), 'STORE_INVALID'],
    [record({ observedAt: '2026-02-30' }), 'OBSERVED_AT_INVALID'],
    [record({ observedAt: '2026-10-05' }), 'OBSERVED_IN_FUTURE'],
  ];
  for (const [raw, reason] of cases) {
    const result = normalize(raw);
    assert.equal(reasonOf(result), reason, JSON.stringify(raw).slice(0, 80));
    assert.equal(result.rejection.position, 7);
    assert.ok(!result.rejection.detail.includes('1.234,56'), 'el detalle no copia valores');
  }
});

test('promociones: tipo, importes con coma, días y vigencia; lo desconocido se rechaza', () => {
  const base = {
    kind: 'promotion',
    externalId: 'promo-1',
    name: '10% en arroz',
    type: 'PERCENTAGE',
    chain: 'Coto',
    discountPercentage: '10,00',
    discountCap: '3.000,00',
    capPeriod: 'PURCHASE',
    eligibleWeekdays: [3, 2, 2],
    validFrom: '2026-09-28',
    validUntil: '2026-10-05',
  };
  const ok = normalizePromotionRecord(base, 1, { separator: ',' });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.value.discountPercentage, ok.value.discountCap, ok.value.eligibleWeekdays], ['10.00', '3000.00', [2, 3]]);
  for (const [overrides, detail] of [
    [{ type: 'CUPON' }, 'tipo'],
    [{ discountPercentage: '10.5' }, 'importe ambiguo'],
    [{ paymentMethod: 'CHEQUE' }, 'medio de pago'],
    [{ capPeriod: 'YEAR' }, 'período'],
    [{ eligibleWeekdays: [0] }, 'día'],
    [{ validUntil: 'mañana' }, 'vigencia'],
    [{ name: '' }, 'nombre'],
  ]) {
    assert.equal(reasonOf(normalizePromotionRecord({ ...base, ...overrides }, 1, { separator: ',' })), 'PROMOTION_INVALID', detail);
  }
});
