// Importadores (P7-01) contra PostgreSQL/PostGIS real. Ejecutar con `npm.cmd run test:db`.
// Último en scripts/test-db.cjs: crea sucursales y productos simulados cerca de los de la demo.
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');
const { after, before, describe, test } = require('node:test');
const { Client } = require('pg');
const { PrismaService } = require('../../dist/database/prisma.service');
const { PriceImporter } = require('../../dist/modules/imports/application/price-importer');
const { PromotionImporter } = require('../../dist/modules/imports/application/promotion-importer');
const { PrismaImportGateway } = require('../../dist/modules/imports/infrastructure/prisma-import.gateway');
const { JsonLinesPriceProvider } = require('../../dist/modules/imports/infrastructure/providers/json-lines-price.provider');
const { MockPriceProvider, MockPromotionProvider } = require('../../dist/modules/imports/infrastructure/providers/mock-price.provider');
const { argentineDate, shiftDate } = require('../../dist/modules/prices/domain/price-analysis');
const { demoEan } = require('../../dist/seed/demo-catalog');
const { latestObservationAnchor, seedDemoCatalog, demoProductId } = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

// Ayer: un día sin hora es el mediodía argentino y hoy podría ser todavía futuro.
const ANCHOR = shiftDate(argentineDate(new Date()), -1);
const ARROZ_PAMPA_EAN = demoEan('290000000001');

let prisma;
let pg;
before(async () => {
  prisma = new PrismaService(url);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  pg = new Client({ connectionString: url });
  await pg.connect();
});
after(async () => {
  await pg?.end();
  await prisma?.$disconnect();
});

const count = async (sql, params = []) => (await pg.query(sql, params)).rows[0].n;
const pricesOf = (source) => count('SELECT count(*)::int AS n FROM "ProductPrice" WHERE "source" = $1', [source]);
const importer = () => new PriceImporter(new PrismaImportGateway(prisma));

/** Proveedor en memoria: cualquier fuente que cumpla el contrato sirve, sin tocar el dominio. */
const arrayProvider = (source, items) => ({
  source,
  decimalSeparator: ',',
  async *records() {
    yield* items;
  },
});
const rawRecord = (overrides = {}) => ({
  kind: 'price',
  recordId: null,
  store: { externalId: 'suc-a', chain: 'Coto', name: 'Coto Prueba (MOCK)', address: 'Calle 1', city: 'Morón', province: 'Buenos Aires', ...overrides.store },
  product: { externalId: 'prod-a', ean: null, name: 'Producto de prueba (MOCK)', quantity: '1', unit: 'kg', ...overrides.product },
  price: overrides.price ?? '1.500,00',
  observedAt: overrides.observedAt ?? ANCHOR,
});

describe('importación de precios', () => {
  test('mock de punta a punta: sucursales, productos sin EAN, pendientes de genérico y precios con coma decimal', async () => {
    const demoPricesBefore = await pricesOf('demo-seed');
    const provider = new MockPriceProvider({ seed: 5, stores: 3, products: 8, days: 3, anchorDate: ANCHOR, withoutEanEvery: 4 });
    const summary = await importer().run(provider, { batchSize: 10, concurrency: 2 });
    assert.equal(summary.status, 'COMPLETED', JSON.stringify(summary));
    assert.deepEqual(
      [summary.read, summary.created, summary.duplicates, summary.conflicts, summary.rejected],
      [72, 72, 0, 0, 0],
    );
    assert.deepEqual([summary.storesCreated, summary.productsCreated, summary.productsPendingCanonical], [3, 8, 1]);
    assert.equal(summary.batches, 8);
    assert.equal(await pricesOf('mock-provider'), 72);
    assert.equal(await count(`SELECT count(*)::int AS n FROM "ExternalStoreRef" WHERE "source" = 'mock-provider'`), 3);
    assert.equal(await count(`SELECT count(*)::int AS n FROM "ExternalProductRef" WHERE "source" = 'mock-provider'`), 8);
    assert.equal(
      await count(`SELECT count(*)::int AS n FROM "Product" p JOIN "ExternalProductRef" r ON r."productId" = p."id" WHERE r."source" = 'mock-provider' AND p."ean" IS NULL`),
      2,
      'los productos 0 y 4 vienen sin EAN y se importan igual',
    );
    const { rows: [sample] } = await pg.query(
      `SELECT p."price"::text AS price, p."importBatchId" AS batch, p."observedAt" AS observed, p."ingestedAt" AS ingested
       FROM "ProductPrice" p WHERE p."source" = 'mock-provider' ORDER BY p."observedAt", p."id" LIMIT 1`,
    );
    assert.match(sample.price, /^\d+\.\d{2}$/);
    assert.equal(sample.batch, summary.runId);
    assert.ok(sample.ingested > sample.observed, 'la fecha de ingesta no es la del precio');
    assert.equal(await pricesOf('demo-seed'), demoPricesBefore, 'la historia existente no se toca');
  });

  test('reimportar lo mismo no duplica: todo es repetido y no se crea nada', async () => {
    const provider = new MockPriceProvider({ seed: 5, stores: 3, products: 8, days: 3, anchorDate: ANCHOR, withoutEanEvery: 4 });
    const summary = await importer().run(provider, { batchSize: 7, concurrency: 3 });
    assert.deepEqual(
      [summary.status, summary.created, summary.duplicates, summary.storesCreated, summary.productsCreated],
      ['COMPLETED', 0, 72, 0, 0],
    );
    assert.equal(await pricesOf('mock-provider'), 72);
  });

  test('la misma clave con otro precio es un conflicto: no se sobrescribe', async () => {
    const first = await importer().run(arrayProvider('conflictos', [rawRecord()]));
    assert.equal(first.created, 1);
    const second = await importer().run(arrayProvider('conflictos', [rawRecord(), rawRecord({ price: '1.600,00' })]));
    assert.deepEqual([second.status, second.created, second.duplicates, second.conflicts], ['COMPLETED_WITH_REJECTIONS', 0, 1, 1]);
    const { rows } = await pg.query(`SELECT "price"::text AS price FROM "ProductPrice" WHERE "source" = 'conflictos'`);
    assert.deepEqual(rows, [{ price: '1500.00' }]);
  });

  test('identidad por EAN válido: se vincula con el producto existente; otro contenido con ese EAN se rechaza', async () => {
    const summary = await importer().run(arrayProvider('por-ean', [
      rawRecord({ product: { externalId: 'arroz-externo', ean: ARROZ_PAMPA_EAN, name: 'Arroz 1 kg (otro nombre)', quantity: '1000', unit: 'gr' } }),
      rawRecord({ product: { externalId: 'arroz-medio', ean: ARROZ_PAMPA_EAN, name: 'Arroz 500 g', quantity: '500', unit: 'gr' } }),
    ]));
    assert.deepEqual([summary.created, summary.productsCreated, summary.rejected], [1, 0, 1]);
    assert.deepEqual(summary.rejectedByReason, { EAN_CONTENT_MISMATCH: 1 });
    const { rows: [link] } = await pg.query(`SELECT "productId"::text AS id FROM "ExternalProductRef" WHERE "source" = 'por-ean' AND "externalId" = 'arroz-externo'`);
    assert.equal(link.id, demoProductId('arroz-pampa-1kg'), 'no se creó otro producto por el nombre distinto');

    const changed = await importer().run(arrayProvider('por-ean', [
      rawRecord({ product: { externalId: 'arroz-externo', ean: ARROZ_PAMPA_EAN, name: 'Arroz', quantity: '2', unit: 'kg' } }),
    ]));
    assert.deepEqual(changed.rejectedByReason, { CONTENT_CHANGED: 1 }, 'la fuente no puede cambiarle el contenido a un producto ya vinculado');
  });

  test('registros corruptos se rechazan con motivo y el resto entra', async () => {
    const provider = new MockPriceProvider({ seed: 9, stores: 2, products: 5, days: 3, anchorDate: ANCHOR, corruptEvery: 6 });
    const summary = await importer().run(arrayProvider('corruptos', await collect(provider)), { batchSize: 4 });
    assert.equal(summary.status, 'COMPLETED_WITH_REJECTIONS');
    assert.equal(summary.read, 30);
    assert.equal(summary.rejected, 5);
    assert.deepEqual(summary.rejectedByReason, { PRICE_INVALID: 2, UNIT_UNKNOWN: 1, STORE_INVALID: 1, OBSERVED_AT_INVALID: 1 });
    assert.equal(summary.created, 25);
    assert.ok(summary.rejectionSamples.every((sample) => sample.position > 0 && typeof sample.detail === 'string'));
  });

  test('un fallo a mitad de la importación deja lo confirmado y la reanudación completa sin duplicar', async () => {
    const items = await collect(new MockPriceProvider({ seed: 11, stores: 2, products: 5, days: 4, anchorDate: ANCHOR }));
    const gateway = new PrismaImportGateway(prisma);
    let calls = 0;
    const failing = {
      resolveStores: (...args) => gateway.resolveStores(...args),
      resolveProducts: (...args) => gateway.resolveProducts(...args),
      persistPrices: async (inputs) => {
        calls += 1;
        if (calls === 3) throw new Error('conexión con la base perdida');
        return gateway.persistPrices(inputs);
      },
    };
    const failed = await new PriceImporter(failing).run(arrayProvider('a-mitad', items), { batchSize: 10, concurrency: 1 });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.error, 'Error inesperado (Error).', 'sin el mensaje crudo');
    assert.equal(failed.created, 20);
    assert.equal(await pricesOf('a-mitad'), 20);

    const resumed = await importer().run(arrayProvider('a-mitad', items), { batchSize: 10 });
    assert.deepEqual([resumed.status, resumed.created, resumed.duplicates], ['COMPLETED', 20, 20]);
    assert.equal(await pricesOf('a-mitad'), 40);
  });

  test('proveedor alternativo en archivo .jsonl.gz sin tocar el dominio: líneas ilegibles se informan', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tusofertas-import-'));
    const path = join(folder, 'precios.jsonl.gz');
    const valid = rawRecord({ store: { externalId: 'suc-archivo' }, product: { externalId: 'prod-archivo', quantity: '1,5', unit: 'lt' }, price: '2.345,67' });
    delete valid.kind;
    writeFileSync(path, gzipSync([JSON.stringify(valid), '{ no es json', JSON.stringify({ price: 10 }), ''].join('\n')));
    try {
      const summary = await importer().run(new JsonLinesPriceProvider({ path, source: 'archivo-prueba', decimalSeparator: ',' }));
      assert.deepEqual([summary.read, summary.created, summary.rejected], [3, 1, 2]);
      assert.deepEqual(summary.rejectedByReason, { UNPARSABLE: 2 });
      const { rows: [row] } = await pg.query(`SELECT "price"::text AS price, "unitPrice"::text AS unit FROM "ProductPrice" WHERE "source" = 'archivo-prueba'`);
      assert.deepEqual(row, { price: '2345.67', unit: '1563.780000' }, '2.345,67 por 1,5 L');

      const missing = await importer().run(new JsonLinesPriceProvider({ path: join(folder, 'no-existe.jsonl'), source: 'archivo-prueba', decimalSeparator: ',' }));
      assert.equal(missing.status, 'FAILED');
      assert.match(missing.error, /No se pudo leer el archivo/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('importación de promociones', () => {
  test('se vinculan con sucursales, cadenas y productos existentes; inválidas y desconocidas se rechazan; reimportar actualiza', async () => {
    const run = () => new PromotionImporter(new PrismaImportGateway(prisma)).run(new MockPromotionProvider(ANCHOR));
    const first = await run();
    assert.deepEqual([first.status, first.read, first.created, first.updated, first.rejected], ['COMPLETED_WITH_REJECTIONS', 6, 4, 0, 2]);
    assert.deepEqual(first.rejectedByReason, { PROMOTION_INVALID: 1, STORE_UNKNOWN: 1 });
    const second = await run();
    assert.deepEqual([second.created, second.updated], [0, 4]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM "Promotion" WHERE "source" = 'mock-provider'`), 4);
    const { rows: [bank] } = await pg.query(`SELECT "type"::text AS type, "bank", "discountCap"::text AS cap FROM "Promotion" WHERE "externalId" = 'mock-promo-6'`);
    assert.deepEqual(bank, { type: 'BANK_DISCOUNT', bank: 'Banco Simulado', cap: '3000.00' });
  });
});

async function collect(provider) {
  const items = [];
  for await (const item of provider.records()) items.push(item);
  return items;
}
