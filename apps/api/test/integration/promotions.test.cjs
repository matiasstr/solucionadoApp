// Promociones demo y API pública (P2-03) contra PostgreSQL real.
// Ejecutar con `npm.cmd run test:db`. No usa mocks.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { PromotionRepository } = require('../../dist/modules/promotions/infrastructure/promotion.repository');
const { priceLine } = require('../../dist/modules/promotions/domain/promotion-calculator');
const { ProductPriceRepository } = require('../../dist/modules/prices/infrastructure/product-price.repository');
const {
  seedDemoCatalog,
  demoCanonicalProductId,
  demoChainId,
  demoProductId,
  demoPromotionId,
  demoStoreId,
} = require('../../dist/seed/seed-demo-catalog');
const { DEMO_PROMOTIONS, DEMO_SOURCE } = require('../../dist/seed/demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const now = new Date();
const ANCHOR = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
const MS_PER_DAY = 86_400_000;
const daysFromAnchor = (days) => new Date(ANCHOR.getTime() + days * MS_PER_DAY);

const PROMOTION_KEYS = ['id', 'name', 'type', 'scope', 'discountPercentage', 'fixedPrice', 'requiredQuantity', 'conditions', 'automatic', 'terms', 'source', 'validFrom', 'validUntil'];

let app;
let server;
let prisma;
let promotions;
let pg;
before(async () => {
  prisma = new PrismaService(url);
  promotions = new PromotionRepository(prisma);
  await seedDemoCatalog(prisma, { anchorDate: ANCHOR, historyDays: 31 });
  app = await createApp(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars',
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

const get = (path) => request(server).get(path);
const idsOf = (response) => response.body.items.map((promotion) => promotion.id);

describe('seed de promociones', () => {
  test('carga promociones demo activas, futuras y vencidas sin duplicar', async () => {
    const before = await prisma.promotion.count();
    assert.equal(before, DEMO_PROMOTIONS.length);
    await seedDemoCatalog(prisma, { anchorDate: ANCHOR, historyDays: 31 });
    assert.equal(await prisma.promotion.count(), before);

    const sources = await prisma.promotion.groupBy({ by: ['source'] });
    assert.deepEqual(sources.map((row) => row.source), [DEMO_SOURCE]);
    const sample = await prisma.promotion.findUnique({ where: { id: demoPromotionId('carrefour-arroz-20') } });
    assert.match(sample.name, /\(DEMO\)$/);
    assert.equal(sample.externalId, 'carrefour-arroz-20');
    // Vigencia relativa al ancla: activa hoy.
    assert.ok(sample.validFrom < new Date() && sample.validUntil > new Date());
  });

  test('la base rechaza una promoción con dos alcances comerciales', async () => {
    const result = await pg
      .query(
        `INSERT INTO "Promotion" ("id","storeId","chainId","name","type","discountPercentage","source","validFrom","validUntil","updatedAt")
         VALUES ($1,$2,$3,'Alcance inválido','PERCENTAGE',10,'test-manual',now(),now() + interval '1 day',now())`,
        [randomUUID(), demoStoreId('coto-caballito'), demoChainId('coto')],
      )
      .catch((error) => error);
    assert.equal(result.constraint, 'Promotion_commercial_scope_check');

    // El repositorio nombra el campo antes de llegar a la base.
    await assert.rejects(
      promotions.upsert({
        id: randomUUID(),
        name: 'Sin porcentaje',
        type: 'PERCENTAGE',
        storeId: demoStoreId('coto-caballito'),
        chainId: null,
        productId: null,
        canonicalProductId: null,
        discountPercentage: null,
        fixedPrice: null,
        requiredQuantity: null,
        paymentMethod: null,
        bank: null,
        membershipProgram: null,
        minimumSpend: null,
        discountCap: null,
        capPeriod: null,
        eligibleWeekdays: [],
        isStackable: false,
        terms: null,
        source: 'test-manual',
        externalId: null,
        validFrom: daysFromAnchor(-1),
        validUntil: daysFromAnchor(1),
      }),
      (error) => error.code === 'PERCENTAGE_REQUIRED' && error.fields[0] === 'discountPercentage',
    );
  });
});

describe('GET /api/promotions', () => {
  test('por defecto lista solo lo vigente ahora', async () => {
    const response = await get('/api/promotions?limit=50').expect(200);
    const ids = idsOf(response);
    assert.ok(ids.includes(demoPromotionId('carrefour-arroz-20')));
    assert.ok(ids.includes(demoPromotionId('coto-fideos-2x1')));
    // Ni las vencidas ni las que todavía no empezaron.
    assert.equal(ids.includes(demoPromotionId('jumbo-gaseosa-vencida')), false);
    assert.equal(ids.includes(demoPromotionId('coto-aceite-futura')), false);
    // Orden estable: primero lo que vence antes.
    const ends = response.body.items.map((promotion) => promotion.validUntil);
    assert.deepEqual(ends, [...ends].sort());

    const all = await get('/api/promotions?includeInactive=true&limit=50').expect(200);
    assert.equal(idsOf(all).length, DEMO_PROMOTIONS.length);
    assert.ok(idsOf(all).includes(demoPromotionId('jumbo-gaseosa-vencida')));

    // Consultar otro instante: la futura entra en vigencia más adelante.
    const later = await get(`/api/promotions?limit=50&activeAt=${daysFromAnchor(12).toISOString()}`).expect(200);
    assert.ok(idsOf(later).includes(demoPromotionId('coto-aceite-futura')));
    assert.equal(idsOf(later).includes(demoPromotionId('carrefour-arroz-20')), false);
  });

  test('expone el contrato completo y distingue lo que no se calcula solo', async () => {
    const response = await get(`/api/promotions/${demoPromotionId('carrefour-arroz-20')}`).expect(200);
    const promotion = response.body;
    assert.deepEqual(Object.keys(promotion).sort(), PROMOTION_KEYS.slice().sort());
    assert.deepEqual(Object.keys(promotion.scope).sort(), ['canonicalProductId', 'chainId', 'productId', 'storeId']);
    assert.equal(promotion.scope.storeId, demoStoreId('carrefour-almagro'));
    assert.equal(promotion.scope.chainId, null);
    assert.equal(promotion.scope.productId, demoProductId('arroz-pampa-1kg'));
    assert.equal(promotion.type, 'PERCENTAGE');
    assert.equal(promotion.discountPercentage, '20.00');
    assert.equal(promotion.fixedPrice, null);
    assert.equal(promotion.automatic, true);
    assert.equal(promotion.source, DEMO_SOURCE);
    assert.match(promotion.validFrom, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // La bancaria se informa, pero no se calcula automáticamente.
    const bank = await get(`/api/promotions/${demoPromotionId('carrefour-banco-25')}`).expect(200);
    assert.equal(bank.body.automatic, false);
    assert.equal(bank.body.type, 'BANK_DISCOUNT');
    assert.equal(bank.body.conditions.bank, 'Banco Demo');
    assert.equal(bank.body.conditions.paymentMethod, 'CREDIT_CARD');
    assert.equal(bank.body.conditions.discountCap, '5000.00');
    assert.equal(bank.body.conditions.capPeriod, 'PURCHASE');

    const weekday = await get(`/api/promotions/${demoPromotionId('vea-detergente-martes')}`).expect(200);
    assert.deepEqual(weekday.body.conditions.eligibleWeekdays, [2]);
    assert.equal(weekday.body.scope.canonicalProductId, demoCanonicalProductId('detergente'));

    const fixed = await get(`/api/promotions/${demoPromotionId('disco-yerba-fija')}`).expect(200);
    assert.equal(fixed.body.fixedPrice, '2990.00');
    assert.equal(fixed.body.requiredQuantity, 2);
  });

  test('filtra por alcance y tipo, y pagina por cursor', async () => {
    const byStore = await get(`/api/promotions?storeId=${demoStoreId('carrefour-almagro')}`).expect(200);
    assert.deepEqual(idsOf(byStore), [demoPromotionId('carrefour-arroz-20')]);

    const byChain = await get(`/api/promotions?chainId=${demoChainId('coto')}`).expect(200);
    assert.deepEqual(idsOf(byChain), [demoPromotionId('coto-fideos-2x1')]);

    const byProduct = await get(`/api/promotions?productId=${demoProductId('leche-vallealto-sachet')}`).expect(200);
    assert.deepEqual(idsOf(byProduct), [demoPromotionId('jumbo-leche-segunda-50')]);

    const byCanonical = await get(`/api/promotions?canonicalProductId=${demoCanonicalProductId('detergente')}`).expect(200);
    assert.deepEqual(idsOf(byCanonical), [demoPromotionId('vea-detergente-martes')]);

    const byType = await get('/api/promotions?type=TWO_FOR_ONE&limit=50').expect(200);
    assert.equal(byType.body.items.every((promotion) => promotion.type === 'TWO_FOR_ONE'), true);

    const first = await get('/api/promotions?includeInactive=true&limit=3').expect(200);
    assert.equal(first.body.items.length, 3);
    const second = await get(`/api/promotions?includeInactive=true&limit=3&cursor=${encodeURIComponent(first.body.page.nextCursor)}`).expect(200);
    assert.equal(idsOf(second).some((id) => idsOf(first).includes(id)), false);
  });

  test('rechaza filtros inválidos y distingue 400 de 404', async () => {
    for (const [path, field] of [
      ['/api/promotions?storeId=no-es-uuid', 'storeId'],
      ['/api/promotions?type=INVENTADO', 'type'],
      ['/api/promotions?activeAt=ayer', 'activeAt'],
      ['/api/promotions?limit=0', 'limit'],
      ['/api/promotions?cursor=roto', 'cursor'],
      ['/api/promotions?desconocido=1', 'desconocido'],
    ]) {
      const response = await get(path).expect(400);
      assert.deepEqual(response.body.fields, [field], path);
    }
    await get(`/api/promotions/${randomUUID()}`).expect(404);
    const invalid = await get('/api/promotions/no-es-uuid').expect(400);
    assert.deepEqual(invalid.body.fields, ['id']);
  });
});

describe('cálculo con datos reales del seed', () => {
  test('aplica la promoción demo sobre el precio actual de la sucursal', async () => {
    const productId = demoProductId('arroz-pampa-1kg');
    const storeId = demoStoreId('carrefour-almagro');
    const prices = new ProductPriceRepository(prisma);
    const [current] = await prices.findCurrentByProduct(productId, { storeIds: [storeId] });
    assert.ok(current, 'el seed debería tener precio de arroz en Carrefour Almagro');

    const instant = new Date();
    const rules = await promotions.findActiveFor({
      instant,
      storeIds: [storeId],
      chainIds: [demoChainId('carrefour')],
      productIds: [productId],
      canonicalProductIds: [demoCanonicalProductId('arroz-largo-fino')],
    });
    const ids = rules.map((rule) => rule.id);
    assert.ok(ids.includes(demoPromotionId('carrefour-arroz-20')));
    // La bancaria de la cadena también alcanza a esta compra, pero no se aplica sola.
    assert.ok(ids.includes(demoPromotionId('carrefour-banco-25')));

    const charge = priceLine(
      { unitPrice: current.price, quantity: '2', saleMode: 'PACKAGED' },
      rules,
      {
        instant,
        target: {
          storeId,
          chainId: demoChainId('carrefour'),
          productId,
          canonicalProductId: demoCanonicalProductId('arroz-largo-fino'),
        },
      },
    );
    assert.equal(charge.appliedPromotionId, demoPromotionId('carrefour-arroz-20'));
    const regular = Number(current.price) * 2;
    assert.equal(Number(charge.regularTotal).toFixed(2), regular.toFixed(2));
    // 20% menos, con el redondeo hecho una sola vez.
    assert.equal(Number(charge.total).toFixed(2), (regular * 0.8).toFixed(2));
    assert.equal((Number(charge.total) + Number(charge.discount)).toFixed(2), regular.toFixed(2));

    const bank = charge.evaluations.find((evaluation) => evaluation.promotionId === demoPromotionId('carrefour-banco-25'));
    assert.equal(bank.applied, false);
    assert.equal(bank.skipReason, 'PAYMENT_CONDITIONED');
  });

  test('una promoción de otra cadena no alcanza a esta sucursal', async () => {
    const rules = await promotions.findActiveFor({
      instant: new Date(),
      storeIds: [demoStoreId('carrefour-almagro')],
      chainIds: [demoChainId('carrefour')],
      productIds: [demoProductId('fideos-pampa-500g')],
    });
    assert.equal(rules.map((rule) => rule.id).includes(demoPromotionId('coto-fideos-2x1')), false);
  });
});
