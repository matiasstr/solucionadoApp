const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DecimalValue, DecimalError } = require('../dist/modules/catalog/domain/decimal');

test('la suma decimal es exacta donde el punto flotante no lo es', () => {
  assert.equal(DecimalValue.parse('0.1').add(DecimalValue.parse('0.2')).toFixed(2), '0.30');
  let total = DecimalValue.zero(2);
  for (let index = 0; index < 100; index += 1) total = total.add(DecimalValue.parse('0.01'));
  assert.equal(total.toFixed(2), '1.00');
  // 0.1 + 0.2 === 0.30000000000000004 en binario; acá no.
  assert.notEqual((0.1 + 0.2).toString(), '0.3');
});

test('el redondeo es HALF_UP y se aleja de cero', () => {
  assert.equal(DecimalValue.parse('2.345').round(2).toFixed(2), '2.35');
  assert.equal(DecimalValue.parse('2.344').round(2).toFixed(2), '2.34');
  assert.equal(DecimalValue.parse('-2.345').round(2).toFixed(2), '-2.35');
  assert.equal(DecimalValue.parse('2.5').round(0).toFixed(0), '3');
  assert.equal(DecimalValue.parse('-0.005').round(2).toFixed(2), '-0.01');
});

test('la división usa el resto exacto para redondear', () => {
  const divide = (a, b, scale) => DecimalValue.parse(a).divide(DecimalValue.parse(b), scale).toFixed(scale);
  assert.equal(divide('1', '3', 6), '0.333333');
  assert.equal(divide('2', '3', 6), '0.666667');
  assert.equal(divide('2890.00', '0.9', 6), '3211.111111');
  assert.equal(divide('1290.00', '0.5', 6), '2580.000000');
  assert.equal(divide('-1', '3', 6), '-0.333333');
  assert.throws(
    () => DecimalValue.parse('1').divide(DecimalValue.parse('0'), 6),
    (error) => error instanceof DecimalError && error.code === 'DECIMAL_DIVIDE_BY_ZERO',
  );
});

test('multiplicación, comparación y dígitos enteros', () => {
  assert.equal(DecimalValue.parse('1.5').multiply(DecimalValue.parse('0.001')).toFixed(4), '0.0015');
  assert.equal(DecimalValue.parse('10.00').compare(DecimalValue.parse('10')), 0);
  assert.equal(DecimalValue.parse('9.99').compare(DecimalValue.parse('10')), -1);
  assert.equal(DecimalValue.parse('10.01').compare(DecimalValue.parse('10')), 1);
  assert.equal(DecimalValue.parse('0.5').integerDigits(), 1);
  assert.equal(DecimalValue.parse('999999999999.99').integerDigits(), 12);
  assert.equal(DecimalValue.parse('-1234.5').integerDigits(), 4);
  assert.equal(DecimalValue.parse('0').isZero(), true);
  assert.equal(DecimalValue.parse('-0.01').isNegative(), true);
});

test('rechaza texto que no es decimal y escalas fuera de rango', () => {
  for (const invalid of ['', 'abc', '1.2.3', '1,5', '1e3', '.5', '5.', 'Infinity', 'NaN']) {
    assert.throws(
      () => DecimalValue.parse(invalid),
      (error) => error instanceof DecimalError && error.code === 'DECIMAL_FORMAT',
      `debería rechazar ${JSON.stringify(invalid)}`,
    );
  }
  assert.throws(
    () => DecimalValue.parse(`1.${'0'.repeat(21)}1`),
    (error) => error instanceof DecimalError && error.code === 'DECIMAL_SCALE',
  );
  assert.throws(() => DecimalValue.parse('1').round(-1), (error) => error instanceof DecimalError);
});

test('preserva los ceros de la escala pedida al formatear', () => {
  assert.equal(DecimalValue.parse('1290').toFixed(2), '1290.00');
  assert.equal(DecimalValue.parse('0.5').toFixed(6), '0.500000');
  assert.equal(DecimalValue.parse('1.5000').toString(), '1.5000');
  assert.equal(DecimalValue.parse('-0.1').toFixed(3), '-0.100');
});
