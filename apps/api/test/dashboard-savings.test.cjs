const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectPlansForSavings, summarizeSavings, weekStart } = require('../dist/modules/dashboard/domain/savings-summary');
const { rankOpportunities } = require('../dist/modules/dashboard/domain/opportunities');

// Martes 29/09/2026: la semana ISO va del lunes 28/09 al domingo 04/10.
const TODAY = '2026-09-29';
const plan = (id, status, startDate, endDate, savings, generatedAt = '2026-09-28T10:00:00.000Z') => ({
  id,
  status,
  startDate,
  endDate,
  generatedAt: new Date(generatedAt),
  estimatedSavings: savings,
});

test('semana ISO de lunes a domingo', () => {
  assert.equal(weekStart('2026-09-29'), '2026-09-28');
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
  assert.equal(weekStart('2026-10-05'), '2026-10-05');
});

test('solo cuentan planes en uso o completados: borradores y vencidos sin completar quedan afuera', () => {
  const selected = selectPlansForSavings([
    plan('borrador', 'DRAFT', '2026-09-28', '2026-10-04', '500.00'),
    plan('vencido', 'EXPIRED', '2026-09-14', '2026-09-20', '300.00'),
    plan('activo', 'ACTIVE', '2026-09-28', '2026-10-04', '200.00'),
    plan('hecho', 'COMPLETED', '2026-09-21', '2026-09-27', '100.00'),
  ]);
  assert.deepEqual(selected.map((entry) => entry.id), ['hecho', 'activo']);
});

test('planes superpuestos cuentan una vez: completado antes que activo, y el más nuevo entre iguales', () => {
  const selected = selectPlansForSavings([
    plan('activo', 'ACTIVE', '2026-09-28', '2026-10-04', '900.00', '2026-09-29T09:00:00.000Z'),
    plan('hecho-viejo', 'COMPLETED', '2026-09-27', '2026-10-03', '100.00', '2026-09-27T09:00:00.000Z'),
    plan('hecho-nuevo', 'COMPLETED', '2026-09-28', '2026-10-04', '150.00', '2026-09-28T09:00:00.000Z'),
    plan('otra-semana', 'COMPLETED', '2026-10-05', '2026-10-11', '80.00'),
  ]);
  assert.deepEqual(selected.map((entry) => entry.id), ['hecho-nuevo', 'otra-semana']);
});

test('semana, mes y acumulado por fecha de inicio; sin base no suma y se informa', () => {
  const summary = summarizeSavings([
    plan('esta-semana', 'COMPLETED', '2026-09-28', '2026-10-04', '150.25'),
    plan('semana-pasada', 'COMPLETED', '2026-09-21', '2026-09-27', '100.00'),
    plan('agosto', 'COMPLETED', '2026-08-24', '2026-08-30', '40.00'),
    plan('sin-base', 'COMPLETED', '2026-09-14', '2026-09-20', null),
    plan('negativo', 'COMPLETED', '2026-09-07', '2026-09-13', '-20.00'),
    plan('borrador', 'DRAFT', '2026-09-28', '2026-10-04', '999.00'),
  ], TODAY);
  assert.deepEqual(summary.week, { amount: '150.25', plans: 1 });
  assert.deepEqual(summary.month, { amount: '230.25', plans: 3 }, 'septiembre: 150,25 + 100 − 20');
  assert.deepEqual(summary.total, { amount: '270.25', plans: 4 });
  assert.equal(summary.plansWithoutBaseline, 1);
  assert.deepEqual(summary.countedPlanIds, ['agosto', 'negativo', 'sin-base', 'semana-pasada', 'esta-semana']);
});

test('sin planes elegidos todo es cero', () => {
  const summary = summarizeSavings([plan('borrador', 'DRAFT', '2026-09-28', '2026-10-04', '10.00')], TODAY);
  assert.deepEqual([summary.week, summary.month, summary.total, summary.plansWithoutBaseline], [
    { amount: '0.00', plans: 0 },
    { amount: '0.00', plans: 0 },
    { amount: '0.00', plans: 0 },
    0,
  ]);
});

test('oportunidades: solo mínimo de la ventana y buena oferta, ordenadas y acotadas', () => {
  const series = (id, classification, ratio, canonicalName = 'Arroz') => ({
    canonicalName,
    productId: `p-${id}`,
    storeId: `s-${id}`,
    analysis: { classification, ratioToAverage: ratio },
    payload: id,
  });
  const ranked = rankOpportunities([
    series('normal', 'NORMAL', '0.9000'),
    series('vieja', 'STALE', '0.5000'),
    series('pocos', 'INSUFFICIENT_DATA', '0.4000'),
    series('oferta-leve', 'GOOD_DEAL', '0.8400'),
    series('oferta-fuerte', 'GOOD_DEAL', '0.7000'),
    series('minimo', 'HISTORIC_LOW', '0.9500'),
  ]);
  assert.deepEqual(ranked.map((entry) => entry.payload), ['minimo', 'oferta-fuerte', 'oferta-leve']);
  assert.equal(rankOpportunities([series('a', 'GOOD_DEAL', '0.8'), series('b', 'GOOD_DEAL', '0.7')], 1).length, 1);
});
