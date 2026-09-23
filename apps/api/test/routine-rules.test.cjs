const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NeedQuantityError, toCanonicalQuantity } = require('../dist/modules/catalog/domain/need-quantity');
const {
  RoutineRuleError,
  argentineToday,
  assertBrandsDisjoint,
  assertSubstitutionRule,
  effectiveSchedule,
  normalizeBrandList,
  parseCalendarDate,
  resolveScheduleOverride,
  validateFrequencyDays,
} = require('../dist/modules/routines/domain/routine-rules');

const need = (quantity, unit, canonicalUnit) => toCanonicalQuantity({ quantity, unit }, canonicalUnit, { allowZero: false });
const stock = (quantity, unit, canonicalUnit) => toCanonicalQuantity({ quantity, unit }, canonicalUnit, { allowZero: true });
const failsWith = (fn, kind, code, fields) => assert.throws(fn, (error) => {
  assert.ok(error instanceof kind, error.name);
  assert.equal(error.code, code);
  if (fields) assert.deepEqual(error.fields, fields);
  return true;
});

test('la necesidad se guarda en la unidad del canónico, sin redondear', () => {
  assert.deepEqual(need('500', 'G', 'KG'), { quantity: '0.5', unit: 'KG' });
  assert.deepEqual(need('5', 'KG', 'KG'), { quantity: '5', unit: 'KG' });
  assert.deepEqual(need('1500', 'ML', 'L'), { quantity: '1.5', unit: 'L' });
  assert.deepEqual(need('0.5', 'G', 'KG'), { quantity: '0.0005', unit: 'KG' });
  assert.deepEqual(need('12', 'UNIT', 'UNIT'), { quantity: '12', unit: 'UNIT' });
});

test('rechaza unidades de otra dimensión y precisión que no entra en numeric(14,4)', () => {
  failsWith(() => need('1', 'L', 'KG'), NeedQuantityError, 'UNIT_DIMENSION_MISMATCH', ['unit']);
  failsWith(() => need('6', 'UNIT', 'KG'), NeedQuantityError, 'UNIT_DIMENSION_MISMATCH', ['unit']);
  failsWith(() => need('1', 'LB', 'KG'), NeedQuantityError, 'UNIT_DIMENSION_MISMATCH', ['unit']);
  // 0,05 g son 0,00005 kg: cinco decimales. Se rechaza en vez de guardar 0,0001 o 0.
  failsWith(() => need('0.05', 'G', 'KG'), NeedQuantityError, 'QUANTITY_INVALID', ['quantity']);
  failsWith(() => need('abc', 'KG', 'KG'), NeedQuantityError, 'QUANTITY_INVALID', ['quantity']);
  failsWith(() => need('12345678901', 'KG', 'KG'), NeedQuantityError, 'QUANTITY_INVALID', ['quantity']);
});

test('necesidad estrictamente positiva; inventario admite cero pero no negativos', () => {
  failsWith(() => need('0', 'KG', 'KG'), NeedQuantityError, 'QUANTITY_INVALID', ['quantity']);
  assert.deepEqual(stock('0', 'G', 'KG'), { quantity: '0', unit: 'KG' });
  assert.deepEqual(stock('2000', 'G', 'KG'), { quantity: '2', unit: 'KG' });
  failsWith(() => stock('-1', 'KG', 'KG'), NeedQuantityError, 'QUANTITY_INVALID', ['quantity']);
});

test('frecuencia en días reales: semanal 7, cada 15 días 15, sin aproximar meses', () => {
  assert.equal(validateFrequencyDays(7), 7);
  assert.equal(validateFrequencyDays(15), 15);
  assert.equal(validateFrequencyDays(365), 365);
  for (const invalid of [0, -7, 1.5, 366]) {
    failsWith(() => validateFrequencyDays(invalid), RoutineRuleError, 'FREQUENCY_INVALID', ['frequencyDays']);
  }
});

test('el ancla es un día real de calendario', () => {
  assert.equal(parseCalendarDate('2026-09-23'), '2026-09-23');
  assert.equal(parseCalendarDate('2028-02-29'), '2028-02-29');
  for (const invalid of ['2026-02-30', '2027-02-29', '2026-13-01', '23/09/2026', '1999-12-31', '2026-9-3']) {
    failsWith(() => parseCalendarDate(invalid), RoutineRuleError, 'ANCHOR_DATE_INVALID', ['anchorDate']);
  }
});

test('hoy se lee en el calendario argentino, no en UTC', () => {
  // 02:00 UTC del 24 es todavía el 23 a las 23:00 en Buenos Aires (UTC-3).
  assert.equal(argentineToday(new Date('2026-09-24T02:00:00Z')), '2026-09-23');
  assert.equal(argentineToday(new Date('2026-09-24T03:00:00Z')), '2026-09-24');
});

test('el ítem hereda frecuencia y ancla juntas o reemplaza las dos', () => {
  const routine = { frequencyDays: 7, anchorDate: '2026-09-21' };
  assert.equal(resolveScheduleOverride(null, null), null);
  assert.deepEqual(effectiveSchedule(routine, null), { frequencyDays: 7, anchorDate: '2026-09-21', inherited: true });

  const override = resolveScheduleOverride(15, '2026-09-25');
  assert.deepEqual(override, { frequencyDays: 15, anchorDate: '2026-09-25' });
  assert.deepEqual(effectiveSchedule(routine, override), { frequencyDays: 15, anchorDate: '2026-09-25', inherited: false });

  const pair = ['frequencyDays', 'anchorDate'];
  failsWith(() => resolveScheduleOverride(15, null), RoutineRuleError, 'SCHEDULE_OVERRIDE_INCOMPLETE', pair);
  failsWith(() => resolveScheduleOverride(null, '2026-09-25'), RoutineRuleError, 'SCHEDULE_OVERRIDE_INCOMPLETE', pair);
  failsWith(() => resolveScheduleOverride(0, '2026-09-25'), RoutineRuleError, 'FREQUENCY_INVALID');
});

test('marcas: sin duplicados por mayúsculas o tildes, y nunca preferida y excluida a la vez', () => {
  assert.deepEqual(normalizeBrandList([' La  Serenísima ', 'la serenisima', 'Arcor', '  ']), ['La Serenísima', 'Arcor']);
  assertBrandsDisjoint(['Arcor'], ['Ledesma']);
  assertBrandsDisjoint([], []);
  failsWith(
    () => assertBrandsDisjoint(['Arcor'], ['ARCOR']),
    RoutineRuleError,
    'BRANDS_OVERLAP',
    ['preferredBrands', 'excludedBrands'],
  );
  failsWith(() => assertBrandsDisjoint(['Serenísima'], ['serenisima']), RoutineRuleError, 'BRANDS_OVERLAP');
});

test('sin sustitutos el producto preferido es obligatorio', () => {
  assertSubstitutionRule(true, null);
  assertSubstitutionRule(false, '4b8c1c52-7d4e-4a3a-9f55-2d1b0a1e3c11');
  failsWith(() => assertSubstitutionRule(false, null), RoutineRuleError, 'PREFERRED_PRODUCT_REQUIRED', ['preferredProductId']);
});
