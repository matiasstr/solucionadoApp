// Planes guardados (P5-03) contra PostgreSQL/PostGIS real: generación idempotente,
// lectura, ownership, snapshot estable y estados. Ejecutar con `npm.cmd run test:db`.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { DecimalValue } = require('../../dist/modules/catalog/domain/decimal');
const { argentineIsoWeekday } = require('../../dist/modules/promotions/domain/promotion-eligibility');
const { argentineToday } = require('../../dist/modules/routines/domain/routine-rules');
const { addDays, argentineNoon } = require('../../dist/modules/shopping-plans/domain/plan-calendar');
const {
  latestObservationAnchor,
  seedDemoCatalog,
  demoCanonicalProductId,
  demoProductId,
  demoPromotionId,
} = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const POLLO = demoCanonicalProductId('pollo-entero');
const ARROZ = demoCanonicalProductId('arroz-largo-fino');
const LECHE = demoCanonicalProductId('leche-entera');
const ARROZ_PAMPA_1KG = demoProductId('arroz-pampa-1kg');
const CABALLITO = { latitude: '-34.6187', longitude: '-58.4407' };
const TODAY = argentineToday(new Date());

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
    .send({ email: `planes${Date.now()}${counter++}@example.com`, password: 'private-fixture-password' })
    .expect(201);
  const token = response.body.accessToken;
  const as = (method) => (path) => request(server)[method](path).set('Authorization', `Bearer ${token}`);
  const user = { id: response.body.user.id, get: as('get'), post: as('post'), patch: as('patch'), put: as('put') };
  if (Object.keys(profile).length) await user.patch('/api/users/me').send(profile).expect(200);
  return user;
}
async function withBasket(profile = CABALLITO) {
  const user = await register(profile);
  const routine = await user.post('/api/shopping-routines').send({ name: 'Compra semanal', frequencyDays: 7, anchorDate: TODAY }).expect(201);
  const add = (body) => user.post(`/api/shopping-routines/${routine.body.id}/items`).send(body).expect(201);
  await add({ canonicalProductId: POLLO, quantity: '3', unit: 'KG' });
  await add({ canonicalProductId: ARROZ, quantity: '2', unit: 'KG', preferredProductId: ARROZ_PAMPA_1KG, allowSubstitutes: false });
  await add({ canonicalProductId: LECHE, quantity: '4', unit: 'L' });
  await user.post('/api/inventory').send({ canonicalProductId: POLLO, quantity: '1', unit: 'KG' }).expect(201);
  return user;
}
const generate = (user, key = randomUUID(), body = {}) =>
  user.post('/api/shopping-plans/generate').set('Idempotency-Key', key).send(body);
async function expectError(promise, status, error, fields) {
  const response = await promise.expect(status);
  assert.equal(response.body.error, error, JSON.stringify(response.body));
  if (fields) assert.deepEqual(response.body.fields, fields);
  return response.body;
}
const sum = (values) => values.reduce((total, value) => total.add(DecimalValue.parse(value)), DecimalValue.zero(2)).toFixed(2);

describe('sesión obligatoria', () => {
  test('sin token los cuatro endpoints responden 401', async () => {
    const id = randomUUID();
    for (const call of [
      () => request(server).post('/api/shopping-plans/generate').set('Idempotency-Key', randomUUID()).send({}),
      () => request(server).get('/api/shopping-plans'),
      () => request(server).get(`/api/shopping-plans/${id}`),
      () => request(server).patch(`/api/shopping-plans/${id}`).send({ status: 'ACTIVE' }),
    ]) {
      await expectError(call(), 401, 'UNAUTHORIZED');
    }
  });
});

describe('generación', () => {
  test('genera y guarda un plan explicable: cronograma por día y sucursal, totales y ahorro estimado', async () => {
    const user = await withBasket();
    const inventoryBefore = (await user.get('/api/inventory').expect(200)).body;
    const response = await generate(user).expect(201);
    assert.equal(response.headers['cache-control'], 'no-store');
    const plan = response.body;
    assert.equal(plan.status, 'DRAFT');
    assert.equal(plan.coverage, 'COMPLETE');
    assert.equal(plan.method, 'EXACT_BOUNDED');
    assert.equal(plan.startDate, TODAY);
    assert.equal(plan.endDate, addDays(TODAY, 6));
    assert.equal(plan.baselineMethod, 'SINGLE_STORE_REGULAR_PRICES');
    assert.equal(plan.location.origin, 'COORDINATES');

    const lines = plan.schedule.flatMap((day) => day.visits.flatMap((visit) => visit.lines));
    assert.equal(plan.lineCount, 3);
    assert.deepEqual(lines.map((line) => line.canonicalProductId).sort(), [ARROZ, LECHE, POLLO].sort());
    const pollo = lines.find((line) => line.canonicalProductId === POLLO);
    assert.deepEqual([pollo.neededQuantity, pollo.quantity, pollo.packageCount, pollo.quantityIsEstimate], ['2', '2', null, true], '3 kg − 1 kg de despensa');
    const arroz = lines.find((line) => line.canonicalProductId === ARROZ);
    assert.deepEqual([arroz.productId, arroz.matchType, arroz.packageCount], [ARROZ_PAMPA_1KG, 'EXACT', 2]);
    assert.ok(arroz.reasonCodes.includes('EXACT_PRODUCT_REQUIRED'));
    for (const line of lines) {
      assert.ok(line.reason.length > 0);
      assert.equal(line.priceSource, 'demo-seed');
      assert.ok(DecimalValue.parse(line.quantity).compare(DecimalValue.parse(line.neededQuantity)) >= 0);
    }
    for (const day of plan.schedule) {
      for (const visit of day.visits) assert.equal(visit.subtotal, sum(visit.lines.map((line) => line.price)));
    }
    assert.equal(plan.totals.productCost, sum(lines.map((line) => line.price)));
    assert.equal(plan.optimizedCost, plan.totals.productCost);
    assert.equal(plan.effectiveCost, plan.totals.effectiveCost);
    assert.ok(plan.totals.storeCount <= 2);
    assert.equal(plan.estimatedSavings, plan.savings.estimatedSavings);
    assert.ok(!DecimalValue.parse(plan.estimatedSavings).isNegative());
    assert.ok(plan.prices.oldestObservedAt <= plan.prices.newestObservedAt);
    assert.deepEqual(plan.needs.find((entry) => entry.canonicalProductId === POLLO).inventorySubtracted, '1');

    // Generar no consume la despensa.
    assert.deepEqual((await user.get('/api/inventory').expect(200)).body, inventoryBefore);
    const stored = await pg.query('SELECT count(*)::int AS n FROM "ShoppingPlanItem" WHERE "shoppingPlanId" = $1', [plan.id]);
    assert.equal(stored.rows[0].n, 3);
  });

  test('reintento con la misma clave devuelve el mismo plan (200) sin duplicar; la clave es obligatoria', async () => {
    const user = await withBasket();
    const key = randomUUID();
    const first = await generate(user, key).expect(201);
    const retry = await generate(user, key).expect(200);
    assert.equal(retry.body.id, first.body.id);
    assert.deepEqual(retry.body, first.body);

    await expectError(user.post('/api/shopping-plans/generate').send({}), 400, 'IDEMPOTENCY_KEY_REQUIRED', ['Idempotency-Key']);
    await expectError(generate(user, 'corta'), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    await expectError(generate(user, 'con espacios no'), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    await expectError(generate(user, key, { startDate: addDays(TODAY, 1) }), 409, 'IDEMPOTENCY_KEY_REUSED');

    // Pedidos simultáneos con la misma clave: uno crea y los demás devuelven ese plan.
    const concurrentKey = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => generate(user, concurrentKey)));
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 200, 201]);
    assert.equal(new Set(results.map((response) => response.body.id)).size, 1);
    const plans = await pg.query('SELECT count(*)::int AS n FROM "ShoppingPlan" WHERE "userId" = $1', [user.id]);
    assert.equal(plans.rows[0].n, 2);
  });

  test('ventana: validación del cuerpo y del dominio', async () => {
    const user = await withBasket();
    await expectError(generate(user, randomUUID(), { startDate: '30/09/2026' }), 400, 'VALIDATION_FAILED');
    await expectError(generate(user, randomUUID(), { startDate: null }), 400, 'VALIDATION_FAILED');
    await expectError(generate(user, randomUUID(), { startDate: TODAY, userId: randomUUID() }), 400, 'VALIDATION_FAILED');
    await expectError(generate(user, randomUUID(), { startDate: '2026-02-30' }), 400, 'PLAN_WINDOW_INVALID', ['startDate']);
    await expectError(
      generate(user, randomUUID(), { startDate: TODAY, endDate: addDays(TODAY, 40) }),
      400,
      'PLAN_WINDOW_TOO_LONG',
    );
    const twoWeeks = await generate(user, randomUUID(), { startDate: TODAY, endDate: addDays(TODAY, 13) }).expect(201);
    assert.equal(twoWeeks.body.endDate, addDays(TODAY, 13));
  });

  test('sin ubicación el plan se guarda como parcial, explícito y sin ahorro', async () => {
    const user = await withBasket({});
    const plan = (await generate(user).expect(201)).body;
    assert.deepEqual([plan.coverage, plan.lineCount, plan.schedule, plan.savings, plan.estimatedSavings], ['PARTIAL', 0, [], null, null]);
    assert.deepEqual(plan.unfulfilled.map((entry) => entry.reason), ['NO_LOCATION', 'NO_LOCATION', 'NO_LOCATION']);
    assert.ok(plan.warnings.some((warning) => warning.code === 'LOCATION_MISSING'));
    assert.equal(plan.baselineMethod, 'NONE');
  });

  test('las promociones aplicadas valen en la fecha recomendada', async () => {
    const user = await withBasket();
    const plan = (await generate(user).expect(201)).body;
    const promoted = plan.schedule.flatMap((day) => day.visits.flatMap((visit) => visit.lines.map((line) => ({ day: day.date, line }))))
      .filter(({ line }) => line.promotion);
    for (const { day, line } of promoted) {
      const { rows: [promotion] } = await pg.query(
        'SELECT "validFrom", "validUntil", "eligibleWeekdays" FROM "Promotion" WHERE "id" = $1',
        [line.promotion.id],
      );
      const instant = argentineNoon(day);
      assert.ok(promotion.validFrom <= instant && instant < promotion.validUntil, `${line.promotion.name} vigente el ${day}`);
      if (promotion.eligibleWeekdays.length) assert.ok(promotion.eligibleWeekdays.includes(argentineIsoWeekday(instant)));
    }
  });
});

describe('lectura y ownership', () => {
  test('listar y leer solo lo propio; lo ajeno responde igual que lo inexistente', async () => {
    const owner = await withBasket();
    const other = await withBasket();
    const mine = (await generate(owner).expect(201)).body;
    const theirs = (await generate(other).expect(201)).body;

    const list = await owner.get('/api/shopping-plans').expect(200);
    assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual(list.body.items.map((entry) => entry.id), [mine.id]);
    assert.deepEqual(Object.keys(list.body.items[0]).sort(), [
      'completedAt', 'coverage', 'effectiveCost', 'endDate', 'estimatedSavings', 'generatedAt', 'id', 'lineCount',
      'optimizedCost', 'refundEstimated', 'startDate', 'status', 'unfulfilledCount', 'visitCount',
    ]);
    assert.deepEqual((await owner.get(`/api/shopping-plans/${mine.id}`).expect(200)).body, mine);

    const missing = await expectError(owner.get(`/api/shopping-plans/${randomUUID()}`), 404, 'NOT_FOUND');
    const foreign = await expectError(owner.get(`/api/shopping-plans/${theirs.id}`), 404, 'NOT_FOUND');
    assert.deepEqual(foreign, missing);
    await expectError(owner.patch(`/api/shopping-plans/${theirs.id}`).send({ status: 'ACTIVE' }), 404, 'NOT_FOUND');
    await expectError(owner.get('/api/shopping-plans/no-es-uuid'), 400, 'VALIDATION_FAILED', ['id']);
    await expectError(owner.get('/api/shopping-plans?limit=0'), 400, 'VALIDATION_FAILED');
    const { rows } = await pg.query('SELECT "status" FROM "ShoppingPlan" WHERE "id" = $1', [theirs.id]);
    assert.equal(rows[0].status, 'DRAFT');
  });
});

describe('estados', () => {
  test('activar, completar y reintentar; un solo plan activo por período; transiciones inválidas y vencidos', async () => {
    const user = await withBasket();
    const first = (await generate(user).expect(201)).body;
    const second = (await generate(user).expect(201)).body;

    const active = await user.patch(`/api/shopping-plans/${first.id}`).send({ status: 'ACTIVE' }).expect(200);
    assert.equal(active.body.status, 'ACTIVE');
    await user.patch(`/api/shopping-plans/${second.id}`).send({ status: 'ACTIVE' }).expect(200);
    assert.equal((await user.get(`/api/shopping-plans/${first.id}`).expect(200)).body.status, 'DRAFT', 'el anterior vuelve a borrador');

    const completed = await user.patch(`/api/shopping-plans/${second.id}`).send({ status: 'COMPLETED' }).expect(200);
    assert.equal(completed.body.status, 'COMPLETED');
    assert.ok(completed.body.completedAt);
    const again = await user.patch(`/api/shopping-plans/${second.id}`).send({ status: 'COMPLETED' }).expect(200);
    assert.equal(again.body.completedAt, completed.body.completedAt, 'el reintento no cambia la fecha');
    await expectError(user.patch(`/api/shopping-plans/${second.id}`).send({ status: 'ACTIVE' }), 400, 'PLAN_STATUS_TRANSITION_INVALID', ['status']);
    await expectError(user.patch(`/api/shopping-plans/${first.id}`).send({ status: 'EXPIRED' }), 400, 'VALIDATION_FAILED');
    await expectError(user.patch(`/api/shopping-plans/${first.id}`).send({ status: 'DRAFT' }), 400, 'VALIDATION_FAILED');

    const past = (await generate(user, randomUUID(), { startDate: addDays(TODAY, -10), endDate: addDays(TODAY, -4) }).expect(201)).body;
    assert.equal(past.status, 'EXPIRED');
    await expectError(user.patch(`/api/shopping-plans/${past.id}`).send({ status: 'ACTIVE' }), 400, 'PLAN_EXPIRED');
  });
});

describe('beneficios de pago (P10-02)', () => {
  /** Importes del plan que cierran entre sí: caja, reintegro, visitas y ahorro sin reintegros. */
  function assertPlanAmounts(plan) {
    const { totals } = plan;
    const minus = (a, b) => DecimalValue.parse(a).subtract(DecimalValue.parse(b)).toFixed(2);
    const visits = plan.schedule.flatMap((day) => day.visits);
    assert.equal(totals.payToday, minus(totals.productCost, totals.paymentDiscount));
    assert.equal(totals.costAfterRefund, minus(totals.payToday, totals.refundEstimated));
    assert.equal(sum(visits.map((visit) => visit.payToday)), totals.payToday);
    assert.equal(sum(visits.map((visit) => visit.refundEstimated)), totals.refundEstimated);
    assert.equal(plan.optimizedCost, totals.payToday, 'lo guardado es lo que se paga en las cajas');
    assert.equal(plan.refundEstimated, totals.refundEstimated);
    if (plan.savings) assert.equal(plan.savings.estimatedSavings, minus(plan.savings.baselineProductCost, totals.payToday), 'el ahorro no incluye reintegros');
  }

  test('sin medios declarados: el plan informa criterios, no suma beneficios condicionados', async () => {
    const user = await withBasket();
    const plan = (await generate(user).expect(201)).body;
    assert.ok(plan.benefits, 'los planes nuevos dicen con qué se evaluaron los beneficios');
    assert.equal(plan.benefits.payer.declared, false);
    assert.ok(plan.benefits.criteria.length >= 3);
    assert.ok(['NOT_NEEDED', 'EXHAUSTIVE', 'LOCAL_SEARCH'].includes(plan.benefits.basketSearch));
    assert.equal(plan.totals.paymentDiscount, '0.00');
    assert.equal(plan.totals.refundEstimated, '0.00');
    assertPlanAmounts(plan);
    const notes = plan.schedule.flatMap((day) => day.visits.flatMap((visit) => visit.benefitNotes));
    for (const note of notes.filter((entry) => entry.layer === 'PAYMENT')) {
      assert.notEqual(note.status, 'APPLIED');
      assert.ok(note.conditions.timing === 'IMMEDIATE' || note.conditions.timing === 'REFUND');
    }
  });

  test('con débito del Banco Demo y el tope informado: nunca peor que sin declarar y se guarda cumpliendo los CHECK', async () => {
    const plain = (await generate(await withBasket()).expect(201)).body;
    const user = await withBasket({ ...CABALLITO, paymentMethods: ['DEBIT_CARD', 'CREDIT_CARD', 'WALLET'], banks: ['Banco Demo', 'Billetera Demo'] });
    await user.put(`/api/benefit-usage/${demoPromotionId('vea-banco-demo-20')}`).send({ consumed: '0.00' }).expect(200);
    const plan = (await generate(user).expect(201)).body;
    assert.equal(plan.benefits.payer.declared, true);
    assert.deepEqual(plan.benefits.payer.banks, ['Banco Demo', 'Billetera Demo']);
    assertPlanAmounts(plan);
    assert.ok(
      DecimalValue.parse(plan.totals.effectiveCostAfterRefund).compare(DecimalValue.parse(plain.totals.effectiveCostAfterRefund)) <= 0,
      'declarar medios de pago nunca empeora el plan',
    );
    for (const visit of plan.schedule.flatMap((day) => day.visits)) {
      if (!visit.payment) continue;
      assert.ok(visit.payment.conditions.bank, 'un pago aplicado muestra su banco');
      assert.equal(visit.payment.timing === 'IMMEDIATE' ? visit.paymentDiscount : visit.refundEstimated, visit.payment.amount);
    }
    const reread = (await user.get(`/api/shopping-plans/${plan.id}`).expect(200)).body;
    assert.deepEqual(reread, plan);
  });

  test('un plan guardado antes de P10-02 (snapshot versión 1) se lee como se emitió, sin recalcular', async () => {
    const user = await withBasket();
    const plan = (await generate(user).expect(201)).body;
    // Lo que guardaba P5-03: sin campos de pago en totales ni visitas y sin resumen de beneficios.
    await pg.query(
      `UPDATE "ShoppingPlan" SET "resultSnapshot" = jsonb_set(
         ("resultSnapshot" - 'benefits')
           || jsonb_build_object('totals', ("resultSnapshot"->'totals') - 'paymentDiscount' - 'payToday' - 'refundEstimated' - 'costAfterRefund' - 'conditionalAmount' - 'effectiveCostAfterRefund'),
         '{schemaVersion}', '1')
       WHERE "id" = $1`,
      [plan.id],
    );
    await pg.query(
      `UPDATE "ShoppingPlan" SET "resultSnapshot" = jsonb_set("resultSnapshot", '{visits}', (
         SELECT jsonb_agg(visit - 'paymentDiscount' - 'payToday' - 'refundEstimated' - 'payment' - 'benefitNotes')
         FROM jsonb_array_elements("resultSnapshot"->'visits') AS visit)) WHERE "id" = $1`,
      [plan.id],
    );
    const old = (await user.get(`/api/shopping-plans/${plan.id}`).expect(200)).body;
    assert.equal(old.benefits, null);
    assert.equal(old.refundEstimated, null);
    assert.equal(old.totals.payToday, old.totals.productCost);
    assert.equal(old.totals.refundEstimated, '0.00');
    for (const visit of old.schedule.flatMap((day) => day.visits)) {
      assert.deepEqual([visit.payToday, visit.payment, visit.benefitNotes], [visit.subtotal, null, []]);
    }
    const list = (await user.get('/api/shopping-plans').expect(200)).body;
    assert.equal(list.items.find((item) => item.id === plan.id).refundEstimated, null);
  });
});

describe('snapshot', () => {
  // Último del archivo: agrega una observación de precio a la base compartida.
  test('un precio nuevo no reescribe un plan ya emitido', async () => {
    const user = await withBasket();
    const plan = (await generate(user).expect(201)).body;
    const line = plan.schedule[0].visits[0].lines[0];
    const store = plan.schedule[0].visits[0].storeId;
    await pg.query(
      `INSERT INTO "ProductPrice" ("id", "productId", "storeId", "price", "unitPrice", "unitPriceUnit", "currency", "source", "idempotencyKey", "observedAt")
       VALUES (gen_random_uuid(), $1, $2, 999999.00, 999999.000000, $3::"BaseUnit", 'ARS', 'test-snapshot', $4, now())`,
      [line.productId, store, line.unit, randomUUID()],
    );
    const reread = (await user.get(`/api/shopping-plans/${plan.id}`).expect(200)).body;
    assert.deepEqual(reread, plan);
  });
});
