const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DecimalValue } = require('../dist/modules/catalog/domain/decimal');
const {
  UnitConversionError,
  baseUnitOf,
  convertQuantity,
  dimensionOf,
  toBaseQuantity,
  unitPricePer100g,
} = require('../dist/modules/catalog/domain/units');
const { normalizeName, slugify } = require('../dist/modules/catalog/domain/naming');

const base = (quantity, unit) => toBaseQuantity(DecimalValue.parse(quantity), unit).toString();

test('convierte a la unidad base dentro de su dimensión', () => {
  assert.equal(base('500', 'G'), '0.500');
  assert.equal(base('1', 'KG'), '1');
  assert.equal(base('900', 'ML'), '0.900');
  assert.equal(base('13.5', 'L'), '13.5');
  assert.equal(base('12', 'UNIT'), '12');
  assert.equal(baseUnitOf('G'), 'KG');
  assert.equal(baseUnitOf('ML'), 'L');
  assert.equal(baseUnitOf('UNIT'), 'UNIT');
});

test('convierte entre unidades de la misma dimensión', () => {
  const convert = (quantity, from, to) => convertQuantity(DecimalValue.parse(quantity), from, to).toString();
  assert.equal(convert('1.5', 'KG', 'G'), '1500.000000');
  assert.equal(convert('250', 'G', 'KG'), '0.250000');
  assert.equal(convert('2.25', 'L', 'ML'), '2250.000000');
  assert.equal(convert('7', 'UNIT', 'UNIT'), '7');
});

test('no convierte masa en volumen ni unidades en peso', () => {
  for (const [from, to] of [['KG', 'L'], ['ML', 'G'], ['UNIT', 'KG'], ['L', 'UNIT']]) {
    assert.throws(
      () => convertQuantity(DecimalValue.parse('1'), from, to),
      (error) => error instanceof UnitConversionError && error.code === 'UNIT_DIMENSION_MISMATCH',
      `${from} a ${to} debería fallar`,
    );
  }
  assert.equal(dimensionOf('G'), 'MASS');
  assert.equal(dimensionOf('ML'), 'VOLUME');
  assert.equal(dimensionOf('UNIT'), 'COUNT');
});

test('el precio por 100 g es una presentación del precio por KG', () => {
  assert.equal(unitPricePer100g(DecimalValue.parse('8900.000000'), 'KG').toFixed(6), '890.000000');
  assert.equal(unitPricePer100g(DecimalValue.parse('1440.000000'), 'KG').toFixed(2), '144.00');
  for (const unit of ['L', 'UNIT']) {
    assert.throws(
      () => unitPricePer100g(DecimalValue.parse('100'), unit),
      (error) => error instanceof UnitConversionError && error.code === 'UNIT_DIMENSION_MISMATCH',
    );
  }
});

test('normaliza nombres sin acentos ni puntuación y genera slugs estables', () => {
  assert.equal(normalizeName('  Azúcar  Común   Tipo A '), 'azucar comun tipo a');
  assert.equal(normalizeName('Gaseosa cola 2,25 L'), 'gaseosa cola 2 25 l');
  assert.equal(normalizeName('Leche 3% grasa'), 'leche 3% grasa');
  assert.equal(slugify('Frutas y verduras'), 'frutas-y-verduras');
  assert.equal(slugify('Almacén'), 'almacen');
});
