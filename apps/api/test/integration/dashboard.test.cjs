// Dashboard privado (P6-02) contra PostgreSQL/PostGIS real. Ejecutar con `npm.cmd run test:db`.
// Último del runner: agrega una observación de precio a la base compartida.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { argentineDate } = require('../../dist/modules/prices/domain/price-analysis');
const {
  latestObservationAnchor,
  seedDemoCatalog,
  demoCanonicalProductId,
  demoProductId,
  demoStoreId,
} = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const POLLO = demoCanonicalProductId('pollo-entero');
const ARROZ = demoCanonicalProductId('arroz-largo-fino');
const POLLO_GRANEL = demoProductId('pollo-entero-granel');
const COTO_CABALLITO = demoStoreId('coto-caballito');
const CABALLITO = { latitude: '-34.6187', longitude: '-58.4407' };
const TODAY = argentineDate(new Date());

let app;
let server;
let prisma;
let pg;
before(async () => {
  prisma = new PrismaService(url);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  app = await createApp(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars',
      AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    }),
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

let counter = 0;
async function register(profile = {}) {
  const response = await request(server)
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'tusofertas-web')
    .send({ email: `tablero${Date.now()}${counter++}@example.com`, password: 'private-fixture-password' })
    .expect(201);
  const token = response.body.accessToken;
  const as = (method) => (path) => request(server)[method](path).set('Authorization', `Bearer ${token}`);
  const user = { id: response.body.user.id, get: as('get'), post: as('post'), patch: as('patch') };
  if (Object.keys(profile).length) await user.patch('/api/users/me').send(profile).expect(200);
  return user;
}
async function withRoutine(user, items = [{ canonicalProductId: POLLO, quantity: '3', unit: 'KG' }, { canonicalProductId: ARROZ, quantity: '2', unit: 'KG' }]) {
  const routine = await user.post('/api/shopping-routines').send({ name: 'Semana', frequencyDays: 7, anchorDate: TODAY }).expect(201);
  for (const item of items) await user.post(`/api/shopping-routines/${routine.body.id}/items`).send(item).expect(201);
}
const dashboard = (user) => user.get('/api/dashboard').expect(200).then((response) => response.body);
const generate = (user) => user.post('/api/shopping-plans/generate').set('Idempotency-Key', randomUUID()).send({}).expect(201).then((r) => r.body);
const setStatus = (user, id, status) => user.patch(`/api/shopping-plans/${id}`).send({ status }).expect(200).then((r) => r.body);

describe('dashboard', () => {
  test('sin token es 401', async () => {
    const response = await request(server).get('/api/dashboard').expect(401);
    assert.equal(response.body.error, 'UNAUTHORIZED');
  });

  test('cuenta nueva: sin próxima compra, ahorro estimado en cero y ningún ahorro registrado', async () => {
    const user = await register();
    const response = await user.get('/api/dashboard').expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const body = response.body;
    assert.equal(body.today, TODAY);
    assert.equal(body.nextPurchase, null);
    assert.deepEqual(body.routines, { routineCount: 0, itemCount: 0 });
    assert.deepEqual(body.savings.estimated.total, { amount: '0.00', plans: 0 });
    assert.equal(body.savings.estimated.selection, 'ONE_PLAN_PER_PERIOD_ACTIVE_OR_COMPLETED');
    assert.equal(body.savings.registered.available, false);
    assert.match(body.savings.registered.message, /Todavía no registramos compras/);
    assert.deepEqual([body.opportunities.items, body.opportunities.unavailableReason], [[], 'NO_ROUTINES']);

    await withRoutine(user);
    const withItems = await dashboard(user);
    assert.deepEqual(withItems.routines, { routineCount: 1, itemCount: 2 });
    assert.equal(withItems.opportunities.unavailableReason, 'NO_LOCATION');
  });

  test('borrador: próxima compra sin sumar ahorro; en uso y completado suman una sola vez por período', async () => {
    const user = await register(CABALLITO);
    await withRoutine(user);
    const draft = await generate(user);
    const withDraft = await dashboard(user);
    assert.equal(withDraft.nextPurchase.planId, draft.id);
    assert.equal(withDraft.nextPurchase.status, 'DRAFT');
    const firstDay = draft.schedule.find((day) => day.date >= TODAY) ?? draft.schedule[draft.schedule.length - 1];
    assert.equal(withDraft.nextPurchase.date, firstDay.date);
    assert.deepEqual(
      withDraft.nextPurchase.visits.map((visit) => [visit.storeId, visit.subtotal]),
      firstDay.visits.map((visit) => [visit.storeId, visit.subtotal]),
    );
    assert.deepEqual(withDraft.savings.estimated.total, { amount: '0.00', plans: 0 }, 'un borrador no suma');

    await setStatus(user, draft.id, 'ACTIVE');
    const withActive = await dashboard(user);
    assert.equal(withActive.nextPurchase.status, 'ACTIVE');
    const expected = draft.estimatedSavings ?? '0.00';
    assert.deepEqual(withActive.savings.estimated.week, { amount: expected, plans: draft.estimatedSavings ? 1 : 0 });
    assert.deepEqual(withActive.savings.estimated.total, withActive.savings.estimated.week);

    // Otro plan del mismo período, completado: reemplaza al anterior en la cuenta, no se suma.
    await setStatus(user, draft.id, 'COMPLETED');
    const second = await generate(user);
    await setStatus(user, second.id, 'COMPLETED');
    const completed = await dashboard(user);
    assert.equal(completed.savings.estimated.total.plans, second.estimatedSavings ? 1 : 0);
    assert.equal(completed.savings.estimated.total.amount, second.estimatedSavings ?? '0.00');
    assert.equal(completed.savings.registered.available, false, 'completar no registra ahorro real');
    assert.equal(completed.nextPurchase, null, 'sin plan en uso ni borrador vigente');
  });

  test('oportunidades: un precio actual por debajo del mínimo de 30 días de un producto habitual cerca', async () => {
    const user = await register(CABALLITO);
    await withRoutine(user, [{ canonicalProductId: POLLO, quantity: '1', unit: 'KG' }]);
    const before = await dashboard(user);
    assert.equal(before.opportunities.unavailableReason, null);
    assert.ok(before.opportunities.storesConsidered > 0);
    assert.ok(before.opportunities.seriesAnalyzed > 0);
    assert.ok(!before.opportunities.items.some((item) => item.store.id === COTO_CABALLITO && item.classification === 'HISTORIC_LOW'));

    const { rows: [current] } = await pg.query(
      `SELECT "unitPrice"::text AS "unitPrice" FROM "ProductPrice" WHERE "productId" = $1 AND "storeId" = $2 ORDER BY "observedAt" DESC LIMIT 1`,
      [POLLO_GRANEL, COTO_CABALLITO],
    );
    const cheap = (Number(current.unitPrice) / 2).toFixed(2);
    await pg.query(
      `INSERT INTO "ProductPrice" ("id", "productId", "storeId", "price", "unitPrice", "unitPriceUnit", "currency", "source", "idempotencyKey", "observedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $3, 'KG'::"BaseUnit", 'ARS', 'demo-seed', $4, now() - interval '1 minute')`,
      [POLLO_GRANEL, COTO_CABALLITO, cheap, `test-dashboard:${randomUUID()}`],
    );
    const after = await dashboard(user);
    const found = after.opportunities.items.find((item) => item.store.id === COTO_CABALLITO);
    assert.ok(found, JSON.stringify(after.opportunities));
    assert.equal(found.classification, 'HISTORIC_LOW');
    assert.equal(found.canonicalProductId, POLLO);
    assert.equal(found.price, cheap);
    assert.ok(Number(found.ratioToAverage) < 0.6);
    assert.ok(found.store.distanceMeters !== null);
    assert.equal(after.opportunities.items[0].classification, 'HISTORIC_LOW', 'los mínimos van primero');
  });
});
