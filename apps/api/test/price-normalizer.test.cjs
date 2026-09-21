const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PriceNormalizationError,
  normalizePrice,
} = require('../dist/modules/prices/domain/price-normalizer');

const normalize = (input) => normalizePrice({ saleMode: 'PACKAGED', ...input });

const rejects = (input, code) =>
  assert.throws(
    () => normalize(input),
    (error) => error instanceof PriceNormalizationError && error.code === code,
    `debería fallar con ${code}: ${JSON.stringify(input)}`,
  );

test('normaliza presentaciones distintas a un precio comparable por unidad base', () => {
  assert.deepEqual(normalize({ price: '1290.00', quantity: '1', unit: 'KG' }), {
    price: '1290.00',
    unitPrice: '1290.000000',
    unitPriceUnit: 'KG',
    baseQuantity: '1',
  });
  // 500 g a 720 pesos es más caro por kilo que 1 kg a 1290.
  assert.equal(normalize({ price: '720.00', quantity: '500', unit: 'G' }).unitPrice, '1440.000000');
  assert.equal(normalize({ price: '2890.00', quantity: '900', unit: 'ML' }).unitPrice, '3211.111111');
  assert.equal(normalize({ price: '3890.00', quantity: '12', unit: 'UNIT' }).unitPrice, '324.166667');
});

test('el envase se cotiza por su contenido total, no por cantidad de botellas', () => {
  const pack = normalize({ price: '13900.00', quantity: '13.5', unit: 'L' });
  assert.equal(pack.unitPrice, '1029.629630');
  assert.equal(pack.unitPriceUnit, 'L');
  const single = normalize({ price: '2590.00', quantity: '2.25', unit: 'L' });
  assert.equal(single.unitPrice, '1151.111111');
});

test('la venta por peso cotiza sobre su base y rechaza unidades de conteo', () => {
  const bulk = normalize({ price: '8900.00', quantity: '1', unit: 'KG', saleMode: 'VARIABLE_WEIGHT' });
  assert.equal(bulk.unitPrice, '8900.000000');
  assert.equal(bulk.unitPriceUnit, 'KG');
  rejects({ price: '8900.00', quantity: '1', unit: 'UNIT', saleMode: 'VARIABLE_WEIGHT' }, 'SALE_MODE_UNIT');
});

test('rechaza importes y cantidades que la base truncaría o invertiría', () => {
  rejects({ price: '0', quantity: '1', unit: 'KG' }, 'PRICE_NOT_POSITIVE');
  rejects({ price: '-1290.00', quantity: '1', unit: 'KG' }, 'PRICE_NOT_POSITIVE');
  rejects({ price: '10.005', quantity: '1', unit: 'KG' }, 'PRICE_SCALE');
  rejects({ price: 'gratis', quantity: '1', unit: 'KG' }, 'PRICE_FORMAT');
  rejects({ price: '100.00', quantity: '1,5', unit: 'KG' }, 'QUANTITY_FORMAT');
  rejects({ price: '9999999999999.00', quantity: '1', unit: 'KG' }, 'PRICE_OVERFLOW');
  rejects({ price: '100.00', quantity: '0', unit: 'KG' }, 'QUANTITY_NOT_POSITIVE');
  rejects({ price: '100.00', quantity: '-1', unit: 'KG' }, 'QUANTITY_NOT_POSITIVE');
  rejects({ price: '100.00', quantity: '0.00001', unit: 'KG' }, 'QUANTITY_SCALE');
  // 0,01 / 100000 kg se redondearía a cero: no es un precio comparable.
  rejects({ price: '0.01', quantity: '100000', unit: 'KG' }, 'UNIT_PRICE_UNDERFLOW');
});

test('un producto no se compara con un canónico de otra dimensión', () => {
  assert.equal(normalize({ price: '1290.00', quantity: '1', unit: 'L', canonicalUnit: 'L' }).unitPriceUnit, 'L');
  rejects({ price: '1290.00', quantity: '1', unit: 'KG', canonicalUnit: 'L' }, 'DIMENSION_MISMATCH');
  rejects({ price: '1290.00', quantity: '900', unit: 'ML', canonicalUnit: 'UNIT' }, 'DIMENSION_MISMATCH');
});

test('mantiene la precisión decimal del importe y del precio por unidad', () => {
  const result = normalize({ price: '0.10', quantity: '3', unit: 'UNIT' });
  assert.equal(result.price, '0.10');
  assert.equal(result.unitPrice, '0.033333');
  assert.equal(normalize({ price: '1.05', quantity: '200', unit: 'G' }).unitPrice, '5.250000');
});
