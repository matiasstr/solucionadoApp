const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  analyzeSeries,
  argentineDate,
  argentineDayStart,
  dailyCloses,
  daysBetween,
  shiftDate,
} = require('../dist/modules/prices/domain/price-analysis');

// Reloj fijo: martes 29/09/2026 a las 12:00 en Argentina.
const NOW = new Date('2026-09-29T15:00:00.000Z');
let sequence = 0;
/** Observación a las `hour` de Argentina del día indicado. */
const obs = (date, unitPrice, { hour = 9, id, ingestedAt } = {}) => {
  const observedAt = new Date(Date.parse(`${date}T00:00:00.000Z`) + (hour + 3) * 3_600_000);
  return {
    id: id ?? `obs-${String(sequence++).padStart(4, '0')}`,
    price: unitPrice,
    unitPrice,
    observedAt,
    ingestedAt: ingestedAt ?? observedAt,
  };
};
/** Días `from`..`to` inclusive con el mismo precio. */
const days = (from, to, unitPrice) =>
  Array.from({ length: daysBetween(from, to) + 1 }, (_, index) => obs(shiftDate(from, index), unitPrice));
const analyze = (observations, latest = observations[observations.length - 1], maxAgeDays = 7) =>
  analyzeSeries({ observations, latest, now: NOW, maxAgeDays });

// Base de 10 días: nueve a 100 y uno a 70 → promedio 97, mínimo 70. Umbrales: 82,45 y 111,55.
const BASE = [...days('2026-09-19', '2026-09-27', '100.000000'), obs('2026-09-28', '70.000000')];
const withCurrent = (unitPrice) => [...BASE, obs('2026-09-29', unitPrice)];

test('el día se lee en calendario argentino: las 02:59 UTC todavía son el día anterior', () => {
  assert.equal(argentineDate(new Date('2026-09-29T02:59:59.999Z')), '2026-09-28');
  assert.equal(argentineDate(new Date('2026-09-29T03:00:00.000Z')), '2026-09-29');
  assert.equal(argentineDayStart('2026-09-29').toISOString(), '2026-09-29T03:00:00.000Z');
  assert.equal(shiftDate('2026-09-29', -30), '2026-08-30');
  assert.equal(daysBetween('2026-09-01', '2026-09-30'), 29);
});

test('cierre diario: la última observación del día, contadas todas; los huecos no se rellenan', () => {
  const closes = dailyCloses([
    obs('2026-09-20', '50.000000', { hour: 8 }),
    obs('2026-09-20', '100.000000', { hour: 20 }),
    obs('2026-09-20', '60.000000', { hour: 12 }),
    obs('2026-09-22', '90.000000'),
    // Misma hora observada: gana la ingesta más reciente.
    obs('2026-09-23', '10.000000', { hour: 9, ingestedAt: new Date('2026-09-23T13:00:00.000Z') }),
    obs('2026-09-23', '20.000000', { hour: 9, ingestedAt: new Date('2026-09-23T14:00:00.000Z') }),
  ]);
  assert.deepEqual(
    closes.map((close) => [close.date, close.unitPrice, close.observations]),
    [['2026-09-20', '100.000000', 3], ['2026-09-22', '90.000000', 1], ['2026-09-23', '20.000000', 2]],
  );
});

test('umbrales exactos: < 85 % del promedio es buena oferta, igual no; > 115 % es caro, igual no', () => {
  const at = (unitPrice) => analyze(withCurrent(unitPrice));
  assert.equal(at('97.000000').average, '97.000000');
  assert.equal(at('82.449999').classification, 'GOOD_DEAL');
  assert.equal(at('82.450000').classification, 'NORMAL');
  assert.equal(at('111.550000').classification, 'NORMAL');
  assert.equal(at('111.550001').classification, 'EXPENSIVE');
  assert.equal(at('97.000000').ratioToAverage, '1.0000');
  assert.equal(at('82.450000').ratioToAverage, '0.8500');
});

test('mínimo de la ventana: estar por debajo es HISTORIC_LOW (gana a buena oferta); igualarlo no', () => {
  const below = analyze(withCurrent('69.990000'));
  assert.equal(below.classification, 'HISTORIC_LOW');
  assert.deepEqual([below.lowest, below.lowestDate, below.highest], ['70.000000', '2026-09-28', '100.000000']);
  const tie = analyze(withCurrent('70.000000'));
  assert.equal(tie.classification, 'GOOD_DEAL', 'empate con el mínimo: no es un mínimo nuevo');
  // Dos días con el mismo mínimo: se informa el más reciente.
  const repeated = analyze([...days('2026-09-15', '2026-09-24', '100.000000'), obs('2026-09-25', '70.000000'), obs('2026-09-27', '70.000000'), obs('2026-09-29', '90.000000')]);
  assert.equal(repeated.lowestDate, '2026-09-27');
});

test('la base son los 30 días anteriores al precio actual: ni el día actual ni lo más viejo', () => {
  const observations = [
    obs('2026-08-29', '1.000000'), // 31 días antes: afuera
    ...BASE,
    obs('2026-09-29', '100.000000', { hour: 8 }),
    obs('2026-09-29', '60.000000', { hour: 11 }),
  ];
  const result = analyze(observations);
  assert.deepEqual(result.baseWindow, { from: '2026-08-30', to: '2026-09-28', days: 30, daysWithData: 10, observations: 10 });
  assert.equal(result.lowest, '70.000000', 'ni el viejo de $1 ni el precio de hoy entran en la base');
  assert.equal(result.classification, 'HISTORIC_LOW');
  assert.deepEqual([result.current.date, result.current.unitPrice, result.current.ageDays], ['2026-09-29', '60.000000', 0]);
});

test('varios precios por día pesan como un día: el promedio es por día, no por observación', () => {
  const noisy = [
    ...days('2026-09-19', '2026-09-26', '100.000000'),
    ...Array.from({ length: 9 }, (_, index) => obs('2026-09-27', '10.000000', { hour: 8 + index })),
    obs('2026-09-27', '100.000000', { hour: 20 }),
    obs('2026-09-29', '100.000000'),
  ];
  const result = analyze(noisy);
  assert.equal(result.average, '100.000000');
  assert.equal(result.baseWindow.observations, 18);
  assert.equal(result.baseWindow.daysWithData, 9);
});

test('pocas muestras o días faltantes: sin etiqueta concluyente, pero con los datos que hay', () => {
  const sparse = [obs('2026-09-20', '100.000000'), obs('2026-09-23', '100.000000'), obs('2026-09-26', '100.000000'), obs('2026-09-29', '50.000000')];
  const result = analyze(sparse);
  assert.equal(result.classification, 'INSUFFICIENT_DATA');
  assert.equal(result.baseWindow.daysWithData, 3);
  assert.equal(result.average, '100.000000');
  const seven = [...days('2026-09-22', '2026-09-28', '100.000000'), obs('2026-09-29', '100.000000')];
  assert.equal(analyze(seven).classification, 'NORMAL', 'siete días alcanzan');
  const six = [...days('2026-09-23', '2026-09-28', '100.000000'), obs('2026-09-29', '100.000000')];
  assert.equal(analyze(six).classification, 'INSUFFICIENT_DATA');
  const onlyCurrent = analyze([obs('2026-09-29', '100.000000')]);
  assert.deepEqual([onlyCurrent.classification, onlyCurrent.average, onlyCurrent.baseWindow.daysWithData], ['INSUFFICIENT_DATA', null, 0]);
  const nothing = analyzeSeries({ observations: [], latest: null, now: NOW, maxAgeDays: 7 });
  assert.deepEqual([nothing.classification, nothing.current, nothing.baseWindow], ['INSUFFICIENT_DATA', null, null]);
});

test('un precio viejo no da etiqueta: STALE aunque parezca una oferta, con la base relativa a su fecha', () => {
  const old = [...days('2026-08-20', '2026-09-15', '100.000000'), obs('2026-09-17', '50.000000')];
  const result = analyze(old);
  assert.equal(result.current.ageDays, 12);
  assert.equal(result.current.isStale, true);
  assert.equal(result.classification, 'STALE');
  assert.equal(result.baseWindow.to, '2026-09-16');
  assert.equal(analyze(old, old[old.length - 1], 30).classification, 'HISTORIC_LOW', 'con un umbral de 30 días sí vale');
  const staleNoBase = analyze([obs('2026-09-10', '50.000000')]);
  assert.equal(staleNoBase.classification, 'STALE');
});

test('determinista: el orden de las observaciones no cambia el resultado', () => {
  const observations = withCurrent('82.000000');
  assert.deepEqual(analyze([...observations].reverse(), observations[observations.length - 1]), analyze(observations));
});
