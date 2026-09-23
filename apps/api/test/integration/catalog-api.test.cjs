// API pública de catálogo y precios (P2-02) contra PostgreSQL/PostGIS real y el
// dataset DEMO. Ejecutar con `npm.cmd run test:db`. No usa mocks.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
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

/**
 * La frescura se calcula contra el reloj real, así que el dataset se ancla en el
 * día de hoy: las sucursales diarias quedan con 0 días de antigüedad y la que dejó
 * de informar, con 12. El seed es idempotente, no duplica lo que ya cargó otro test.
 */
// Misma ancla que usa el seed por defecto: el último mediodía UTC ya transcurrido.
const ANCHOR = latestObservationAnchor();
const CABA = 'Ciudad Autónoma de Buenos Aires';
// Caballito: cerca de Coto Caballito, lejos de Lanús.
const ORIGIN = { latitude: -34.6187, longitude: -58.4407 };

const PRODUCT_KEYS = ['id', 'ean', 'name', 'brand', 'categoryId', 'canonicalProductId', 'quantity', 'unit', 'saleMode', 'packageCount'];
// Desde P3-02 cada resultado de búsqueda trae además su mejor oferta.
const SEARCH_ITEM_KEYS = [...PRODUCT_KEYS, 'bestOffer'];
const STORE_KEYS = ['id', 'chainId', 'chainName', 'name', 'address', 'city', 'province', 'latitude', 'longitude', 'distanceMeters'];
const PRICE_KEYS = ['store', 'price', 'currency', 'unitPrice', 'unitPriceUnit', 'unitPricePer100g', 'source', 'freshness'];

let app;
let server;
let prisma;
before(async () => {
  prisma = new PrismaService(url);
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
});
after(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

const get = (path) => request(server).get(path);
const keysOf = (value) => Object.keys(value).sort();

/** Un error público nombra propiedades, nunca valores. */
async function expectValidationError(path, fields) {
  const response = await get(path).expect(400);
  assert.equal(response.body.error, 'VALIDATION_FAILED');
  assert.deepEqual(response.body.fields, fields, path);
  return response.body;
}

describe('GET /api/products', () => {
  test('pagina por cursor con orden estable y sin repetir resultados', async () => {
    const first = await get('/api/products?limit=3').expect(200);
    assert.equal(first.body.items.length, 3);
    assert.equal(first.body.page.limit, 3);
    assert.ok(first.body.page.nextCursor);
    assert.deepEqual(keysOf(first.body.items[0]), SEARCH_ITEM_KEYS.slice().sort());

    const second = await get(`/api/products?limit=3&cursor=${encodeURIComponent(first.body.page.nextCursor)}`).expect(200);
    const firstIds = first.body.items.map((product) => product.id);
    const secondIds = second.body.items.map((product) => product.id);
    assert.equal(secondIds.some((id) => firstIds.includes(id)), false, 'una página no repite la anterior');
    // Orden alfabético estable entre páginas.
    const names = [...first.body.items, ...second.body.items].map((product) => product.name.toLowerCase());
    assert.deepEqual(names, [...names].sort());

    const full = await get('/api/products?limit=50').expect(200);
    assert.equal(full.body.page.nextCursor, null);
    assert.ok(full.body.items.length >= 28);
  });

  test('filtra por texto y por agrupación, y rechaza filtros inválidos', async () => {
    const search = await get('/api/products?search=arroz').expect(200);
    assert.ok(search.body.items.length >= 3);
    assert.equal(search.body.items.every((product) => /arroz/i.test(product.name)), true);

    const byCanonical = await get(`/api/products?canonicalProductId=${demoCanonicalProductId('arroz-largo-fino')}`).expect(200);
    assert.equal(byCanonical.body.items.length, 3);

    const empty = await get('/api/products?search=producto-que-no-existe').expect(200);
    // Desde P3-01 la respuesta informa además con qué alcance se buscó.
    assert.deepEqual(empty.body, {
      items: [],
      page: { limit: 20, nextCursor: null },
      scope: { origin: 'ALL', radiusKm: null, storesConsidered: null },
    });

    await expectValidationError('/api/products?search=a', ['search']);
    await expectValidationError('/api/products?limit=0', ['limit']);
    await expectValidationError('/api/products?limit=51', ['limit']);
    await expectValidationError('/api/products?limit=abc', ['limit']);
    await expectValidationError('/api/products?categoryId=no-es-uuid', ['categoryId']);
    await expectValidationError('/api/products?cursor=no-es-un-cursor', ['cursor']);
    // Un filtro mal escrito falla en vez de ignorarse en silencio.
    await expectValidationError('/api/products?categoriaId=x', ['categoriaId']);
  });
});

describe('GET /api/products/:id', () => {
  test('devuelve la presentación con su categoría y su canónico', async () => {
    const response = await get(`/api/products/${demoProductId('gaseosa-cola-pack6')}`).expect(200);
    const product = response.body;
    assert.deepEqual(keysOf(product), [...PRODUCT_KEYS, 'category', 'canonicalProduct'].sort());
    assert.equal(product.quantity, '13.5');
    assert.equal(product.packageCount, 6);
    assert.equal(product.unit, 'L');
    assert.equal(product.saleMode, 'PACKAGED');
    assert.deepEqual(keysOf(product.category), ['id', 'name', 'parentId', 'slug']);
    assert.deepEqual(keysOf(product.canonicalProduct), ['categoryId', 'defaultUnit', 'id', 'name']);
    assert.equal(product.canonicalProduct.defaultUnit, 'L');
    // No se filtran campos internos de Prisma ni de búsqueda.
    assert.equal('normalizedName' in product, false);
    assert.equal('isActive' in product, false);

    const bulk = await get(`/api/products/${demoProductId('queso-cremoso-granel')}`).expect(200);
    assert.equal(bulk.body.saleMode, 'VARIABLE_WEIGHT');
    assert.equal(bulk.body.ean, null);
    assert.equal(bulk.body.brand, null);
  });

  test('distingue identificador inválido de producto inexistente', async () => {
    const missing = await get(`/api/products/${randomUUID()}`).expect(404);
    assert.deepEqual(missing.body, {
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'No encontramos ese producto.',
    });
    await expectValidationError('/api/products/no-es-uuid', ['id']);
  });
});

describe('GET /api/products/:id/prices', () => {
  const arroz = () => demoProductId('arroz-pampa-1kg');

  test('un precio actual por sucursal, del más barato por unidad base al más caro', async () => {
    const response = await get(`/api/products/${arroz()}/prices`).expect(200);
    const { product, scope, prices } = response.body;
    assert.equal(product.id, arroz());
    assert.deepEqual(scope, {
      origin: 'ALL',
      radiusKm: null,
      distancesAvailable: false,
      storesConsidered: prices.length,
      maxAgeDays: 7,
      includeStale: true,
    });
    assert.ok(prices.length >= 5);
    assert.equal(new Set(prices.map((entry) => entry.store.id)).size, prices.length, 'una fila por sucursal');

    const unitPrices = prices.map((entry) => Number(entry.unitPrice));
    assert.deepEqual(unitPrices, [...unitPrices].sort((a, b) => a - b));
    for (const entry of prices) {
      assert.deepEqual(keysOf(entry), PRICE_KEYS.slice().sort());
      assert.deepEqual(keysOf(entry.store), STORE_KEYS.slice().sort());
      assert.deepEqual(keysOf(entry.freshness), ['ageDays', 'isStale', 'maxAgeDays', 'observedAt']);
      assert.match(entry.price, /^\d+\.\d{2}$/);
      assert.match(entry.unitPrice, /^\d+\.\d{6}$/);
      assert.equal(entry.currency, 'ARS');
      assert.equal(entry.unitPriceUnit, 'KG');
      // Precio por 100 g disponible solo para masa.
      assert.equal(Number(entry.unitPricePer100g).toFixed(4), (Number(entry.unitPrice) / 10).toFixed(4));
      assert.equal(entry.source, 'demo-seed');
      assert.match(entry.freshness.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Sin coordenadas en la consulta, no se informa distancia.
      assert.equal(entry.store.distanceMeters, null);
      assert.ok(entry.store.chainName.length > 0);
    }

    const litros = await get(`/api/products/${demoProductId('leche-vallealto-sachet')}/prices`).expect(200);
    assert.equal(litros.body.prices[0].unitPriceUnit, 'L');
    assert.equal(litros.body.prices[0].unitPricePer100g, null);
  });

  test('una presentación más chica es más cara por kilo en la misma sucursal', async () => {
    const [kilo, medio] = await Promise.all([
      get(`/api/products/${demoProductId('arroz-pampa-1kg')}/prices`).expect(200),
      get(`/api/products/${demoProductId('arroz-pampa-500g')}/prices`).expect(200),
    ]);
    const kiloByStore = new Map(kilo.body.prices.map((entry) => [entry.store.id, Number(entry.unitPrice)]));
    const compared = medio.body.prices.filter((entry) => kiloByStore.has(entry.store.id));
    assert.ok(compared.length >= 3, 'ambas presentaciones deberían compartir sucursales');
    for (const entry of compared) {
      assert.ok(
        Number(entry.unitPrice) > kiloByStore.get(entry.store.id),
        `500 g debería ser más caro por kilo en ${entry.store.name}`,
      );
    }
  });

  test('acota por coordenadas y radio en kilómetros, con distancia verificable', async () => {
    const response = await get(
      `/api/products/${arroz()}/prices?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=5`,
    ).expect(200);
    assert.equal(response.body.scope.origin, 'COORDINATES');
    assert.equal(response.body.scope.radiusKm, 5);
    assert.equal(response.body.scope.distancesAvailable, true);
    const ids = response.body.prices.map((entry) => entry.store.id);
    assert.ok(ids.includes(demoStoreId('coto-caballito')));
    assert.equal(ids.includes(demoStoreId('coto-lanus')), false, 'Lanús está a más de 5 km');
    assert.equal(ids.includes(demoStoreId('vea-moron')), false, 'sin coordenadas no entra en un radio');
    for (const entry of response.body.prices) {
      // El origen coincide con una de las sucursales demo: cero metros es válido.
      assert.ok(entry.store.distanceMeters >= 0 && entry.store.distanceMeters <= 5_000);
    }

    // El radio se convierte a metros: 15 km alcanza más sucursales que 5 km.
    // Se compara el alcance, no la cantidad de precios: no todas venden el producto.
    const wider = await get(
      `/api/products/${arroz()}/prices?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=15`,
    ).expect(200);
    assert.ok(wider.body.scope.storesConsidered > response.body.scope.storesConsidered);
    assert.equal(wider.body.scope.radiusKm, 15);
    assert.ok(wider.body.prices.length >= response.body.prices.length);
  });

  test('por localidad lista sucursales sin afirmar distancia', async () => {
    const response = await get(
      `/api/products/${arroz()}/prices?city=${encodeURIComponent('Morón')}&province=${encodeURIComponent('Buenos Aires')}`,
    ).expect(200);
    assert.equal(response.body.scope.origin, 'LOCALITY');
    assert.equal(response.body.scope.radiusKm, null);
    assert.equal(response.body.scope.distancesAvailable, false);
    assert.deepEqual(response.body.prices.map((entry) => entry.store.id), [demoStoreId('vea-moron')]);
    assert.equal(response.body.prices[0].store.distanceMeters, null);
    assert.equal(response.body.prices[0].store.latitude, null);

    // Una localidad sin sucursales no es lo mismo que un producto sin precios.
    const nowhere = await get('/api/products/' + arroz() + '/prices?city=Nada&province=Nada').expect(200);
    assert.deepEqual(nowhere.body.prices, []);
    assert.equal(nowhere.body.scope.storesConsidered, 0);
  });

  test('muestra los precios desactualizados con su fecha y permite excluirlos', async () => {
    const all = await get(`/api/products/${demoProductId('leche-vallealto-sachet')}/prices`).expect(200);
    const stale = all.body.prices.find((entry) => entry.store.id === demoStoreId('disco-belgrano'));
    if (stale) {
      // Esa sucursal dejó de informar hace 12 días: se muestra, marcada y fechada.
      assert.equal(stale.freshness.isStale, true);
      assert.ok(stale.freshness.ageDays >= 8, `antigüedad inesperada: ${stale.freshness.ageDays}`);
      assert.equal(stale.freshness.maxAgeDays, 7);
    }
    const daily = all.body.prices.find((entry) => entry.store.id === demoStoreId('coto-caballito'));
    assert.equal(daily.freshness.ageDays, 0);
    assert.equal(daily.freshness.isStale, false);

    const fresh = await get(`/api/products/${demoProductId('leche-vallealto-sachet')}/prices?includeStale=false`).expect(200);
    assert.equal(fresh.body.scope.includeStale, false);
    assert.equal(fresh.body.prices.every((entry) => !entry.freshness.isStale), true);
    assert.ok(fresh.body.prices.length <= all.body.prices.length);
  });

  test('rechaza alcances incompletos o fuera de rango', async () => {
    await expectValidationError(`/api/products/${arroz()}/prices?latitude=${ORIGIN.latitude}`, ['latitude', 'longitude']);
    await expectValidationError(`/api/products/${arroz()}/prices?radiusKm=5`, ['radiusKm']);
    await expectValidationError(`/api/products/${arroz()}/prices?latitude=999&longitude=0`, ['latitude']);
    await expectValidationError(`/api/products/${arroz()}/prices?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=500`, ['radiusKm']);
    await expectValidationError(`/api/products/${arroz()}/prices?city=Lomas`, ['city', 'province']);
    await expectValidationError(`/api/products/${arroz()}/prices?includeStale=quizas`, ['includeStale']);
    await get(`/api/products/${randomUUID()}/prices`).expect(404);
  });
});

describe('GET /api/canonical-products', () => {
  test('lista necesidades equivalentes y sus alternativas', async () => {
    const list = await get('/api/canonical-products?search=arroz').expect(200);
    assert.equal(list.body.items.length, 1);
    assert.deepEqual(keysOf(list.body.items[0]), ['categoryId', 'defaultUnit', 'id', 'name']);

    const detail = await get(`/api/canonical-products/${demoCanonicalProductId('arroz-largo-fino')}`).expect(200);
    assert.deepEqual(keysOf(detail.body), ['category', 'categoryId', 'defaultUnit', 'id', 'name', 'products']);
    assert.equal(detail.body.defaultUnit, 'KG');
    assert.equal(detail.body.products.length, 3);
    // Todas las alternativas se miden en la misma dimensión que su canónico.
    assert.equal(detail.body.products.every((product) => ['KG', 'G'].includes(product.unit)), true);
    assert.deepEqual(keysOf(detail.body.products[0]), PRODUCT_KEYS.slice().sort());

    const paged = await get('/api/canonical-products?limit=5').expect(200);
    assert.equal(paged.body.items.length, 5);
    assert.ok(paged.body.page.nextCursor);
    await get(`/api/canonical-products/${randomUUID()}`).expect(404);
    await expectValidationError('/api/canonical-products?search=a', ['search']);
  });
});

describe('GET /api/stores', () => {
  test('pagina alfabéticamente y filtra por cadena y localidad', async () => {
    const first = await get('/api/stores?limit=4').expect(200);
    assert.equal(first.body.items.length, 4);
    assert.deepEqual(keysOf(first.body.items[0]), STORE_KEYS.slice().sort());
    const names = first.body.items.map((store) => store.name);
    assert.deepEqual(names, [...names].sort());
    assert.ok(first.body.page.nextCursor);

    const second = await get(`/api/stores?limit=4&cursor=${encodeURIComponent(first.body.page.nextCursor)}`).expect(200);
    assert.equal(second.body.items.some((store) => names.includes(store.name)), false);

    const caba = await get(`/api/stores?province=${encodeURIComponent(CABA)}&city=${encodeURIComponent(CABA)}`).expect(200);
    assert.ok(caba.body.items.length >= 4);
    assert.equal(caba.body.items.every((store) => store.city === CABA), true);

    const byChain = await get(`/api/stores?search=${encodeURIComponent('Vea')}`).expect(200);
    assert.equal(byChain.body.items.length, 2);
    assert.equal(byChain.body.items.every((store) => store.chainName === 'Vea'), true);
  });

  test('por cercanía ordena por distancia y no acepta cursor', async () => {
    const nearby = await get(`/api/stores?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=15`).expect(200);
    const distances = nearby.body.items.map((store) => store.distanceMeters);
    assert.ok(distances.length >= 3);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
    assert.ok(distances.every((meters) => meters <= 15_000));
    assert.equal(nearby.body.page.nextCursor, null);
    assert.equal(nearby.body.items.some((store) => store.id === demoStoreId('vea-moron')), false);

    await expectValidationError(
      `/api/stores?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&cursor=${encodeURIComponent('abc')}`,
      ['cursor'],
    );
    await expectValidationError(`/api/stores?longitude=${ORIGIN.longitude}`, ['latitude', 'longitude']);
    await expectValidationError('/api/stores?radiusKm=3', ['radiusKm']);
  });

  test('una sucursal sin coordenadas se devuelve sin distancia', async () => {
    const response = await get(`/api/stores/${demoStoreId('vea-moron')}`).expect(200);
    assert.deepEqual(keysOf(response.body), STORE_KEYS.slice().sort());
    assert.equal(response.body.latitude, null);
    assert.equal(response.body.longitude, null);
    assert.equal(response.body.distanceMeters, null);
    assert.equal(response.body.chainName, 'Vea');
    assert.match(response.body.name, /\(DEMO\)$/);

    const withCoordinates = await get(`/api/stores/${demoStoreId('coto-caballito')}`).expect(200);
    assert.match(withCoordinates.body.latitude, /^-34\.\d+$/);
    assert.equal(Number(withCoordinates.body.latitude).toFixed(4), '-34.6187');
    await get(`/api/stores/${randomUUID()}`).expect(404);
    await expectValidationError('/api/stores/no-es-uuid', ['id']);
  });
});
