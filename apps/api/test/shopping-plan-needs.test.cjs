const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  addDays,
  argentineNoon,
  occurrencesInWindow,
  resolvePlanWindow,
} = require('../dist/modules/shopping-plans/domain/plan-calendar');
const { PlanningRuleError } = require('../dist/modules/shopping-plans/domain/planning-errors');
const { buildNeeds } = require('../dist/modules/shopping-plans/domain/needs');
const { argentineIsoWeekday } = require('../dist/modules/promotions/domain/promotion-eligibility');

// 2026-09-28 es lunes: la ventana por defecto va de lunes a domingo.
const WEEK = resolvePlanWindow({ startDate: '2026-09-28' }, 28);
const NOW = new Date('2026-09-28T18:00:00.000Z');
const POLLO = 'c-pollo';
const ARROZ = 'c-arroz';
const CANONICALS = [
  { id: POLLO, name: 'Pollo entero fresco', defaultUnit: 'KG' },
  { id: ARROZ, name: 'Arroz largo fino', defaultUnit: 'KG' },
  { id: 'c-leche', name: 'Leche entera', defaultUnit: 'L' },
];

const item = (overrides = {}) => ({
  id: 'item-1',
  routineId: 'routine-1',
  routineName: 'Compra semanal',
  canonicalProductId: POLLO,
  quantity: '5',
  unit: 'KG',
  frequencyDays: 7,
  anchorDate: '2026-09-28',
  inheritedSchedule: true,
  allowSubstitutes: true,
  preferredProductId: null,
  preferredBrands: [],
  excludedBrands: [],
  ...overrides,
});
const stock = (quantity, overrides = {}) => ({
  canonicalProductId: POLLO,
  quantity,
  unit: 'KG',
  updatedAt: new Date('2026-09-25T12:00:00.000Z'),
  ...overrides,
});
const needs = (items, inventory = [], window = WEEK) =>
  buildNeeds({ window, items, inventory, canonicals: CANONICALS, now: NOW });
const failsWith = (fn, code, fields) => assert.throws(fn, (error) => {
  assert.ok(error instanceof PlanningRuleError, error.name);
  assert.equal(error.code, code);
  assert.deepEqual(error.fields, fields);
  return true;
});

test('la ventana por defecto es de una semana con ambos extremos incluidos', () => {
  assert.equal(WEEK.startDate, '2026-09-28');
  assert.equal(WEEK.endDate, '2026-10-04');
  assert.equal(WEEK.days, 7);
  assert.deepEqual(WEEK.dates, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(WEEK.timeZone, 'America/Argentina/Buenos_Aires');
  const custom = resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-10-11' }, 28);
  assert.equal(custom.days, 14);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('la ventana rechaza fechas imposibles, un fin anterior y un horizonte mayor al permitido', () => {
  failsWith(() => resolvePlanWindow({ startDate: '2026-02-30' }, 28), 'PLAN_WINDOW_INVALID', ['startDate']);
  failsWith(() => resolvePlanWindow({ startDate: '2026-09-28', endDate: '28/10/2026' }, 28), 'PLAN_WINDOW_INVALID', ['endDate']);
  failsWith(() => resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-09-27' }, 28), 'PLAN_WINDOW_INVALID', ['endDate']);
  failsWith(
    () => resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-10-26' }, 28),
    'PLAN_WINDOW_TOO_LONG',
    ['startDate', 'endDate'],
  );
  assert.equal(resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-10-25' }, 28).days, 28);
});

test('las promociones de una fecha se evalúan al mediodía argentino de ese día', () => {
  assert.equal(argentineNoon('2026-09-29').toISOString(), '2026-09-29T15:00:00.000Z');
  assert.equal(argentineIsoWeekday(argentineNoon('2026-09-29')), 2, 'martes en Argentina');
  assert.equal(argentineIsoWeekday(argentineNoon('2026-10-04')), 7, 'domingo en Argentina');
});

test('ocurrencias: cada frequencyDays desde el ancla, nunca antes de que empiece la rutina', () => {
  const at = (frequencyDays, anchorDate, window = WEEK) => occurrencesInWindow({ frequencyDays, anchorDate }, window);
  assert.deepEqual(at(7, '2026-09-28'), ['2026-09-28']);
  assert.deepEqual(at(7, '2026-09-21'), ['2026-09-28'], 'ancla anterior: se alinea con la ventana');
  assert.deepEqual(at(7, '2026-09-23'), ['2026-09-30']);
  assert.deepEqual(at(7, '2026-10-02'), ['2026-10-02'], 'ancla dentro de la ventana');
  assert.deepEqual(at(7, '2026-10-10'), [], 'la rutina todavía no empezó');
  assert.deepEqual(at(1, '2026-09-01').length, 7, 'diaria');
  // Quincenal: 15 días no son dos semanas. Desde el 15/9 cae el 30/9; desde el 20/9, el 5/10.
  assert.deepEqual(at(15, '2026-09-15'), ['2026-09-30']);
  assert.deepEqual(at(15, '2026-09-20'), []);
  const twoWeeks = resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-10-11' }, 28);
  assert.deepEqual(at(7, '2026-09-28', twoWeeks), ['2026-09-28', '2026-10-05']);
  assert.deepEqual(at(15, '2026-09-20', twoWeeks), ['2026-10-05'], 'ventana parcial de dos semanas');
});

test('5 kg de pollo semanales menos 2 kg en la despensa son 3 kg a comprar', () => {
  const { needs: [need], skippedItems } = needs([item()], [stock('2')]);
  assert.deepEqual(skippedItems, []);
  assert.equal(need.canonicalProductId, POLLO);
  assert.equal(need.grossQuantity, '5');
  assert.equal(need.netQuantity, '3');
  assert.equal(need.unit, 'KG');
  assert.equal(need.status, 'TO_BUY');
  assert.equal(need.firstOccurrence, '2026-09-28');
  assert.deepEqual(need.inventory, {
    quantity: '2',
    unit: 'KG',
    updatedAt: '2026-09-25T12:00:00.000Z',
    ageDays: 3,
    applied: true,
    subtracted: '2',
  });
  assert.deepEqual(need.sources, [{
    routineId: 'routine-1',
    routineName: 'Compra semanal',
    routineItemId: 'item-1',
    quantityPerOccurrence: '5',
    frequencyDays: 7,
    anchorDate: '2026-09-28',
    inheritedSchedule: true,
    occurrences: ['2026-09-28'],
    quantity: '5',
  }]);
});

test('una despensa mayor que la necesidad la cubre: neta cero, nunca negativa', () => {
  const [need] = needs([item()], [stock('8')]).needs;
  assert.equal(need.netQuantity, '0');
  assert.equal(need.inventory.subtracted, '5', 'solo se usa lo necesario');
  assert.equal(need.status, 'COVERED_BY_INVENTORY');
  const [exact] = needs([item()], [stock('5')]).needs;
  assert.equal(exact.netQuantity, '0');
  assert.equal(exact.status, 'COVERED_BY_INVENTORY');
  const [empty] = needs([item()], [stock('0')]).needs;
  assert.equal(empty.netQuantity, '5', 'un saldo cero no resta nada');
});

test('dos rutinas con el mismo canónico se suman y la despensa se resta una sola vez', () => {
  const result = needs([
    item(),
    item({ id: 'item-2', routineId: 'routine-2', routineName: 'Asado del domingo', quantity: '2', anchorDate: '2026-09-27' }),
  ], [stock('2')]);
  assert.equal(result.needs.length, 1);
  const [need] = result.needs;
  assert.equal(need.grossQuantity, '7');
  assert.equal(need.netQuantity, '5', '7 kg − 2 kg, no 7 − 2 − 2');
  assert.equal(need.inventory.subtracted, '2');
  assert.deepEqual(need.sources.map((source) => [source.routineName, source.occurrences, source.quantity]), [
    ['Compra semanal', ['2026-09-28'], '5'],
    ['Asado del domingo', ['2026-10-04'], '2'],
  ]);
  assert.equal(need.firstOccurrence, '2026-09-28');
});

test('frecuencias y cantidades fraccionarias se multiplican por las ocurrencias', () => {
  const daily = needs([item({ canonicalProductId: ARROZ, quantity: '0.25', frequencyDays: 1, anchorDate: '2026-09-01' })]).needs[0];
  assert.equal(daily.grossQuantity, '1.75', '0,25 kg × 7 días');
  const twoWeeks = resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-10-11' }, 28);
  const weekly = needs([item()], [], twoWeeks).needs[0];
  assert.equal(weekly.grossQuantity, '10');
  assert.equal(weekly.sources[0].occurrences.length, 2);
});

test('un ítem sin ocurrencias en la ventana no genera necesidad y queda registrado', () => {
  const result = needs([item({ frequencyDays: 15, anchorDate: '2026-09-20', inheritedSchedule: false })]);
  assert.deepEqual(result.needs, []);
  assert.deepEqual(result.skippedItems, [{
    routineId: 'routine-1',
    routineItemId: 'item-1',
    canonicalProductId: POLLO,
    reason: 'NO_OCCURRENCES_IN_WINDOW',
  }]);
});

test('unidades incompatibles: no se convierte masa en volumen ni se adivina', () => {
  const result = needs([
    item({ id: 'item-litros', unit: 'L' }),
    item({ id: 'item-leche', canonicalProductId: 'c-leche', quantity: '3', unit: 'L' }),
    item({ id: 'item-huerfano', canonicalProductId: 'c-inexistente' }),
  ], [stock('1', { canonicalProductId: 'c-leche', unit: 'KG' })]);
  assert.deepEqual(result.skippedItems.map((skipped) => [skipped.routineItemId, skipped.reason]), [
    ['item-huerfano', 'CANONICAL_NOT_FOUND'],
    ['item-litros', 'UNIT_MISMATCH'],
  ]);
  const [leche] = result.needs;
  assert.equal(leche.canonicalProductId, 'c-leche');
  assert.equal(leche.inventory.applied, false, 'despensa en KG para un canónico en L');
  assert.equal(leche.inventory.subtracted, '0');
  assert.equal(leche.netQuantity, '3');
});

test('restricciones combinadas: sin reemplazos gana, las marcas excluidas se suman y ganan a las preferidas', () => {
  const [need] = needs([
    item({ allowSubstitutes: false, preferredProductId: 'p-pampa', excludedBrands: ['Del Sur'] }),
    item({
      id: 'item-2',
      routineId: 'routine-2',
      preferredProductId: 'p-delsur',
      preferredBrands: ['del sur', 'Granja'],
      excludedBrands: ['DEL SUR', 'Arcor'],
    }),
  ]).needs;
  assert.deepEqual(need.constraints, {
    allowSubstitutes: false,
    requiredProductId: 'p-pampa',
    preferredProductIds: [],
    preferredBrands: ['Granja'],
    excludedBrands: ['Arcor', 'Del Sur'],
  });
  assert.equal(need.status, 'TO_BUY');

  const [flexible] = needs([
    item({ preferredProductId: 'p-pampa' }),
    item({ id: 'item-2', routineId: 'routine-2', preferredProductId: 'p-delsur' }),
  ]).needs;
  assert.equal(flexible.constraints.allowSubstitutes, true);
  assert.equal(flexible.constraints.requiredProductId, null);
  assert.deepEqual(flexible.constraints.preferredProductIds, ['p-delsur', 'p-pampa']);
});

test('dos presentaciones exactas distintas para el mismo canónico son un conflicto informado', () => {
  const conflicting = [
    item({ allowSubstitutes: false, preferredProductId: 'p-pampa' }),
    item({ id: 'item-2', routineId: 'routine-2', allowSubstitutes: false, preferredProductId: 'p-delsur' }),
  ];
  const [need] = needs(conflicting).needs;
  assert.equal(need.status, 'CONFLICT');
  assert.equal(need.constraints.requiredProductId, null);
  assert.equal(need.constraints.allowSubstitutes, false);
  // Si la despensa ya lo cubre, no hay nada que comprar ni conflicto que resolver.
  assert.equal(needs(conflicting, [stock('20')]).needs[0].status, 'COVERED_BY_INVENTORY');
});

test('determinista: el orden de la entrada no cambia el resultado', () => {
  const items = [
    item(),
    item({ id: 'item-2', routineId: 'routine-2', quantity: '2', excludedBrands: ['Zeta', 'Alfa'] }),
    item({ id: 'item-3', routineId: 'routine-1', canonicalProductId: ARROZ, quantity: '1' }),
    item({ id: 'item-4', routineId: 'routine-3', canonicalProductId: 'c-leche', unit: 'L', quantity: '2' }),
  ];
  const inventory = [stock('2'), stock('0.5', { canonicalProductId: ARROZ })];
  const forward = needs(items, inventory);
  const backward = needs([...items].reverse(), [...inventory].reverse());
  assert.deepEqual(backward, forward);
  assert.deepEqual(forward.needs.map((need) => need.canonicalName), ['Arroz largo fino', 'Leche entera', 'Pollo entero fresco']);
});
