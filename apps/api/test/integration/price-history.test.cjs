// Historial y análisis de precios (P6-01) contra PostgreSQL/PostGIS real.
// Ejecutar con `npm.cmd run test:db`. Público: no requiere sesión.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { argentineDate, shiftDate } = require('../../dist/modules/prices/domain/price-analysis');
const {
  latestObservationAnchor,
  seedDemoCatalog,
  demoProductId,
  demoStoreId,
} = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const POLLO = demoProductId('pollo-entero-granel');
const DISCO_BELGRANO = demoStoreId('disco-belgrano');
const VEA_FLORES = demoStoreId('vea-flores');
const VEA_MORON = demoStoreId('vea-moron');
const COTO_CABALLITO = demoStoreId('coto-caballito');
const CLASSIFICATIONS = ['HISTORIC_LOW', 'GOOD_DEAL', 'NORMAL', 'EXPENSIVE', 'STALE', 'INSUFFICIENT_DATA'];
const TODAY = argentineDate(new Date());

let app;
let server;
let prisma;
let pg;
before(async () => {
  prisma = new PrismaService(url);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  app = await createApp(
    validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars' }),
    new JsonLogger(() => {}),
  );
  await app.init();
  server = app.getHttpServer();
  pg = new Client({ connectionString: url });
  await pg.connect();
});
after(async () => {
  await app?.close();
  await pg?.end();
  await prisma?.$disconnect();
});

const history = (productId, query = '') => request(server).get(`/api/products/${productId}/price-history${query}`);
async function expectError(promise, status, error, fields) {
  const response = await promise.expect(status);
  assert.equal(response.body.error, error, JSON.stringify(response.body));
  if (fields) assert.deepEqual(response.body.fields, fields);
}
const seriesOf = (body, storeId) => body.series.filter((entry) => entry.store.id === storeId);

describe('historial', () => {
  test('por defecto: últimos 30 días, una serie por sucursal y fuente, un punto por día sin rellenar huecos', async () => {
    const { body } = await history(POLLO).expect(200);
    assert.equal(body.product.id, POLLO);
    assert.deepEqual(body.range, { from: shiftDate(TODAY, -29), to: TODAY, days: 30, timeZone: 'America/Argentina/Buenos_Aires', granularity: 'DAY' });
    assert.equal(body.scope.origin, 'ALL');
    assert.deepEqual(body.policy, {
      dailyClose: 'LAST_OBSERVATION_OF_DAY',
      windowDays: 30,
      minDaysWithData: 7,
      goodDealBelowRatio: '0.85',
      expensiveAboveRatio: '1.15',
      maxAgeDays: 7,
    });
    assert.ok(body.series.length >= 5);
    assert.equal(body.truncated, false);
    const keys = body.series.map((entry) => `${entry.store.id}|${entry.source}`);
    assert.equal(new Set(keys).size, keys.length, 'una serie por sucursal y fuente');
    for (const entry of body.series) {
      assert.equal(entry.unitPriceUnit, 'KG');
      assert.equal(entry.source, 'demo-seed');
      assert.ok(CLASSIFICATIONS.includes(entry.analysis.classification));
      const dates = entry.points.map((point) => point.date);
      assert.deepEqual(dates, [...dates].sort(), 'ordenados por fecha');
      assert.equal(new Set(dates).size, dates.length, 'un punto por día');
      assert.ok(dates.every((date) => date >= body.range.from && date <= body.range.to));
      assert.equal(entry.daysWithData, entry.points.length);
      assert.ok(entry.points.every((point) => /^\d+\.\d{2}$/.test(point.price) && /^\d+\.\d{6}$/.test(point.unitPrice)));
    }
  });

  test('una sucursal que dejó de informar hace 12 días queda desactualizada, sin etiqueta de oferta', async () => {
    const { body } = await history(POLLO, `?storeId=${DISCO_BELGRANO}`).expect(200);
    assert.equal(body.scope.origin, 'STORE');
    const [entry] = body.series;
    assert.equal(entry.store.id, DISCO_BELGRANO);
    assert.equal(entry.analysis.classification, 'STALE');
    assert.ok(entry.analysis.current.ageDays >= 12);
    assert.equal(entry.analysis.current.isStale, true);
    assert.ok(entry.points.every((point) => point.date <= entry.analysis.current.date), 'no se inventan días posteriores');
  });

  test('una sucursal que informa día por medio tiene huecos y aun así alcanza la evidencia mínima', async () => {
    const { body } = await history(POLLO, `?storeId=${VEA_FLORES}`).expect(200);
    const [entry] = body.series;
    assert.ok(entry.daysWithData >= 14 && entry.daysWithData <= 16, `días con dato: ${entry.daysWithData}`);
    assert.ok(entry.analysis.baseWindow.daysWithData >= 7);
    assert.notEqual(entry.analysis.classification, 'INSUFFICIENT_DATA');
    assert.ok(entry.analysis.average && entry.analysis.lowest && entry.analysis.highest);
  });

  test('alcance por localidad sin distancias y por coordenadas con distancia dentro del radio', async () => {
    const locality = (await history(POLLO, '?city=Mor%C3%B3n&province=Buenos%20Aires').expect(200)).body;
    assert.equal(locality.scope.origin, 'LOCALITY');
    assert.deepEqual(locality.series.map((entry) => [entry.store.id, entry.store.distanceMeters]), [[VEA_MORON, null]]);

    const near = (await history(POLLO, '?latitude=-34.6187&longitude=-58.4407&radiusKm=3').expect(200)).body;
    assert.equal(near.scope.origin, 'COORDINATES');
    assert.ok(near.series.some((entry) => entry.store.id === COTO_CABALLITO));
    assert.ok(near.series.every((entry) => entry.store.distanceMeters !== null && entry.store.distanceMeters <= 3000));
  });

  test('rango pedido: inclusivo y acotado; el análisis no depende de lo que se muestra', async () => {
    const from = shiftDate(TODAY, -9);
    const { body } = await history(POLLO, `?storeId=${COTO_CABALLITO}&from=${from}&to=${TODAY}`).expect(200);
    const [entry] = body.series;
    assert.equal(body.range.days, 10);
    assert.ok(entry.points.length <= 10);
    const full = (await history(POLLO, `?storeId=${COTO_CABALLITO}`).expect(200)).body.series[0];
    assert.deepEqual(entry.analysis, full.analysis, 'la base del análisis son siempre los 30 días previos');

    const past = (await history(POLLO, `?storeId=${COTO_CABALLITO}&from=2025-01-01&to=2025-01-31`).expect(200)).body;
    assert.deepEqual(past.series[0].points, [], 'sin datos en el rango: sin puntos, pero con el análisis actual');
    assert.ok(past.series[0].analysis.current);
  });

  test('fuentes distintas son series distintas y varios precios del mismo día dan un solo punto', async () => {
    const day = shiftDate(TODAY, -5);
    const at = (hour) => new Date(Date.parse(`${day}T00:00:00.000Z`) + (hour + 3) * 3_600_000);
    for (const [hour, value] of [[10, '1111.11'], [18, '2222.22']]) {
      await pg.query(
        `INSERT INTO "ProductPrice" ("id", "productId", "storeId", "price", "unitPrice", "unitPriceUnit", "currency", "source", "idempotencyKey", "observedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $3, 'KG'::"BaseUnit", 'ARS', 'test-history', $4, $5)`,
        [POLLO, COTO_CABALLITO, value, randomUUID(), at(hour)],
      );
    }
    const { body } = await history(POLLO, `?storeId=${COTO_CABALLITO}`).expect(200);
    const series = seriesOf(body, COTO_CABALLITO);
    assert.deepEqual(series.map((entry) => entry.source).sort(), ['demo-seed', 'test-history']);
    const extra = series.find((entry) => entry.source === 'test-history');
    assert.deepEqual(extra.points.map((point) => [point.date, point.unitPrice, point.observations]), [[day, '2222.220000', 2]]);
    assert.equal(extra.analysis.classification, 'INSUFFICIENT_DATA', 'una fuente con un solo día no alcanza');
    const seeded = series.find((entry) => entry.source === 'demo-seed');
    assert.ok(!seeded.points.some((point) => point.unitPrice === '2222.220000'), 'la otra fuente no se mezcla');
  });
});

describe('validación', () => {
  test('rangos, fechas, sucursal con ubicación, parámetros desconocidos y producto inexistente', async () => {
    await expectError(history(POLLO, '?from=2026-10-10&to=2026-10-01'), 400, 'VALIDATION_FAILED', ['from', 'to']);
    await expectError(history(POLLO, '?from=2025-01-01&to=2026-01-02'), 400, 'VALIDATION_FAILED', ['from', 'to']);
    await expectError(history(POLLO, '?from=2026-02-30'), 400, 'VALIDATION_FAILED', ['from']);
    await expectError(history(POLLO, '?to=30/09/2026'), 400, 'VALIDATION_FAILED');
    await expectError(history(POLLO, `?storeId=${VEA_MORON}&city=Mor%C3%B3n&province=Buenos%20Aires`), 400, 'VALIDATION_FAILED', ['storeId']);
    await expectError(history(POLLO, '?radiusKm=5'), 400, 'VALIDATION_FAILED', ['radiusKm']);
    await expectError(history(POLLO, '?includeStale=true'), 400, 'VALIDATION_FAILED');
    await expectError(history(POLLO, '?storeId=no-es-uuid'), 400, 'VALIDATION_FAILED');
    await expectError(history(randomUUID()), 404, 'NOT_FOUND');
    await expectError(history('no-es-uuid'), 400, 'VALIDATION_FAILED', ['id']);
    // 366 días entran.
    await history(POLLO, `?from=${shiftDate(TODAY, -365)}&to=${TODAY}&storeId=${COTO_CABALLITO}`).expect(200);
  });
});
