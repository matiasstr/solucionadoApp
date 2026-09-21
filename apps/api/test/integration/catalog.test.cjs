// Integración del catálogo, el seed demo y la historia de precios contra
// PostgreSQL/PostGIS real. Ejecutar con `npm.cmd run test:db`. No usa mocks.
const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const { PrismaService } = require('../../dist/database/prisma.service');
const { CategoryRepository } = require('../../dist/modules/catalog/infrastructure/category.repository');
const { ProductRepository } = require('../../dist/modules/catalog/infrastructure/product.repository');
const { CanonicalProductRepository } = require('../../dist/modules/catalog/infrastructure/canonical-product.repository');
const { StoreRepository } = require('../../dist/modules/stores/infrastructure/store.repository');
const { StoreProximityRepository } = require('../../dist/modules/stores/infrastructure/store-proximity.repository');
const { ProductPriceRepository } = require('../../dist/modules/prices/infrastructure/product-price.repository');
const { GetCurrentPricesUseCase } = require('../../dist/modules/prices/application/get-current-prices.use-case');
const { RecordPriceObservationUseCase } = require('../../dist/modules/prices/application/record-price-observation.use-case');
const {
  seedDemoCatalog,
  demoCategoryId,
  demoCanonicalProductId,
  demoProductId,
  demoStoreId,
} = require('../../dist/seed/seed-demo-catalog');
const { DEMO_SOURCE } = require('../../dist/seed/demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

/**
 * Ancla en el mediodía UTC de hoy: la historia demo se mueve con el reloj, así que
 * las aserciones son relativas al ancla y no caducan. Otros archivos de integración
 * cargan el mismo dataset; el seed es idempotente y las fechas coinciden.
 */
const now = new Date();
const ANCHOR = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
const HISTORY_DAYS = 31;
const MS_PER_DAY = 86_400_000;
/** Instante de la observación de hace `offset` días (negativo = futuro). */
const dayAt = (offset) => new Date(ANCHOR.getTime() - offset * MS_PER_DAY);
const dayKey = (offset) => dayAt(offset).toISOString().slice(0, 10);
const config = { prices: { maxAgeDays: 7, sourcePrecedence: [] } };

let prisma;
let prices;
let currentPrices;
let firstRun;
before(async () => {
  prisma = new PrismaService(url);
  prices = new ProductPriceRepository(prisma);
  currentPrices = new GetCurrentPricesUseCase(prices, config);
  firstRun = await seedDemoCatalog(prisma, { anchorDate: ANCHOR, historyDays: HISTORY_DAYS });
});
after(async () => {
  await prisma?.$disconnect();
});

describe('seed demo', () => {
  test('carga catálogo, sucursales e historia con datos marcados como ficticios', async () => {
    assert.equal(firstRun.anchorDate, dayKey(0));
    assert.equal(firstRun.source, DEMO_SOURCE);
    assert.ok(firstRun.observationsGenerated > 5000, 'la historia demo debería tener miles de observaciones');

    const [categories, canonical, products, chains, stores] = await Promise.all([
      prisma.category.count(),
      prisma.canonicalProduct.count(),
      prisma.product.count(),
      prisma.storeChain.count(),
      prisma.store.count(),
    ]);
    assert.deepEqual(
      { categories, canonical, products, chains, stores },
      {
        categories: firstRun.categories,
        canonical: firstRun.canonicalProducts,
        products: firstRun.products,
        chains: firstRun.chains,
        stores: firstRun.stores,
      },
    );

    // Todo el dataset es identificable como demo, por nombre y por fuente.
    const demoStore = await prisma.store.findUnique({ where: { id: demoStoreId('coto-caballito') } });
    assert.match(demoStore.name, /\(DEMO\)$/);
    const demoProduct = await prisma.product.findUnique({ where: { id: demoProductId('arroz-pampa-1kg') } });
    assert.match(demoProduct.name, /\(DEMO\)$/);
    const sources = await prisma.productPrice.groupBy({ by: ['source'] });
    assert.deepEqual(sources.map((row) => row.source), [DEMO_SOURCE]);
    const batches = await prisma.productPrice.groupBy({ by: ['importBatchId'] });
    assert.deepEqual(batches.map((row) => row.importBatchId), [`${DEMO_SOURCE}:${dayKey(0)}`]);
  });

  test('correrlo de nuevo no duplica nada ni reescribe la historia', async () => {
    const before = {
      observations: await prisma.productPrice.count(),
      products: await prisma.product.count(),
      stores: await prisma.store.count(),
      categories: await prisma.category.count(),
    };
    const sample = await prisma.productPrice.findFirst({ orderBy: { id: 'asc' } });

    const secondRun = await seedDemoCatalog(prisma, { anchorDate: ANCHOR, historyDays: HISTORY_DAYS });
    assert.equal(secondRun.observationsGenerated, firstRun.observationsGenerated);
    assert.equal(secondRun.observationsInserted, 0);

    assert.deepEqual(
      {
        observations: await prisma.productPrice.count(),
        products: await prisma.product.count(),
        stores: await prisma.store.count(),
        categories: await prisma.category.count(),
      },
      before,
    );
    const after = await prisma.productPrice.findUnique({ where: { id: sample.id } });
    assert.equal(after.price.toFixed(2), sample.price.toFixed(2));
    assert.equal(after.ingestedAt.getTime(), sample.ingestedAt.getTime());
  });

  test('conserva un historial diario con fuente y fecha visibles', async () => {
    const productId = demoProductId('arroz-pampa-1kg');
    const storeId = demoStoreId('coto-caballito');
    const history = await prices.findHistory(productId, storeId, { from: dayAt(HISTORY_DAYS - 1), to: dayAt(0), limit: 1000 });
    assert.equal(history.length, HISTORY_DAYS);
    assert.equal(history[0].observedAt.toISOString(), dayAt(0).toISOString());
    assert.equal(history.at(-1).observedAt.toISOString(), dayAt(HISTORY_DAYS - 1).toISOString());
    for (const observation of history) {
      assert.equal(observation.source, DEMO_SOURCE);
      assert.equal(observation.currency, 'ARS');
      assert.match(observation.price, /^\d+\.\d{2}$/);
      assert.match(observation.unitPrice, /^\d+\.\d{6}$/);
    }
    // Las fechas no se repiten: una observación por día observado.
    const days = history.map((observation) => observation.observedAt.toISOString().slice(0, 10));
    assert.equal(new Set(days).size, history.length);

    const ranged = await prices.findHistory(productId, storeId, { from: dayAt(6), to: dayAt(0) });
    assert.equal(ranged.length, 7);
  });

  test('normaliza el precio por unidad base según la presentación', async () => {
    const [kilo, medio] = await Promise.all([
      prices.findHistory(demoProductId('arroz-pampa-1kg'), demoStoreId('coto-caballito'), { limit: 1 }),
      prices.findHistory(demoProductId('arroz-pampa-500g'), demoStoreId('coto-caballito'), { limit: 1 }),
    ]);
    assert.equal(kilo[0].unitPriceUnit, 'KG');
    assert.equal(Number(kilo[0].unitPrice).toFixed(2), Number(kilo[0].price).toFixed(2));
    // 500 g: el precio por kilo duplica el precio del paquete.
    assert.equal(Number(medio[0].unitPrice).toFixed(2), (Number(medio[0].price) * 2).toFixed(2));

    const pack = await prices.findHistory(demoProductId('gaseosa-cola-pack6'), demoStoreId('coto-caballito'), { limit: 1 });
    assert.equal(pack[0].unitPriceUnit, 'L');
    // El pack cotiza por sus 13,5 L totales, no por seis veces 2,25 L.
    assert.equal(Number(pack[0].unitPrice).toFixed(4), (Number(pack[0].price) / 13.5).toFixed(4));
  });
});

describe('precio actual y frescura', () => {
  test('elige la última observación de cada sucursal y marca las desactualizadas', async () => {
    const views = await currentPrices.execute(demoProductId('leche-vallealto-sachet'), { now: ANCHOR });
    // `now` es el mediodía UTC del ancla: las sucursales diarias quedan en cero días.
    assert.ok(views.length >= 5);
    const byStore = new Map(views.map((view) => [view.storeId, view]));
    assert.equal(byStore.size, views.length, 'una sola fila por sucursal');

    // Sucursal que dejó de informar hace 12 días: se muestra con su fecha y como vieja.
    const stale = byStore.get(demoStoreId('disco-belgrano'));
    if (stale) {
      assert.equal(stale.freshness.ageDays, 12);
      assert.equal(stale.freshness.isStale, true);
      assert.equal(stale.observedAt.toISOString(), dayAt(12).toISOString());
    }
    const daily = byStore.get(demoStoreId('coto-caballito'));
    assert.equal(daily.freshness.ageDays, 0);
    assert.equal(daily.freshness.isStale, false);
    assert.equal(daily.source, DEMO_SOURCE);

    // Orden estable: primero el más barato por unidad base.
    const unitPrices = views.map((view) => Number(view.unitPrice));
    assert.deepEqual(unitPrices, [...unitPrices].sort((a, b) => a - b));
    assert.equal(views[0].unitPriceUnit, 'L');
    assert.equal(views[0].unitPricePer100g, null);
  });

  test('filtra por sucursal, respeta el umbral y presenta el precio por 100 g', async () => {
    const storeIds = [demoStoreId('coto-caballito'), demoStoreId('jumbo-palermo')];
    const filtered = await currentPrices.execute(demoProductId('queso-cremoso-granel'), { now: ANCHOR, storeIds });
    assert.ok(filtered.length <= 2);
    for (const view of filtered) {
      assert.ok(storeIds.includes(view.storeId));
      assert.equal(view.unitPriceUnit, 'KG');
      // El precio por 100 g es el precio por kilo dividido diez.
      assert.equal(Number(view.unitPricePer100g).toFixed(4), (Number(view.unitPrice) / 10).toFixed(4));
    }

    const product = demoProductId('arroz-pampa-1kg');
    const withStale = await currentPrices.execute(product, { now: ANCHOR, maxAgeDays: 1 });
    const onlyFresh = await currentPrices.execute(product, { now: ANCHOR, maxAgeDays: 1, includeStale: false });
    assert.ok(onlyFresh.length <= withStale.length);
    assert.equal(onlyFresh.every((view) => !view.freshness.isStale), true);
    // Con un umbral muy chico, toda la vista queda vieja salvo las observaciones de hoy.
    const ancient = await currentPrices.execute(product, { now: dayAt(-400) });
    assert.equal(ancient.every((view) => view.freshness.isStale), true);
  });
});

describe('historia append-only', () => {
  test('un reintento con la misma clave no crea ni modifica observaciones', async () => {
    const productId = demoProductId('harina-pampa-1kg');
    const storeId = demoStoreId('jumbo-palermo');
    const recordObservation = new RecordPriceObservationUseCase(
      new ProductRepository(prisma),
      new CanonicalProductRepository(prisma),
      prices,
    );
    const existing = (await prices.findHistory(productId, storeId, { limit: 1 }))[0];
    const before = await prices.countByProduct(productId);

    const duplicate = await recordObservation.execute({
      productId,
      storeId,
      price: existing.price,
      source: existing.source,
      observedAt: existing.observedAt,
      externalId: existing.idempotencyKey,
    });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.observation.id, existing.id);

    // Misma clave con otro importe: se informa el conflicto y se conserva lo guardado.
    const conflict = await recordObservation.execute({
      productId,
      storeId,
      price: '99999.00',
      source: existing.source,
      observedAt: existing.observedAt,
      externalId: existing.idempotencyKey,
    });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.observation.price, existing.price);
    assert.equal(await prices.countByProduct(productId), before);

    // Otro día sí es una observación nueva y no pisa la anterior.
    const newDay = dayAt(-1);
    const created = await recordObservation.execute({
      productId,
      storeId,
      price: '1234.50',
      source: 'test-manual',
      observedAt: newDay,
    });
    assert.equal(created.status, 'created');
    assert.equal(created.observation.unitPrice, '1234.500000');
    assert.equal(await prices.countByProduct(productId), before + 1);
    const current = await currentPrices.execute(productId, { now: newDay, storeIds: [storeId] });
    assert.equal(current[0].price, '1234.50');
    assert.equal(current[0].source, 'test-manual');
  });

  test('la base rechaza modificar o borrar una observación', async () => {
    const observation = await prisma.productPrice.findFirst({ orderBy: { id: 'asc' } });
    // El trigger usa ERRCODE restrict_violation (23001) y Prisma lo reporta como P2003:
    // lo que importa acá es que la escritura se rechace y la observación no cambie.
    await assert.rejects(prisma.productPrice.update({ where: { id: observation.id }, data: { price: '1.00' } }));
    await assert.rejects(prisma.productPrice.delete({ where: { id: observation.id } }));
    const after = await prisma.productPrice.findUnique({ where: { id: observation.id } });
    assert.equal(after.price.toFixed(2), observation.price.toFixed(2));
  });
});

describe('catálogo y comercios', () => {
  test('la consulta espacial usa metros y excluye sucursales sin coordenadas', async () => {
    const proximity = new StoreProximityRepository(prisma);
    // Caballito, 5 km.
    const nearby = await proximity.findActiveWithin({ latitude: -34.6187, longitude: -58.4407 }, 5_000);
    const ids = nearby.map((store) => store.storeId);
    assert.ok(ids.includes(demoStoreId('coto-caballito')));
    assert.equal(ids.includes(demoStoreId('vea-moron')), false, 'sin coordenadas no puede entrar en un radio');
    assert.equal(ids.includes(demoStoreId('coto-lanus')), false, 'Lanús está a más de 5 km de Caballito');
    const distances = nearby.map((store) => store.distanceMeters);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
    assert.ok(distances.every((meters) => meters <= 5_000));

    const wider = await proximity.findActiveWithin({ latitude: -34.6187, longitude: -58.4407 }, 15_000);
    assert.ok(wider.length > nearby.length);

    const stores = new StoreRepository(prisma);
    const moron = await stores.findById(demoStoreId('vea-moron'));
    assert.equal(moron.latitude, null);
    assert.equal(moron.longitude, null);
    const byCity = await stores.listActiveByCity('Buenos Aires', 'Morón');
    assert.deepEqual(byCity.map((store) => store.id), [demoStoreId('vea-moron')]);
  });

  test('el catálogo agrupa alternativas y valida dimensión y ciclos', async () => {
    const products = new ProductRepository(prisma);
    const alternatives = await products.listByCanonicalProduct(demoCanonicalProductId('arroz-largo-fino'));
    assert.equal(alternatives.length, 3);
    assert.deepEqual(
      alternatives.map((product) => product.unit).sort(),
      ['G', 'KG', 'KG'],
    );
    const found = await products.searchByName('arroz largo fino');
    assert.ok(found.length >= 3);
    const packaged = await products.findById(demoProductId('gaseosa-cola-pack6'));
    assert.equal(packaged.quantity, '13.5');
    assert.equal(packaged.packageCount, 6);
    const bulk = await products.findById(demoProductId('queso-cremoso-granel'));
    assert.equal(bulk.saleMode, 'VARIABLE_WEIGHT');
    assert.equal(bulk.ean, null);

    // Un producto en litros no puede agruparse con un canónico en kilos.
    await assert.rejects(
      products.upsert({
        id: demoProductId('arroz-pampa-1kg'),
        name: 'Arroz en litros (inválido)',
        categoryId: demoCategoryId('almacen'),
        canonicalProductId: demoCanonicalProductId('arroz-largo-fino'),
        quantity: '1',
        unit: 'L',
      }),
      (error) => error.code === 'DIMENSION_MISMATCH',
    );

    const categories = new CategoryRepository(prisma);
    await assert.rejects(
      categories.upsert({
        id: demoCategoryId('alimentos'),
        name: 'Alimentos',
        slug: 'alimentos',
        parentId: demoCategoryId('almacen'),
      }),
      (error) => error.code === 'CATEGORY_CYCLE',
    );
    const children = await categories.listChildren(demoCategoryId('alimentos'));
    assert.deepEqual(children.map((category) => category.slug).sort(), ['almacen', 'carnes', 'frutas-y-verduras', 'lacteos']);
  });
});
