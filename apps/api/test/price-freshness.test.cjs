const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_PRICE_MAX_AGE_DAYS,
  ageInDays,
  freshnessOf,
  selectCurrentObservation,
} = require('../dist/modules/prices/domain/price-freshness');
const { buildIdempotencyKey, utcDateKey } = require('../dist/modules/prices/domain/price-identity');

const observation = (id, observedAt, { source = 'demo-seed', ingestedAt = observedAt } = {}) => ({
  id,
  source,
  observedAt: new Date(observedAt),
  ingestedAt: new Date(ingestedAt),
});

test('el precio actual es la observación más reciente de esa sucursal', () => {
  const observations = [
    observation('a', '2026-09-10T12:00:00Z'),
    observation('b', '2026-09-18T12:00:00Z'),
    observation('c', '2026-09-01T12:00:00Z'),
  ];
  assert.equal(selectCurrentObservation(observations)?.id, 'b');
  assert.equal(selectCurrentObservation([]), null);
});

test('los empates se resuelven de forma determinista y configurable', () => {
  const sameDay = '2026-09-18T12:00:00Z';
  const scraper = observation('a', sameDay, { source: 'scraper', ingestedAt: '2026-09-18T13:00:00Z' });
  const oficial = observation('b', sameDay, { source: 'oficial', ingestedAt: '2026-09-18T12:30:00Z' });
  // Sin precedencia declarada gana la ingesta más reciente.
  assert.equal(selectCurrentObservation([scraper, oficial])?.id, 'a');
  // Con precedencia, la fuente preferida gana aunque haya entrado antes.
  assert.equal(selectCurrentObservation([scraper, oficial], { sourcePrecedence: ['oficial'] })?.id, 'b');
  // Misma fuente y misma ingesta: desempata el id, no el orden de llegada.
  const first = observation('a1', sameDay);
  const second = observation('a2', sameDay);
  assert.equal(selectCurrentObservation([second, first])?.id, 'a1');
  assert.equal(selectCurrentObservation([first, second])?.id, 'a1');
});

test('la frescura compara contra un umbral configurable en días', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  assert.equal(DEFAULT_PRICE_MAX_AGE_DAYS, 7);
  assert.equal(ageInDays(new Date('2026-09-11T12:00:00Z'), now), 7);
  assert.equal(freshnessOf(new Date('2026-09-11T12:00:00Z'), now, 7).isStale, false);
  assert.equal(freshnessOf(new Date('2026-09-10T12:00:00Z'), now, 7).isStale, true);
  assert.equal(freshnessOf(new Date('2026-09-10T12:00:00Z'), now, 30).isStale, false);
  const freshness = freshnessOf(new Date('2026-09-06T12:00:00Z'), now, 7);
  assert.equal(freshness.ageDays, 12);
  assert.equal(freshness.maxAgeDays, 7);
  assert.throws(() => freshnessOf(now, now, 0), RangeError);
  assert.throws(() => freshnessOf(now, now, 1.5), RangeError);
});

test('la clave idempotente conserva el historial por día y respeta el id del proveedor', () => {
  const observedAt = new Date('2026-09-18T23:30:00Z');
  assert.equal(utcDateKey(observedAt), '2026-09-18');
  assert.equal(
    buildIdempotencyKey({ productKey: 'p1', storeKey: 's1', observedAt }),
    'p1:s1:2026-09-18',
  );
  // Otro día de la misma pareja producto/sucursal es otra observación, no un reintento.
  assert.notEqual(
    buildIdempotencyKey({ productKey: 'p1', storeKey: 's1', observedAt: new Date('2026-09-19T12:00:00Z') }),
    buildIdempotencyKey({ productKey: 'p1', storeKey: 's1', observedAt }),
  );
  assert.equal(
    buildIdempotencyKey({ productKey: 'p1', storeKey: 's1', observedAt, externalId: 'feed-42' }),
    'feed-42',
  );
  assert.throws(
    () => buildIdempotencyKey({ productKey: 'p'.repeat(300), storeKey: 's1', observedAt }),
    RangeError,
  );
});
