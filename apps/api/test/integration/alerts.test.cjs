// Alertas de precio y bandeja (P9-01) contra PostgreSQL/PostGIS real. Ejecutar con `npm.cmd run test:db`.
// Usa sucursales y presentaciones propias en Rosario, lejos de las DEMO, y una fuente propia
// (`alertas-test`): ninguna serie del seed dispara estas reglas por casualidad.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { EvaluatePriceAlertsUseCase } = require('../../dist/modules/alerts/application/evaluate-price-alerts.use-case');
const { demoCanonicalProductId, latestObservationAnchor, seedDemoCatalog } = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const SOURCE = 'alertas-test';
const ARROZ = demoCanonicalProductId('arroz-largo-fino');
const ACEITE = demoCanonicalProductId('aceite-girasol');
const ROSARIO = { latitude: '-32.946800', longitude: '-60.639300' };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let app;
let server;
let prisma;
let pg;
let alerts;
const fixtures = {};

async function register(profile = {}) {
  const response = await request(server)
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'tusofertas-web')
    .send({ email: `alertas-${randomUUID()}@example.com`, password: 'private-fixture-password' })
    .expect(201);
  const token = response.body.accessToken;
  const as = (method) => (path) => request(server)[method](path).set('Authorization', `Bearer ${token}`);
  const user = { id: response.body.user.id, get: as('get'), post: as('post'), patch: as('patch'), delete: as('delete') };
  if (Object.keys(profile).length) await user.patch('/api/users/me').send(profile).expect(200);
  return user;
}

const createAlert = (user, body) => user.post('/api/alerts').send({ canonicalProductId: ARROZ, ...body });
const target = (unitPrice, extra = {}) => ({ condition: 'TARGET_PRICE', targetUnitPrice: unitPrice, targetUnit: 'KG', ...extra });

/** Observación de una presentación de 1 kg: el precio del paquete es el precio por kg. */
async function observe(productId, storeId, unitPrice, observedAt) {
  await prisma.productPrice.create({
    data: {
      productId,
      storeId,
      price: unitPrice,
      unitPrice,
      unitPriceUnit: 'KG',
      currency: 'ARS',
      source: SOURCE,
      idempotencyKey: randomUUID(),
      observedAt,
    },
  });
}

const run = (user, now = new Date()) => alerts.run({ now, userId: user.id });
const count = async (sql, params = []) => (await pg.query(sql, params)).rows[0].n;
const notificationsOf = (user) => count('SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = $1', [user.id]);

before(async () => {
  prisma = new PrismaService(url);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  app = await createApp(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars',
      AUTH_RATE_LIMIT_PER_MINUTE: '10000',
      // Sin espera entre avisos: los tests cubren cuándo se repite y cuándo no.
      ALERT_COOLDOWN_HOURS: '0',
    }),
    new JsonLogger(() => {}),
  );
  await app.init();
  server = app.getHttpServer();
  alerts = app.get(EvaluatePriceAlertsUseCase);
  pg = new Client({ connectionString: url });
  await pg.connect();

  const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { id: ARROZ }, select: { categoryId: true } });
  const chain = await prisma.storeChain.findFirstOrThrow({ select: { id: true } });
  const store = (name, latitude, longitude) =>
    prisma.store.create({ data: { chainId: chain.id, name, address: 'Calle de prueba 123', city: 'Rosario', province: 'Santa Fe', latitude, longitude } });
  fixtures.north = (await store('Alertas Norte (TEST)', '-32.946800', '-60.639300')).id;
  fixtures.south = (await store('Alertas Sur (TEST)', '-32.950000', '-60.640000')).id;
  const product = (letter, brand) =>
    prisma.product.create({
      data: {
        name: `Arroz Prueba ${letter} 1 kg`,
        normalizedName: `arroz prueba ${letter.toLowerCase()} 1 kg`,
        brand,
        categoryId: canonical.categoryId,
        canonicalProductId: ARROZ,
        quantity: '1',
        unit: 'KG',
      },
    });
  for (const [key, letter, brand] of [['a', 'A', 'Marca A'], ['b', 'B', 'Marca B'], ['c', 'C', 'Marca C'], ['d', 'D', 'Marca D']]) {
    fixtures[key] = (await product(letter, brand)).id;
  }
});
after(async () => {
  await app?.close();
  await pg?.end();
  await prisma?.$disconnect();
});

describe('alertas de precio (P9-01)', () => {
  test('API: crear, listar, editar, pausar y borrar, con validaciones y dueño', async () => {
    const owner = await register(ROSARIO);
    const other = await register(ROSARIO);
    const created = await createAlert(owner, target('1500')).expect(201);
    assert.equal(created.headers['cache-control'], 'no-store');
    assert.deepEqual(
      [created.body.condition, created.body.target, created.body.product, created.body.allowSubstitutes, created.body.active, created.body.status.lastOutcome],
      ['TARGET_PRICE', { unitPrice: '1500.00', unit: 'KG', currency: 'ARS' }, null, true, true, null],
    );
    assert.equal(created.body.canonicalProduct.defaultUnit, 'KG');

    const error = async (body, status, code) => {
      const response = await createAlert(owner, body).expect(status);
      assert.equal(response.body.error, code, JSON.stringify(response.body));
    };
    await error({ condition: 'TARGET_PRICE' }, 400, 'TARGET_PRICE_REQUIRED');
    await error({ condition: 'HISTORIC_LOW', targetUnitPrice: '1500', targetUnit: 'KG' }, 400, 'TARGET_PRICE_NOT_ALLOWED');
    await error(target('1500', { targetUnit: 'L' }), 400, 'UNIT_DIMENSION_MISMATCH');
    await error(target('1500', { currency: 'USD' }), 400, 'CURRENCY_NOT_SUPPORTED');
    await error(target('1500', { allowSubstitutes: false }), 400, 'PREFERRED_PRODUCT_REQUIRED');
    await error(target('1500', { radiusKm: '0.05' }), 400, 'RADIUS_INVALID');
    await error({ ...target('1500'), canonicalProductId: ACEITE, targetUnit: 'L', productId: fixtures.a }, 400, 'PREFERRED_PRODUCT_INVALID');
    await error({ ...target('1500'), canonicalProductId: randomUUID() }, 400, 'CANONICAL_NOT_FOUND');
    await error({ ...target('1500'), userId: other.id }, 400, 'VALIDATION_FAILED');
    await request(server).get('/api/alerts').expect(401);

    const id = created.body.id;
    const paused = await owner.patch(`/api/alerts/${id}`).send({ active: false }).expect(200);
    assert.equal(paused.body.active, false);
    const wrong = await owner.patch(`/api/alerts/${id}`).send({ condition: 'GOOD_DEAL' }).expect(400);
    assert.equal(wrong.body.error, 'TARGET_PRICE_NOT_ALLOWED', 'las reglas se evalúan sobre el resultado');
    const switched = await owner.patch(`/api/alerts/${id}`).send({ condition: 'GOOD_DEAL', targetUnitPrice: null, targetUnit: null, excludedBrands: [' marca b ', 'MARCA B'] }).expect(200);
    assert.deepEqual([switched.body.condition, switched.body.target, switched.body.excludedBrands], ['GOOD_DEAL', null, ['marca b']]);

    await other.patch(`/api/alerts/${id}`).send({ active: true }).expect(404);
    await other.delete(`/api/alerts/${id}`).expect(404);
    assert.deepEqual((await other.get('/api/alerts').expect(200)).body.items, []);
    const listed = (await owner.get('/api/alerts').expect(200)).body;
    assert.deepEqual([listed.items.length, listed.limit], [1, 20]);
    await owner.get('/api/alerts/no-es-uuid').expect(404);
    await owner.patch('/api/alerts/no-es-uuid').send({ active: true }).expect(400);

    await owner.delete(`/api/alerts/${id}`).expect(204);
    await owner.delete(`/api/alerts/${id}`).expect(404);

    for (let index = 0; index < 20; index += 1) await createAlert(other, target(String(1000 + index))).expect(201);
    const full = await createAlert(other, target('999')).expect(409);
    assert.equal(full.body.error, 'ALERT_LIMIT');
  });

  test('cruce de umbral: avisa una vez, no repite y vuelve a avisar si se cumple de nuevo', async () => {
    const user = await register({ ...ROSARIO, maxTravelDistanceKm: '2' });
    fixtures.thresholdUser = user;
    const alert = (await createAlert(user, target('1500')).expect(201)).body;
    const now = Date.now();
    await observe(fixtures.a, fixtures.north, '1600.00', new Date(now - 4 * HOUR));
    assert.deepEqual((await run(user)).outcomes, { NO_MATCH: 1 });

    await observe(fixtures.a, fixtures.north, '1450.00', new Date(now - 3 * HOUR));
    const first = await run(user);
    assert.deepEqual([first.notified, first.outcomes], [1, { NOTIFIED: 1 }]);
    const [notification] = (await user.get('/api/notifications').expect(200)).body.items;
    assert.equal(notification.title, 'Arroz largo fino llegó a tu precio objetivo');
    assert.match(notification.message, /^Arroz Prueba A 1 kg a \$ 1\.450,00 \(\$ 1\.450,00 por kg\) en Alertas Norte \(TEST\), precio visto el \d{2}\/\d{2} \(fuente alertas-test\)\. Tu objetivo: \$ 1\.500,00 por kg\.$/);
    assert.deepEqual(
      [notification.kind, notification.ruleId, notification.link, notification.readAt, notification.data.source, notification.data.isAlternative, notification.data.store.id],
      ['PRICE_ALERT', alert.id, `/producto/${fixtures.a}`, null, SOURCE, false, fixtures.north],
    );
    assert.ok(notification.data.store.distanceMeters < 100, 'distancia desde la ubicación de la persona');
    const status = (await user.get('/api/alerts').expect(200)).body.items[0].status;
    assert.equal(status.lastOutcome, 'NOTIFIED');
    assert.ok(status.lastNotifiedAt && status.lastEvaluatedAt);

    assert.deepEqual((await run(user)).outcomes, { ALREADY_NOTIFIED: 1 }, 'el mismo precio no se repite');
    await observe(fixtures.a, fixtures.north, '1700.00', new Date(now - 2 * HOUR));
    assert.deepEqual((await run(user)).outcomes, { NO_MATCH: 1 }, 'dejó de cumplirse');
    await observe(fixtures.a, fixtures.north, '1400.00', new Date(now - HOUR));
    assert.deepEqual((await run(user)).outcomes, { NOTIFIED: 1 }, 'se cumple de nuevo');
    assert.equal(await notificationsOf(user), 2);
  });

  test('nuevo mínimo del mes con historial suficiente; con pocos datos no avisa', async () => {
    const now = Date.now();
    const day = (offset) => new Date(Math.floor((now - offset * DAY) / DAY) * DAY + 12 * HOUR);
    for (let offset = 12; offset >= 1; offset -= 1) await observe(fixtures.b, fixtures.south, '2000.00', day(offset));
    await observe(fixtures.b, fixtures.south, '1500.00', new Date(now - HOUR));
    for (let offset = 3; offset >= 1; offset -= 1) await observe(fixtures.c, fixtures.south, '1800.00', day(offset));
    await observe(fixtures.c, fixtures.south, '1300.00', new Date(now - HOUR));

    const lowUser = await register(ROSARIO);
    fixtures.lowUser = lowUser;
    await createAlert(lowUser, { condition: 'HISTORIC_LOW', productId: fixtures.b, allowSubstitutes: false }).expect(201);
    assert.deepEqual((await run(lowUser)).outcomes, { NOTIFIED: 1 });
    const [notification] = (await lowUser.get('/api/notifications').expect(200)).body.items;
    assert.match(notification.title, /precio más bajo del último mes/);
    assert.deepEqual([notification.data.analysis.classification, notification.data.analysis.average], ['HISTORIC_LOW', '2000.000000']);

    const fewUser = await register(ROSARIO);
    await createAlert(fewUser, { condition: 'GOOD_DEAL', productId: fixtures.c, allowSubstitutes: false }).expect(201);
    assert.deepEqual((await run(fewUser)).outcomes, { INSUFFICIENT_DATA: 1 }, 'cuatro días no alcanzan para llamarlo oferta');
    assert.equal(await notificationsOf(fewUser), 0);
  });

  test('precio viejo y sustitutos: sin reemplazos no avisa por otra presentación; con reemplazos lo dice', async () => {
    await observe(fixtures.d, fixtures.north, '900.00', new Date(Date.now() - 10 * DAY));
    const user = await register(ROSARIO);
    const alert = (await createAlert(user, target('1500', { productId: fixtures.d, allowSubstitutes: false })).expect(201)).body;
    assert.deepEqual((await run(user)).outcomes, { NO_FRESH_PRICES: 1 }, 'D solo tiene un precio vencido y A (más barato) no está permitido');

    await user.patch(`/api/alerts/${alert.id}`).send({ allowSubstitutes: true, excludedBrands: ['Marca A', 'Marca B', 'Marca C'] }).expect(200);
    assert.deepEqual((await run(user)).outcomes, { NO_FRESH_PRICES: 1 }, 'las marcas excluidas no cuentan');
    await user.patch(`/api/alerts/${alert.id}`).send({ excludedBrands: ['Marca B'] }).expect(200);
    assert.deepEqual((await run(user)).outcomes, { NOTIFIED: 1 });
    const [notification] = (await user.get('/api/notifications').expect(200)).body.items;
    assert.equal(notification.data.product.id, fixtures.c, 'la más barata permitida: C a 1300 (B excluida)');
    assert.equal(notification.data.isAlternative, true);
    assert.match(notification.message, /Es una alternativa a Arroz Prueba D 1 kg\.$/);
  });

  test('regla pausada, editada o borrada entre la evaluación y el aviso: no avisa', async () => {
    const user = await register(ROSARIO);
    const alert = (await createAlert(user, target('1500', { active: false })).expect(201)).body;
    assert.deepEqual(await run(user), { users: 0, rules: 0, notified: 0, outcomes: {} }, 'una regla pausada no se evalúa');

    await user.patch(`/api/alerts/${alert.id}`).send({ active: true }).expect(200);
    let [pending] = await alerts.evaluateUser(user.id, new Date());
    assert.equal(pending.evaluation.kind, 'MATCH');
    await user.patch(`/api/alerts/${alert.id}`).send({ active: false }).expect(200);
    assert.equal(await alerts.apply(pending, new Date()), 'PAUSED', 'se relee el estado vigente antes de avisar');

    await user.patch(`/api/alerts/${alert.id}`).send({ active: true }).expect(200);
    [pending] = await alerts.evaluateUser(user.id, new Date());
    await user.patch(`/api/alerts/${alert.id}`).send({ targetUnitPrice: '1000' }).expect(200);
    assert.equal(await alerts.apply(pending, new Date()), 'RULE_CHANGED', 'se evaluó con el objetivo viejo');

    [pending] = await alerts.evaluateUser(user.id, new Date());
    await user.delete(`/api/alerts/${alert.id}`).expect(204);
    assert.equal(await alerts.apply(pending, new Date()), 'RULE_DELETED');
    assert.equal(await notificationsOf(user), 0);
  });

  test('job duplicado y dos procesos a la vez: un solo aviso', async () => {
    const user = await register(ROSARIO);
    await createAlert(user, target('1500')).expect(201);
    const results = await Promise.all([run(user), run(user), run(user)]);
    assert.equal(results.reduce((total, result) => total + result.notified, 0), 1);
    assert.equal(await notificationsOf(user), 1);

    // Aun si dos procesos deciden avisar con el mismo estado, la observación es única por regla.
    const second = await register(ROSARIO);
    await createAlert(second, target('1500')).expect(201);
    const [pending] = await alerts.evaluateUser(second.id, new Date());
    const outcomes = await Promise.all([alerts.apply(pending, new Date()), alerts.apply(pending, new Date())]);
    assert.deepEqual(outcomes.sort(), ['ALREADY_NOTIFIED', 'NOTIFIED']);
    assert.equal(await notificationsOf(second), 1);
    // Sin el estado de la regla (por ejemplo, borrado a mano), el índice único igual lo frena.
    await pg.query('UPDATE "PriceAlertRule" SET "notifiedUnitPrice" = NULL WHERE "userId" = $1', [second.id]);
    assert.equal(await alerts.apply(pending, new Date()), 'ALREADY_NOTIFIED');
    assert.equal(await notificationsOf(second), 1);
  });

  test('bandeja: cada persona ve lo suyo, pagina, filtra no leídos y marca leído', async () => {
    const owner = fixtures.thresholdUser;
    const stranger = fixtures.lowUser;
    const page = (await owner.get('/api/notifications?limit=1').expect(200)).body;
    assert.deepEqual([page.items.length, page.unreadCount, page.page.limit], [1, 2, 1]);
    assert.ok(page.page.nextCursor);
    const next = (await owner.get(`/api/notifications?limit=1&cursor=${page.page.nextCursor}`).expect(200)).body;
    assert.equal(next.items.length, 1);
    assert.notEqual(next.items[0].id, page.items[0].id);
    assert.equal(next.page.nextCursor, null);
    await owner.get('/api/notifications?cursor=no-es-un-cursor').expect(400);
    await owner.get('/api/notifications?unread=quizas').expect(400);

    const id = page.items[0].id;
    await stranger.patch(`/api/notifications/${id}/read`).expect(404);
    assert.ok(!(await stranger.get('/api/notifications').expect(200)).body.items.some((item) => item.id === id));
    const read = (await owner.patch(`/api/notifications/${id}/read`).expect(200)).body;
    assert.ok(read.readAt);
    const again = (await owner.patch(`/api/notifications/${id}/read`).expect(200)).body;
    assert.equal(again.readAt, read.readAt, 'marcar dos veces conserva la primera lectura');
    const unread = (await owner.get('/api/notifications?unread=true').expect(200)).body;
    assert.deepEqual([unread.items.length, unread.unreadCount], [1, 1]);

    const [rule] = (await owner.get('/api/alerts').expect(200)).body.items;
    await owner.delete(`/api/alerts/${rule.id}`).expect(204);
    const kept = (await owner.get('/api/notifications').expect(200)).body.items;
    assert.equal(kept.length, 2, 'borrar la alerta no borra sus avisos');
    assert.ok(kept.every((item) => item.ruleId === null));
  });

  test('sin ubicación o sin sucursales en el radio: no avisa y lo informa', async () => {
    const nowhere = await register();
    await createAlert(nowhere, target('1500')).expect(201);
    assert.deepEqual((await run(nowhere)).outcomes, { NO_LOCATION: 1 });
    const far = await register({ latitude: '-54.801900', longitude: '-68.303000', maxTravelDistanceKm: '1' });
    await createAlert(far, target('1500')).expect(201);
    assert.deepEqual((await run(far)).outcomes, { NO_STORES_IN_SCOPE: 1 });
    assert.equal((await far.get('/api/alerts').expect(200)).body.items[0].status.lastOutcome, 'NO_STORES_IN_SCOPE');
  });
});
