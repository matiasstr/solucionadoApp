// Análisis del precio actual resumido en SQL (P10-02) contra PostgreSQL real: debe clasificar
// exactamente igual que `analyzeSeries` sobre las observaciones (ADR 0016), sin el tope de
// 50.000 observaciones que dejaba series sin historia. Ejecutar con `npm.cmd run test:db`.
// Usa una sucursal y presentaciones propias en Mendoza y una fuente propia (`analisis-sql-test`).
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { CurrentPriceAnalysis } = require('../../dist/modules/prices/application/current-price-analysis');
const { analyzeSeries, argentineDate, argentineDayStart, shiftDate } = require('../../dist/modules/prices/domain/price-analysis');
const { ProductPriceRepository } = require('../../dist/modules/prices/infrastructure/product-price.repository');
const { demoCanonicalProductId, latestObservationAnchor, seedDemoCatalog } = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const SOURCE = 'analisis-sql-test';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_AGE_DAYS = 7;
// El precio actual es de hace una hora (nunca futuro); la historia se cuenta desde su día argentino.
const NOW = new Date();
const CURRENT = new Date(NOW.getTime() - HOUR);
const TODAY = argentineDate(CURRENT);
const at = (daysAgo, hourUtc = 15) => new Date(Date.parse(`${shiftDate(TODAY, -daysAgo)}T00:00:00.000Z`) + hourUtc * HOUR);

let prisma;
let repository;
let analysis;
const fixtures = {};

async function observe(productId, storeId, unitPrice, observedAt, ingestedAt) {
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
      ...(ingestedAt ? { ingestedAt } : {}),
    },
  });
}

/** El cálculo de antes (P6-02/P9-01) sin tope: últimas observaciones + ventana en memoria + `analyzeSeries`. */
async function reference(productIds, storeIds, now) {
  const latest = (await repository.findLatestPerSeries(productIds, storeIds)).filter(
    (observation) => now.getTime() - observation.observedAt.getTime() <= (MAX_AGE_DAYS + 1) * DAY,
  );
  const observations = await repository.findBetween([...new Set(latest.map((observation) => observation.productId))], {
    storeIds,
    from: argentineDayStart(shiftDate(argentineDate(now), -(30 + MAX_AGE_DAYS + 1))),
    until: new Date(now.getTime() + 1),
    limit: 5_000_000,
  });
  const key = (observation) => `${observation.productId}|${observation.storeId}|${observation.source}`;
  const bySeries = new Map();
  for (const observation of observations) bySeries.set(key(observation), [...(bySeries.get(key(observation)) ?? []), observation]);
  return latest.map((current) => ({
    latest: current,
    analysis: analyzeSeries({ observations: bySeries.get(key(current)) ?? [], latest: current, now, maxAgeDays: MAX_AGE_DAYS }),
  }));
}

const byKey = (results) =>
  new Map(results.map((result) => [`${result.latest.productId}|${result.latest.storeId}|${result.latest.source}`, result]));

before(async () => {
  prisma = new PrismaService(url);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  repository = new ProductPriceRepository(prisma);
  analysis = new CurrentPriceAnalysis(
    repository,
    validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars', PRICE_MAX_AGE_DAYS: String(MAX_AGE_DAYS) }),
  );

  const arroz = demoCanonicalProductId('arroz-largo-fino');
  const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { id: arroz }, select: { categoryId: true } });
  const chain = await prisma.storeChain.findFirstOrThrow({ select: { id: true } });
  fixtures.store = (
    await prisma.store.create({
      data: { chainId: chain.id, name: 'Análisis SQL (TEST)', address: 'Calle de prueba 456', city: 'Mendoza', province: 'Mendoza', latitude: '-32.889500', longitude: '-68.845800' },
    })
  ).id;
  for (const letter of ['A', 'B', 'C', 'D']) {
    fixtures[letter] = (
      await prisma.product.create({
        data: {
          name: `Arroz Análisis ${letter} 1 kg`,
          normalizedName: `arroz analisis ${letter.toLowerCase()} 1 kg`,
          brand: `Marca ${letter}`,
          categoryId: canonical.categoryId,
          canonicalProductId: arroz,
          quantity: '1',
          unit: 'KG',
        },
      })
    ).id;
  }
  const { store } = fixtures;

  // A: historia completa con los casos límite del cierre diario.
  for (let daysAgo = 1; daysAgo <= 31; daysAgo += 1) await observe(fixtures.A, store, String(1000 + (daysAgo % 5) * 10), at(daysAgo));
  // Tres observaciones el día 3: el cierre es la más tardía; con la misma hora gana la ingesta más reciente.
  await observe(fixtures.A, store, '700', at(3, 13));
  await observe(fixtures.A, store, '990', at(3, 20), new Date(NOW.getTime() - 2 * DAY));
  await observe(fixtures.A, store, '980', at(3, 20), new Date(NOW.getTime() - DAY));
  // Mínimo repetido (días 8 y 12): queda el más reciente.
  await observe(fixtures.A, store, '800', at(8, 22));
  await observe(fixtures.A, store, '800', at(12, 22));
  // 01:00 UTC es todavía el día anterior en Argentina (22:00 del día 16).
  await observe(fixtures.A, store, '850', at(15, 1));
  await observe(fixtures.A, store, '1005', CURRENT);

  // B: solo el precio actual, sin historia.
  await observe(fixtures.B, store, '1200', CURRENT);
  // C: precio viejo (fuera de los 8 días): no es noticia en ninguna de las dos vías.
  for (let daysAgo = 12; daysAgo <= 25; daysAgo += 1) await observe(fixtures.C, store, '1300', at(daysAgo));
  // D: precio actual con tres días de historia (< 7 días con dato).
  await observe(fixtures.D, store, '1100', CURRENT);
  for (let daysAgo = 1; daysAgo <= 3; daysAgo += 1) await observe(fixtures.D, store, String(1100 - daysAgo), at(daysAgo));
});
after(async () => {
  await prisma?.$disconnect();
});

test('casos límite: cierre diario, empate de ingesta, día argentino, mínimo repetido, sin historia y precio viejo', async () => {
  const products = [fixtures.A, fixtures.B, fixtures.C, fixtures.D];
  const sql = await analysis.analyze(products, [fixtures.store], NOW);
  const expected = await reference(products, [fixtures.store], NOW);
  assert.deepEqual(sql, expected);

  const found = byKey(sql);
  const a = found.get(`${fixtures.A}|${fixtures.store}|${SOURCE}`).analysis;
  assert.equal(a.current.unitPrice, '1005.000000');
  assert.equal(a.lowest, '800.000000');
  assert.equal(a.lowestDate, shiftDate(TODAY, -8), 'ante un mínimo repetido queda el día más reciente');
  assert.equal(a.baseWindow.daysWithData, 30);
  assert.ok(a.baseWindow.observations > a.baseWindow.daysWithData, 'cuenta todas las observaciones de los días con cierre');
  assert.equal(found.get(`${fixtures.B}|${fixtures.store}|${SOURCE}`).analysis.classification, 'INSUFFICIENT_DATA');
  assert.equal(found.get(`${fixtures.B}|${fixtures.store}|${SOURCE}`).analysis.baseWindow.daysWithData, 0);
  assert.equal(found.has(`${fixtures.C}|${fixtures.store}|${SOURCE}`), false, 'un precio viejo no se analiza');
  const d = found.get(`${fixtures.D}|${fixtures.store}|${SOURCE}`).analysis;
  assert.deepEqual([d.classification, d.baseWindow.daysWithData], ['INSUFFICIENT_DATA', 3]);
});

test('todas las series del catálogo DEMO: igual que el cálculo en memoria, una por una', async () => {
  const products = (await prisma.product.findMany({ select: { id: true } })).map((product) => product.id);
  const stores = (await prisma.store.findMany({ select: { id: true } })).map((store) => store.id);
  const sql = await analysis.analyze(products, stores, NOW);
  const expected = await reference(products, stores, NOW);
  assert.ok(sql.length > 50, `hay series para comparar (${sql.length})`);
  assert.deepEqual(sql, expected);
  const classifications = new Set(sql.map((entry) => entry.analysis.classification));
  assert.ok(classifications.size >= 2, `se cubren varias clasificaciones (${[...classifications].join(', ')})`);
});
