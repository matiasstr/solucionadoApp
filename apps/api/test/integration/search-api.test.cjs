// Búsqueda y comparación (P3-01) contra PostgreSQL/PostGIS real y el dataset DEMO.
// Ejecutar con `npm.cmd run test:db`. No usa mocks.
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
  demoChainId,
  demoProductId,
  demoPromotionId,
  demoStoreId,
} = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

// Misma ancla que usa el seed por defecto: el último mediodía UTC ya transcurrido.
const ANCHOR = latestObservationAnchor();
const CABA = 'Ciudad Autónoma de Buenos Aires';
// Caballito: Coto Caballito a 0 m, Lanús fuera de 5 km.
const ORIGIN = { latitude: -34.6187, longitude: -58.4407 };
const OFFER_KEYS = ['product', 'matchType', 'store', 'price', 'currency', 'unitPrice', 'unitPriceUnit', 'unitPricePer100g', 'source', 'freshness', 'promotion'];

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
const namesOf = (response) => response.body.items.map((product) => product.name);

async function expectValidationError(path, fields) {
  const response = await get(path).expect(400);
  assert.equal(response.body.error, 'VALIDATION_FAILED');
  assert.deepEqual(response.body.fields, fields, path);
}

describe('GET /api/products — búsqueda', () => {
  test('encuentra con y sin tildes, y no confunde una cadena sin contenido con "todo"', async () => {
    const withAccent = await get(`/api/products?search=${encodeURIComponent('azúcar')}`).expect(200);
    const withoutAccent = await get('/api/products?search=azucar').expect(200);
    assert.deepEqual(namesOf(withAccent), namesOf(withoutAccent));
    assert.equal(namesOf(withAccent).length, 1);
    assert.match(namesOf(withAccent)[0], /Azúcar/);

    // Un término que se queda sin letras no devuelve el catálogo entero.
    const punctuation = await get('/api/products?search=--').expect(200);
    assert.deepEqual(punctuation.body.items, []);
    const unknown = await get('/api/products?search=no-existe-este-producto').expect(200);
    assert.deepEqual(unknown.body.items, []);
    await expectValidationError('/api/products?search=a', ['search']);
  });

  test('busca por marca y por código de barras exacto', async () => {
    const byBrand = await get(`/api/products?search=${encodeURIComponent('Del Sur')}&limit=50`).expect(200);
    assert.ok(byBrand.body.items.length >= 3);
    assert.equal(byBrand.body.items.every((product) => product.brand === 'Del Sur'), true);

    const byBrandFilter = await get(`/api/products?brand=${encodeURIComponent('del sur')}&limit=50`).expect(200);
    assert.deepEqual(namesOf(byBrandFilter).sort(), namesOf(byBrand).sort());

    const arroz = await get(`/api/products/${demoProductId('arroz-pampa-1kg')}`).expect(200);
    const byEan = await get(`/api/products?search=${arroz.body.ean}`).expect(200);
    assert.deepEqual(byEan.body.items.map((product) => product.id), [arroz.body.id]);
    // Un EAN inexistente no cae en una búsqueda por texto.
    const missingEan = await get('/api/products?search=2900000009999').expect(200);
    assert.deepEqual(missingEan.body.items, []);
  });

  test('acota por cadena, localidad y cercanía, e informa el alcance aplicado', async () => {
    const all = await get('/api/products?search=arroz&limit=50').expect(200);
    assert.deepEqual(all.body.scope, { origin: 'ALL', radiusKm: null, storesConsidered: null });

    const byChain = await get(`/api/products?chainId=${demoChainId('vea')}&limit=50`).expect(200);
    assert.ok(byChain.body.items.length > 0);
    assert.ok(byChain.body.items.length < 28, 'no todos los productos se venden en Vea');

    const locality = await get(
      `/api/products?city=${encodeURIComponent('Morón')}&province=${encodeURIComponent('Buenos Aires')}&limit=50`,
    ).expect(200);
    assert.equal(locality.body.scope.origin, 'LOCALITY');
    assert.equal(locality.body.scope.storesConsidered, 1);
    assert.equal(locality.body.scope.radiusKm, null);

    const nearby = await get(
      `/api/products?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=5&limit=50`,
    ).expect(200);
    assert.equal(nearby.body.scope.origin, 'COORDINATES');
    assert.equal(nearby.body.scope.radiusKm, 5);
    assert.ok(nearby.body.scope.storesConsidered >= 1);
    // Un radio mayor no puede devolver menos productos.
    const wider = await get(
      `/api/products?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=25&limit=50`,
    ).expect(200);
    assert.ok(wider.body.items.length >= nearby.body.items.length);
    assert.ok(wider.body.scope.storesConsidered > nearby.body.scope.storesConsidered);

    // Una localidad sin sucursales no devuelve productos.
    const nowhere = await get('/api/products?city=Nada&province=Nada&limit=50').expect(200);
    assert.deepEqual(nowhere.body.items, []);
    assert.equal(nowhere.body.scope.storesConsidered, 0);
  });

  test('combina filtros y pagina sin repetir', async () => {
    const combined = await get(
      `/api/products?search=arroz&canonicalProductId=${demoCanonicalProductId('arroz-largo-fino')}&chainId=${demoChainId('coto')}&limit=50`,
    ).expect(200);
    assert.ok(combined.body.items.length >= 1);
    assert.equal(combined.body.items.every((product) => /arroz/i.test(product.name)), true);

    const first = await get(`/api/products?chainId=${demoChainId('jumbo')}&limit=4`).expect(200);
    assert.equal(first.body.items.length, 4);
    const second = await get(
      `/api/products?chainId=${demoChainId('jumbo')}&limit=4&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
    ).expect(200);
    const firstIds = first.body.items.map((product) => product.id);
    assert.equal(second.body.items.some((product) => firstIds.includes(product.id)), false);

    await expectValidationError('/api/products?radiusKm=5', ['radiusKm']);
    await expectValidationError('/api/products?city=Lomas', ['city', 'province']);
    await expectValidationError(`/api/products?latitude=${ORIGIN.latitude}`, ['latitude', 'longitude']);
    await expectValidationError('/api/products?chainId=no-es-uuid', ['chainId']);
  });
});

describe('GET /api/canonical-products/:id/prices — comparación', () => {
  const arrozCanonical = () => demoCanonicalProductId('arroz-largo-fino');

  test('compara todas las presentaciones por unidad base y distingue exacto de alternativa', async () => {
    const response = await get(
      `/api/canonical-products/${arrozCanonical()}/prices?productId=${demoProductId('arroz-pampa-1kg')}&limit=50`,
    ).expect(200);
    const { canonicalProduct, scope, sortBy, offers } = response.body;
    assert.equal(canonicalProduct.id, arrozCanonical());
    assert.equal(canonicalProduct.defaultUnit, 'KG');
    assert.equal(sortBy, 'UNIT_PRICE');
    assert.equal(scope.origin, 'ALL');
    assert.ok(offers.length >= 10, 'tres presentaciones en varias sucursales');

    for (const offer of offers) {
      assert.deepEqual(Object.keys(offer).sort(), OFFER_KEYS.slice().sort());
      // Todas las alternativas comparten unidad base: se pueden comparar.
      assert.equal(offer.unitPriceUnit, 'KG');
      assert.match(offer.unitPrice, /^\d+\.\d{6}$/);
      assert.equal(Number(offer.unitPricePer100g).toFixed(4), (Number(offer.unitPrice) / 10).toFixed(4));
      assert.equal(offer.source, 'demo-seed');
      assert.ok(offer.freshness.observedAt);
      assert.equal(offer.store.distanceMeters, null);
    }
    // El producto por el que se llegó es coincidencia exacta; el resto, alternativas.
    const exact = offers.filter((offer) => offer.matchType === 'EXACT');
    assert.ok(exact.length > 0);
    assert.equal(exact.every((offer) => offer.product.id === demoProductId('arroz-pampa-1kg')), true);
    assert.ok(offers.some((offer) => offer.matchType === 'ALTERNATIVE'));

    // Sin `productId` nada es coincidencia exacta: no se buscó un producto puntual.
    const anonymous = await get(`/api/canonical-products/${arrozCanonical()}/prices?limit=50`).expect(200);
    assert.equal(anonymous.body.offers.every((offer) => offer.matchType === 'ALTERNATIVE'), true);
  });

  test('el orden por envase y por kilo puede diferir', async () => {
    const byUnitPrice = await get(`/api/canonical-products/${arrozCanonical()}/prices?limit=50`).expect(200);
    const byPrice = await get(`/api/canonical-products/${arrozCanonical()}/prices?sortBy=PRICE&limit=50`).expect(200);

    const unitPrices = byUnitPrice.body.offers.map((offer) => Number(offer.unitPrice));
    assert.deepEqual(unitPrices, [...unitPrices].sort((a, b) => a - b));
    const prices = byPrice.body.offers.map((offer) => Number(offer.price));
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
    assert.equal(byPrice.body.sortBy, 'PRICE');

    // El paquete más barato es el de 500 g; el más barato por kilo, uno de 1 kg.
    const cheapestPackage = byPrice.body.offers[0];
    const cheapestPerKg = byUnitPrice.body.offers[0];
    assert.equal(cheapestPackage.product.id, demoProductId('arroz-pampa-500g'));
    assert.notEqual(cheapestPerKg.product.id, cheapestPackage.product.id);
    assert.ok(Number(cheapestPackage.unitPrice) > Number(cheapestPerKg.unitPrice));
  });

  test('ordena por distancia solo cuando hay coordenadas', async () => {
    await expectValidationError(`/api/canonical-products/${arrozCanonical()}/prices?sortBy=DISTANCE`, ['sortBy']);
    await expectValidationError(
      `/api/canonical-products/${arrozCanonical()}/prices?city=${encodeURIComponent(CABA)}&province=${encodeURIComponent(CABA)}&sortBy=DISTANCE`,
      ['sortBy'],
    );

    const byDistance = await get(
      `/api/canonical-products/${arrozCanonical()}/prices?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=15&sortBy=DISTANCE&limit=50`,
    ).expect(200);
    const distances = byDistance.body.offers.map((offer) => offer.store.distanceMeters);
    assert.ok(distances.length > 0);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
    assert.ok(distances.every((meters) => meters !== null && meters <= 15_000));
    assert.equal(byDistance.body.scope.distancesAvailable, true);
  });

  test('muestra la promoción con su cantidad mínima y conserva el precio regular', async () => {
    // 20% en una sucursal puntual: alcanza a una unidad.
    const arroz = await get(
      `/api/canonical-products/${arrozCanonical()}/prices?limit=50&productId=${demoProductId('arroz-pampa-1kg')}`,
    ).expect(200);
    const carrefour = arroz.body.offers.find(
      (offer) =>
        offer.store.id === demoStoreId('carrefour-almagro') && offer.product.id === demoProductId('arroz-pampa-1kg'),
    );
    assert.ok(carrefour, 'Carrefour Almagro vende arroz Pampa 1 kg en el dataset demo');
    assert.equal(carrefour.promotion.id, demoPromotionId('carrefour-arroz-20'));
    assert.equal(carrefour.promotion.type, 'PERCENTAGE');
    assert.equal(carrefour.promotion.minimumQuantity, 1);
    // El precio regular queda para comparar.
    assert.equal(carrefour.promotion.regularTotal, carrefour.price);
    assert.equal(Number(carrefour.promotion.total).toFixed(2), (Number(carrefour.price) * 0.8).toFixed(2));
    assert.ok(Number(carrefour.promotion.promotionalUnitPrice) < Number(carrefour.unitPrice));
    assert.deepEqual(carrefour.promotion.eligibleWeekdays, []);

    // 2x1 de cadena: hay que llevar dos y se paga una.
    const fideos = await get(`/api/canonical-products/${demoCanonicalProductId('fideos-secos')}/prices?limit=50`).expect(200);
    const coto = fideos.body.offers.find(
      (offer) => offer.store.id === demoStoreId('coto-lanus') && offer.product.id === demoProductId('fideos-pampa-500g'),
    );
    assert.ok(coto, 'Coto Lanús vende fideos Pampa 500 g en el dataset demo');
    assert.equal(coto.promotion.id, demoPromotionId('coto-fideos-2x1'));
    assert.equal(coto.promotion.minimumQuantity, 2);
    assert.equal(Number(coto.promotion.regularTotal).toFixed(2), (Number(coto.price) * 2).toFixed(2));
    assert.equal(coto.promotion.total, coto.price);
    assert.equal(Number(coto.promotion.discount).toFixed(2), Number(coto.price).toFixed(2));
    // El precio por kilo con promoción es la mitad del regular.
    assert.equal(
      Number(coto.promotion.promotionalUnitPrice).toFixed(4),
      (Number(coto.unitPrice) / 2).toFixed(4),
    );

    // Precio fijo llevando dos.
    const yerba = await get(`/api/canonical-products/${demoCanonicalProductId('yerba-mate')}/prices?limit=50`).expect(200);
    const disco = yerba.body.offers.find(
      (offer) =>
        offer.store.id === demoStoreId('disco-villa-urquiza') && offer.product.id === demoProductId('yerba-nuestra-500g'),
    );
    assert.ok(disco);
    assert.equal(disco.promotion.type, 'FIXED_PRICE');
    assert.equal(disco.promotion.minimumQuantity, 2);
    assert.equal(disco.promotion.total, '5980.00');

    // Una oferta sin promoción aplicable no inventa ninguna.
    assert.ok(arroz.body.offers.some((offer) => offer.promotion === null));
  });

  test('una promoción bancaria no aparece como precio de la oferta', async () => {
    const response = await get(`/api/canonical-products/${arrozCanonical()}/prices?limit=50`).expect(200);
    const carrefourSanMartin = response.body.offers.find((offer) => offer.store.id === demoStoreId('carrefour-san-martin'));
    // La bancaria alcanza a toda la cadena Carrefour, pero no se aplica sola.
    if (carrefourSanMartin) {
      assert.equal(carrefourSanMartin.promotion, null);
    }
  });

  test('respeta la frescura, el límite y el canónico inexistente', async () => {
    const withStale = await get(`/api/canonical-products/${arrozCanonical()}/prices?limit=50`).expect(200);
    const fresh = await get(`/api/canonical-products/${arrozCanonical()}/prices?includeStale=false&limit=50`).expect(200);
    assert.equal(fresh.body.scope.includeStale, false);
    assert.equal(fresh.body.offers.every((offer) => !offer.freshness.isStale), true);
    assert.ok(fresh.body.offers.length <= withStale.body.offers.length);
    // La sucursal que dejó de informar sigue visible con su fecha si no se la excluye.
    const stale = withStale.body.offers.filter((offer) => offer.freshness.isStale);
    assert.ok(stale.every((offer) => offer.freshness.ageDays > offer.freshness.maxAgeDays));

    const limited = await get(`/api/canonical-products/${arrozCanonical()}/prices?limit=2`).expect(200);
    assert.equal(limited.body.offers.length, 2);

    await get(`/api/canonical-products/${randomUUID()}/prices`).expect(404);
    await expectValidationError('/api/canonical-products/no-es-uuid/prices', ['id']);
    await expectValidationError(`/api/canonical-products/${arrozCanonical()}/prices?sortBy=BARATO`, ['sortBy']);
  });
});

describe('GET /api/products/:id/prices — orden', () => {
  test('acepta los mismos criterios de orden que la comparación', async () => {
    const productId = demoProductId('leche-vallealto-sachet');
    const byUnitPrice = await get(`/api/products/${productId}/prices`).expect(200);
    assert.equal(byUnitPrice.body.sortBy, 'UNIT_PRICE');

    const byPrice = await get(`/api/products/${productId}/prices?sortBy=PRICE`).expect(200);
    const prices = byPrice.body.prices.map((entry) => Number(entry.price));
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

    const byDistance = await get(
      `/api/products/${productId}/prices?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=15&sortBy=DISTANCE`,
    ).expect(200);
    const distances = byDistance.body.prices.map((entry) => entry.store.distanceMeters);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));

    await expectValidationError(`/api/products/${productId}/prices?sortBy=DISTANCE`, ['sortBy']);
  });
});
