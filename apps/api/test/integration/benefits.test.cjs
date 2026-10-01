// Beneficios de pago (P10-01) contra PostgreSQL/PostGIS real. Ejecutar con `npm.cmd run test:db`.
// Usa el dataset DEMO y sus promociones de pago (reintegro de Coto los miércoles y 20 % de Vea con
// tope mensual compartido del Banco Demo, $1.500 con Billetera Demo en Jumbo, 25 % de Carrefour).
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { PromotionImporter } = require('../../dist/modules/imports/application/promotion-importer');
const { PrismaImportGateway } = require('../../dist/modules/imports/infrastructure/prisma-import.gateway');
const { argentineToday } = require('../../dist/modules/routines/domain/routine-rules');
const { addDays } = require('../../dist/modules/shopping-plans/domain/plan-calendar');
const { demoPromotionId, demoStoreId, latestObservationAnchor, seedDemoCatalog } = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const COTO_REFUND = demoPromotionId('coto-banco-reintegro-miercoles');
const VEA_20 = demoPromotionId('vea-banco-demo-20');
const JUMBO_WALLET = demoPromotionId('jumbo-billetera-1500');
const CARREFOUR_25 = demoPromotionId('carrefour-banco-25');
const TODAY = argentineToday(new Date());
/** Próximo día de la semana ISO (1 = lunes) desde hoy, en el calendario argentino. */
function next(isoWeekday, from = TODAY) {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(from, offset);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    if (day === isoWeekday) return date;
  }
  throw new Error('sin día');
}
const WEDNESDAY = next(3);
const THURSDAY = next(4, WEDNESDAY);

let app;
let server;
let prisma;
let pg;

async function register(profile = {}) {
  const response = await request(server)
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'tusofertas-web')
    .send({ email: `beneficios-${randomUUID()}@example.com`, password: 'private-fixture-password' })
    .expect(201);
  const token = response.body.accessToken;
  const as = (method) => (path) => request(server)[method](path).set('Authorization', `Bearer ${token}`);
  const user = { id: response.body.user.id, get: as('get'), post: as('post'), put: as('put'), patch: as('patch'), delete: as('delete') };
  if (Object.keys(profile).length) await user.patch('/api/users/me').send(profile).expect(200);
  return user;
}

/** Productos envasados con precio reciente en esa sucursal (los primeros por id), con su precio. */
async function pricedProducts(storeKey, count = 2) {
  const { rows } = await pg.query(
    `SELECT DISTINCT ON (pp."productId") pp."productId"::text AS id, pp."price"::text AS price
     FROM "ProductPrice" pp JOIN "Product" p ON p."id" = pp."productId"
     WHERE pp."storeId" = $1 AND p."saleMode" = 'PACKAGED' AND p."isActive" AND pp."observedAt" > now() - interval '3 days'
     ORDER BY pp."productId", pp."observedAt" DESC`,
    [demoStoreId(storeKey)],
  );
  // Sin los productos con promociones de producto DEMO, para que la base del pago sea clara.
  const withPromotion = new Set((await pg.query('SELECT "productId"::text AS id FROM "Promotion" WHERE "productId" IS NOT NULL')).rows.map((row) => row.id));
  const usable = rows.filter((row) => !withPromotion.has(row.id)).slice(0, count);
  assert.equal(usable.length, count, `hay ${count} productos con precio en ${storeKey}`);
  return usable;
}

const evaluate = (user, purchases) => user.post('/api/benefits/evaluate').send({ purchases });
const evaluationOf = (body, promotionId) => body.result.evaluations.find((evaluation) => evaluation.promotionId === promotionId);
const cents = (amount) => Math.round(Number(amount) * 100);

before(async () => {
  prisma = new PrismaService(url);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  app = await createApp(
    validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars', AUTH_RATE_LIMIT_PER_MINUTE: '10000' }),
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

describe('beneficios de pago (P10-01)', () => {
  test('la base rechaza beneficios mal formados', async () => {
    const chain = (await pg.query(`SELECT "chainId"::text AS id FROM "Store" WHERE "id" = $1`, [demoStoreId('coto-caballito')])).rows[0].id;
    const insert = (fields) =>
      pg.query(
        `INSERT INTO "Promotion" ("id", "name", "type", "chainId", "source", "validFrom", "validUntil", "updatedAt", ${Object.keys(fields).map((key) => `"${key}"`).join(', ')})
         VALUES (gen_random_uuid(), 'x', 'BANK_DISCOUNT', $1, 'test', now(), now() + interval '1 day', now(), ${Object.keys(fields).map((_, index) => `$${index + 2}`).join(', ')})`,
        [chain, ...Object.values(fields)],
      );
    await assert.rejects(insert({ bank: 'B', discountPercentage: 10, discountAmount: 100 }), /Promotion_type_fields_check/, 'porcentaje y monto a la vez');
    await assert.rejects(insert({ bank: 'B', discountPercentage: 10, refundDelayDays: 30 }), /Promotion_refund_check/, 'plazo sin reintegro');
    await assert.rejects(insert({ bank: 'B', discountPercentage: 10, capGroup: 'g' }), /Promotion_cap_group_check/, 'grupo sin tope');
    await assert.rejects(insert({ bank: 'B', discountAmount: -5 }), /Promotion_discountAmount_check/);
    const user = await register();
    await assert.rejects(
      pg.query(`INSERT INTO "BenefitCapUsage" ("id", "userId", "capKey", "periodKey", "consumed", "updatedAt") VALUES (gen_random_uuid(), $1, 'k', '2026-10', -1, now())`, [user.id]),
      /BenefitCapUsage_consumed_check/,
    );
  });

  test('GET /promotions informa reintegro, plazo, monto, tope compartido y acumulación', async () => {
    const { body } = await request(server).get('/api/promotions?limit=50').expect(200);
    const byId = new Map(body.items.map((item) => [item.id, item]));
    const refund = byId.get(COTO_REFUND);
    assert.deepEqual(
      [refund.benefit, refund.stackable, refund.conditions.capGroup, refund.conditions.capPeriod, refund.conditions.eligibleWeekdays, refund.automatic],
      [{ timing: 'REFUND', refundDelayDays: 30 }, true, 'demo-seed:banco-demo-mensual', 'MONTH', [3], false],
    );
    assert.equal(byId.get(VEA_20).conditions.capGroup, 'demo-seed:banco-demo-mensual', 'mismo tope que el de Coto');
    assert.deepEqual([byId.get(JUMBO_WALLET).discountAmount, byId.get(JUMBO_WALLET).discountPercentage, byId.get(JUMBO_WALLET).benefit.timing], ['1500.00', null, 'IMMEDIATE']);
  });

  test('sin preferencias declaradas el beneficio queda condicionado; con otro medio, no corresponde', async () => {
    const user = await register();
    const [first, second] = await pricedProducts('carrefour-almagro');
    const purchases = [{ storeId: demoStoreId('carrefour-almagro'), date: THURSDAY, lines: [{ productId: first.id, quantity: '2' }, { productId: second.id, quantity: '1' }] }];
    const unknown = (await evaluate(user, purchases).expect(200)).body;
    assert.equal(unknown.payer.declared, false);
    const carrefour = evaluationOf(unknown, CARREFOUR_25);
    assert.deepEqual([carrefour.status, carrefour.reason, carrefour.layer], ['CONDITIONAL', 'BANK_NOT_DECLARED', 'PAYMENT']);
    const regular = cents(first.price) * 2 + cents(second.price);
    assert.equal(cents(unknown.result.totals.payToday), regular, 'lo condicionado no baja lo que se paga');
    // El mejor beneficio de pago condicionado de la compra (se paga con un solo medio, no se suman).
    assert.equal(cents(unknown.result.totals.conditionalAmount), Math.min(Math.round(regular * 0.25), 500000));
    assert.deepEqual(unknown.purchases[0].lines.map((line) => [line.priceSource, line.isStale]), [['demo-seed', false], ['demo-seed', false]]);

    await user.patch('/api/users/me').send({ paymentMethods: ['DEBIT_CARD'], banks: ['Banco Demo'] }).expect(200);
    const debit = (await evaluate(user, purchases).expect(200)).body;
    assert.deepEqual([evaluationOf(debit, CARREFOUR_25).status, evaluationOf(debit, CARREFOUR_25).reason], ['NOT_ELIGIBLE', 'PAYMENT_METHOD_NOT_ELIGIBLE']);
    await user.patch('/api/users/me').send({ paymentMethods: ['CREDIT_CARD'], banks: ['banco demo'] }).expect(200);
    const credit = (await evaluate(user, purchases).expect(200)).body;
    assert.deepEqual([evaluationOf(credit, CARREFOUR_25).status, credit.result.purchases[0].payment.promotionId], ['APPLIED', CARREFOUR_25]);
    assert.equal(cents(credit.result.totals.paymentDiscount), Math.min(Math.round(regular * 0.25), 500000), '25 % con tope de $5.000 por compra');
  });

  test('reintegro de los miércoles con tope mensual: desconocido, informado, compartido y agotado', async () => {
    const user = await register({ paymentMethods: ['DEBIT_CARD'], banks: ['Banco Demo'] });
    const [coto] = await pricedProducts('coto-caballito', 1);
    const [vea] = await pricedProducts('vea-flores', 1);
    const cotoPurchase = { storeId: demoStoreId('coto-caballito'), date: WEDNESDAY, lines: [{ productId: coto.id, quantity: '10' }] };
    const unknown = (await evaluate(user, [cotoPurchase]).expect(200)).body;
    const refund = evaluationOf(unknown, COTO_REFUND);
    assert.deepEqual([refund.status, refund.reason, refund.timing, refund.refundDelayDays, refund.cap.remaining], ['CONDITIONAL', 'CAP_REMAINING_UNKNOWN', 'REFUND', 30, null]);

    // Informar que este mes no se usó nada del tope.
    const informed = (await user.put(`/api/benefit-usage/${COTO_REFUND}`).send({ consumed: '0', date: WEDNESDAY }).expect(200)).body;
    assert.deepEqual([informed.capKey, informed.periodKey, informed.limit, informed.remaining], ['group:demo-seed:banco-demo-mensual', WEDNESDAY.slice(0, 7), '8000.00', '8000.00']);
    const applied = (await evaluate(user, [cotoPurchase]).expect(200)).body;
    const [purchase] = applied.result.purchases;
    const regular = cents(coto.price) * 10;
    const expectedRefund = Math.min(Math.round(regular * 0.3), 800000);
    assert.deepEqual([purchase.payment.timing, cents(purchase.payToday), cents(purchase.refundEstimated)], ['REFUND', regular, expectedRefund], 'el reintegro no baja lo que se paga hoy');
    assert.equal(cents(purchase.costAfterRefund), regular - expectedRefund);

    // El tope es del Banco Demo, compartido con Vea: lo informado sirve para las dos promociones.
    await user.put(`/api/benefit-usage/${VEA_20}`).send({ consumed: '7900', date: WEDNESDAY }).expect(200);
    const veaPurchase = { storeId: demoStoreId('vea-flores'), date: THURSDAY, lines: [{ productId: vea.id, quantity: '10' }] };
    const shared = (await evaluate(user, [cotoPurchase, veaPurchase]).expect(200)).body;
    const sameMonth = WEDNESDAY.slice(0, 7) === THURSDAY.slice(0, 7);
    assert.equal(cents(shared.result.purchases[0].refundEstimated), Math.min(expectedRefund, 10000), 'quedan $100 del tope compartido');
    if (sameMonth) {
      const veaEvaluation = evaluationOf(shared, VEA_20);
      assert.deepEqual([veaEvaluation.status, veaEvaluation.reason], ['NOT_ELIGIBLE', 'CAP_EXHAUSTED'], 'Coto usó lo que quedaba');
    }
    assert.ok(shared.result.caps.some((cap) => cap.key === 'group:demo-seed:banco-demo-mensual' && cap.consumedOutside === '7900.00'));

    // Borrar lo informado vuelve a "desconocido".
    await user.delete(`/api/benefit-usage/${COTO_REFUND}?date=${WEDNESDAY}`).expect(204);
    await user.delete(`/api/benefit-usage/${COTO_REFUND}?date=${WEDNESDAY}`).expect(204);
    assert.equal(evaluationOf((await evaluate(user, [cotoPurchase]).expect(200)).body, COTO_REFUND).reason, 'CAP_REMAINING_UNKNOWN');
    // Un jueves no corresponde.
    const thursday = (await evaluate(user, [{ ...cotoPurchase, date: THURSDAY }]).expect(200)).body;
    assert.equal(evaluationOf(thursday, COTO_REFUND).reason, 'WEEKDAY_NOT_ELIGIBLE');
  });

  test('monto fijo con compra mínima y faltantes de precio', async () => {
    const user = await register({ paymentMethods: ['WALLET'], banks: ['Billetera Demo'] });
    const [product] = await pricedProducts('jumbo-palermo', 1);
    const units = Math.ceil(1500000 / cents(product.price)) + 1;
    const big = (await evaluate(user, [{ storeId: demoStoreId('jumbo-palermo'), date: THURSDAY, lines: [{ productId: product.id, quantity: String(units) }] }]).expect(200)).body;
    assert.deepEqual([big.result.purchases[0].payment.promotionId, big.result.purchases[0].paymentDiscount], [JUMBO_WALLET, '1500.00']);
    const small = (await evaluate(user, [{ storeId: demoStoreId('jumbo-palermo'), date: THURSDAY, lines: [{ productId: product.id, quantity: '1' }] }]).expect(200)).body;
    assert.equal(evaluationOf(small, JUMBO_WALLET).reason, 'MINIMUM_SPEND_NOT_REACHED');

    // Un producto que esa sucursal no tiene queda afuera del cálculo, informado.
    const { rows: [absent] } = await pg.query(
      `SELECT p."id"::text AS id FROM "Product" p WHERE p."isActive" AND p."saleMode" = 'PACKAGED'
       AND NOT EXISTS (SELECT 1 FROM "ProductPrice" pp WHERE pp."productId" = p."id" AND pp."storeId" = $1) LIMIT 1`,
      [demoStoreId('jumbo-palermo')],
    );
    if (absent) {
      const missing = (await evaluate(user, [{ storeId: demoStoreId('jumbo-palermo'), date: THURSDAY, lines: [{ productId: product.id, quantity: '1' }, { productId: absent.id, quantity: '1' }] }]).expect(200)).body;
      assert.deepEqual(missing.purchases[0].missingPrices.map((entry) => entry.productId), [absent.id]);
      assert.equal(missing.result.purchases[0].lines.length, 1);
    }
  });

  test('validación, sesión y dueño del consumo informado', async () => {
    const user = await register();
    const other = await register();
    const [product] = await pricedProducts('coto-caballito', 1);
    const line = { productId: product.id, quantity: '1' };
    const store = demoStoreId('coto-caballito');
    await request(server).post('/api/benefits/evaluate').send({ purchases: [] }).expect(401);
    const error = async (purchases, code) => assert.equal((await evaluate(user, purchases).expect(400)).body.error, code);
    await error([{ storeId: randomUUID(), date: THURSDAY, lines: [line] }], 'STORE_NOT_FOUND');
    await error([{ storeId: store, date: THURSDAY, lines: [{ productId: randomUUID(), quantity: '1' }] }], 'PRODUCT_NOT_FOUND');
    await error([{ storeId: store, date: THURSDAY, lines: [{ ...line, quantity: '1.5' }] }], 'QUANTITY_INVALID');
    await error([{ storeId: store, date: '2026-02-30', lines: [line] }], 'DATE_INVALID');
    await error([], 'VALIDATION_FAILED');
    await error([{ storeId: store, date: THURSDAY, lines: [{ ...line, extra: true }] }], 'VALIDATION_FAILED');
    await error(Array.from({ length: 11 }, () => ({ storeId: store, date: THURSDAY, lines: [line] })), 'VALIDATION_FAILED');

    assert.equal((await user.put(`/api/benefit-usage/${CARREFOUR_25}`).send({ consumed: '10' }).expect(400)).body.error, 'CAP_NOT_TRACKABLE', 'un tope por compra no se arrastra');
    await user.put(`/api/benefit-usage/${randomUUID()}`).send({ consumed: '10' }).expect(404);
    await user.put(`/api/benefit-usage/${COTO_REFUND}`).send({ consumed: '-1' }).expect(400);
    await user.put(`/api/benefit-usage/${COTO_REFUND}`).send({ consumed: '1200.50' }).expect(200);
    assert.deepEqual((await user.get('/api/benefit-usage').expect(200)).body.items.map((item) => [item.capKey, item.consumed]), [['group:demo-seed:banco-demo-mensual', '1200.50']]);
    assert.deepEqual((await other.get('/api/benefit-usage').expect(200)).body.items, [], 'cada persona ve solo lo suyo');
  });

  test('el importador guarda reintegro, plazo, monto y el grupo de tope de la fuente', async () => {
    const gateway = new PrismaImportGateway(prisma);
    const anchor = TODAY;
    const source = `beneficios-test-${process.pid}`;
    const provider = {
      source,
      decimalSeparator: ',',
      replayable: true,
      async *records() {
        const base = { kind: 'promotion', chain: 'Coto', bank: 'Banco Importado', validFrom: addDays(anchor, -1), validUntil: addDays(anchor, 10) };
        yield { ...base, externalId: 'reintegro', name: 'Reintegro importado', type: 'BANK_DISCOUNT', discountPercentage: '15,00', benefitTiming: 'reintegro', refundDelayDays: 45, discountCap: '3.000,00', capPeriod: 'MONTH', capGroup: 'mensual' };
        yield { ...base, externalId: 'monto', name: 'Monto importado', type: 'BANK_DISCOUNT', discountAmount: '700,00', minimumSpend: '7.000,00' };
        yield { ...base, externalId: 'invalida', name: 'Plazo sin reintegro', type: 'BANK_DISCOUNT', discountPercentage: '10,00', refundDelayDays: 10 };
      },
    };
    const summary = await new PromotionImporter(gateway).run(provider);
    assert.deepEqual([summary.created, summary.rejected], [2, 1]);
    const { rows } = await pg.query(
      `SELECT "externalId", "benefitTiming", "refundDelayDays", "capGroup", "discountAmount"::text AS amount FROM "Promotion" WHERE "source" = $1 ORDER BY "externalId"`,
      [source],
    );
    assert.deepEqual(rows, [
      { externalId: 'monto', benefitTiming: 'IMMEDIATE', refundDelayDays: null, capGroup: null, amount: '700.00' },
      { externalId: 'reintegro', benefitTiming: 'REFUND', refundDelayDays: 45, capGroup: `${source}:mensual`, amount: null },
    ]);
  });
});
