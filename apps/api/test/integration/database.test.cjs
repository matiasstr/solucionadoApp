// Integración con PostgreSQL/PostGIS real. Ejecutar con `npm.cmd run test:db`,
// que recrea la base *_test y aplica migraciones antes. No usa mocks.
const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { Client } = require('pg');
const { PrismaService } = require('../../dist/database/prisma.service');
const { StoreProximityRepository } = require('../../dist/modules/stores/infrastructure/store-proximity.repository');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

let prisma;
let pg;
before(async () => {
  prisma = new PrismaService(url);
  pg = new Client({ connectionString: url });
  await pg.connect();
});
after(async () => {
  await prisma?.$disconnect();
  await pg?.end();
});

/** Ejecuta SQL y devuelve el nombre del constraint/trigger violado (o null si no falló). */
async function violation(sql, params = []) {
  await pg.query('SAVEPOINT t');
  try {
    await pg.query(sql, params);
    await pg.query('RELEASE SAVEPOINT t');
    return null;
  } catch (error) {
    await pg.query('ROLLBACK TO SAVEPOINT t');
    return { code: error.code, constraint: error.constraint ?? null, message: error.message };
  }
}

async function fixtureCatalog() {
  const chain = await prisma.storeChain.create({ data: { name: `Cadena ficticia ${randomUUID()}` } });
  const category = await prisma.category.create({ data: { name: 'Almacén', slug: `almacen-${randomUUID()}` } });
  const product = await prisma.product.create({
    data: {
      name: 'Arroz largo fino 1 kg (ficticio)', normalizedName: 'arroz largo fino 1 kg',
      categoryId: category.id, quantity: '1', unit: 'KG',
    },
  });
  const store = await prisma.store.create({
    data: {
      chainId: chain.id, name: 'Sucursal ficticia', address: 'Av. Corrientes 1000',
      city: 'CABA', province: 'Buenos Aires', latitude: '-34.603700', longitude: '-58.381600',
    },
  });
  return { chain, category, product, store };
}

describe('esquema y extensiones', () => {
  test('PostGIS está instalado y Store.location tiene índice GiST', async () => {
    const ext = await pg.query("SELECT extversion FROM pg_extension WHERE extname = 'postgis'");
    assert.equal(ext.rowCount, 1);
    const idx = await pg.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'Store' AND indexname = 'Store_location_gist_idx'",
    );
    assert.match(idx.rows[0].indexdef, /USING gist \("?location"?\)/);
    const col = await pg.query(
      "SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = '\"Store\"'::regclass AND attname = 'location'",
    );
    assert.equal(col.rows[0].type, 'geography(Point,4326)');
  });

  test('readiness real responde 200 con la base disponible', async () => {
    assert.equal(await prisma.isReady(), true);
    const app = await createApp(
      validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url }),
      new JsonLogger(() => {}),
    );
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
      assert.deepEqual(response.body, { status: 'ok', service: 'tusofertas-api', checks: { database: 'up' } });
    } finally {
      await app.close();
    }
  });
});

describe('lectura/escritura y geografía', () => {
  test('crear y leer una entidad con Decimal como string', async () => {
    const user = await prisma.user.create({ data: { email: `ana-${randomUUID()}@example.com`, passwordHash: 'x' } });
    const read = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(read.maxTravelDistanceKm.toString(), '5');
    assert.equal(read.maxStoresPerShoppingPlan, 2);
  });

  test('location se deriva de longitud/latitud y se sincroniza al actualizar o quitar coordenadas', async () => {
    const { store } = await fixtureCatalog();
    const point = async () => (await pg.query(
      'SELECT ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat FROM "Store" WHERE id = $1', [store.id],
    )).rows[0];
    assert.deepEqual(await point(), { lon: -58.3816, lat: -34.6037 });

    await prisma.store.update({ where: { id: store.id }, data: { latitude: '-34.921400', longitude: '-57.954500' } });
    assert.deepEqual(await point(), { lon: -57.9545, lat: -34.9214 });

    // Una escritura directa no puede desincronizar el punto.
    await pg.query("UPDATE \"Store\" SET location = ST_GeogFromText('POINT(0 0)') WHERE id = $1", [store.id]);
    assert.deepEqual(await point(), { lon: -57.9545, lat: -34.9214 });

    await prisma.store.update({ where: { id: store.id }, data: { latitude: null, longitude: null } });
    assert.deepEqual(await point(), { lon: null, lat: null });
  });

  test('búsqueda por radio con ST_DWithin en metros, ordenada por distancia', async () => {
    const { chain } = await fixtureCatalog();
    const mk = (name, latitude, longitude, isActive = true) => prisma.store.create({
      data: { chainId: chain.id, name, address: 'Ficticia', city: 'CABA', province: 'Buenos Aires', latitude, longitude, isActive },
    });
    const near = await mk('Cerca (≈1,1 km)', '-34.593700', '-58.381600');
    const far = await mk('La Plata (≈55 km)', '-34.921400', '-57.954500');
    const inactive = await mk('Cerrada', '-34.603800', '-58.381600', false);
    const noCoords = await prisma.store.create({
      data: { chainId: chain.id, name: 'Sin coordenadas', address: 'Ficticia', city: 'CABA', province: 'Buenos Aires' },
    });

    const repo = new StoreProximityRepository(prisma);
    const result = await repo.findActiveWithin({ latitude: -34.6037, longitude: -58.3816 }, 5_000, 500);
    const ids = result.map((row) => row.storeId);
    assert.ok(ids.includes(near.id));
    for (const excluded of [far.id, inactive.id, noCoords.id]) assert.equal(ids.includes(excluded), false);
    const nearRow = result.find((row) => row.storeId === near.id);
    assert.ok(nearRow.distanceMeters > 1_000 && nearRow.distanceMeters < 1_200, `${nearRow.distanceMeters}`);
    const distances = result.map((row) => row.distanceMeters);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));

    const wide = await repo.findActiveWithin({ latitude: -34.6037, longitude: -58.3816 }, 60_000, 500);
    assert.ok(wide.some((row) => row.storeId === far.id));
    await assert.rejects(repo.findActiveWithin({ latitude: 91, longitude: 0 }, 1_000), RangeError);
    await assert.rejects(repo.findActiveWithin({ latitude: 0, longitude: 0 }, 0), RangeError);
  });
});

describe('constraints de dominio', () => {
  let catalog;
  before(async () => {
    catalog = await fixtureCatalog();
    await pg.query('BEGIN');
  });
  after(async () => {
    await pg.query('ROLLBACK');
  });

  const insertUser = (email, extra = '', values = []) => violation(
    `INSERT INTO "User" (id, email, "passwordHash", "updatedAt"${extra ? `, ${extra}` : ''})
     VALUES (gen_random_uuid(), $1, 'x', now()${values.map((_, i) => `, $${i + 2}`).join('')})`,
    [email, ...values],
  );

  test('email normalizado y único sin distinguir mayúsculas', async () => {
    assert.equal(await insertUser('beto@example.com'), null);
    assert.equal((await insertUser('beto@example.com')).code, '23505');
    assert.equal((await insertUser('Beto@Example.com')).constraint, 'User_email_normalized_check');
    assert.equal((await insertUser(' beto2@example.com')).constraint, 'User_email_normalized_check');
  });

  test('coordenadas del usuario completas y en rango; preferencias válidas', async () => {
    assert.equal((await insertUser('c1@example.com', 'latitude', ['-34.6'])).constraint, 'User_coordinates_check');
    assert.equal((await insertUser('c2@example.com', 'latitude, longitude', ['95', '0'])).constraint, 'User_coordinates_check');
    assert.equal((await insertUser('c3@example.com', '"maxTravelDistanceKm"', ['0'])).constraint, 'User_maxTravelDistanceKm_check');
    assert.equal((await insertUser('c4@example.com', '"maxStoresPerShoppingPlan"', [0])).constraint, 'User_maxStoresPerShoppingPlan_check');
    assert.equal(await insertUser('c5@example.com', '"maxStoresPerShoppingPlan"', [null]), null);
    assert.equal((await insertUser('c6@example.com', '"storeVisitPenalty"', ['-1'])).constraint, 'User_penalties_check');
  });

  test('coordenadas de sucursal completas y en rango', async () => {
    const insertStore = (lat, lon) => violation(
      `INSERT INTO "Store" (id, "chainId", name, address, city, province, latitude, longitude, "updatedAt")
       VALUES (gen_random_uuid(), $1, 's', 'a', 'c', 'p', $2, $3, now())`,
      [catalog.chain.id, lat, lon],
    );
    assert.equal((await insertStore('-34.6', null)).constraint, 'Store_coordinates_check');
    assert.equal((await insertStore('0', '181')).constraint, 'Store_coordinates_check');
    assert.equal(await insertStore(null, null), null);
  });

  test('producto: contenido positivo, EAN opcional numérico y sin unicidad falsa sobre nulos', async () => {
    const insertProduct = (quantity, ean, packageCount = 1) => violation(
      `INSERT INTO "Product" (id, name, "normalizedName", "categoryId", quantity, unit, ean, "packageCount", "updatedAt")
       VALUES (gen_random_uuid(), 'p', 'p', $1, $2, 'KG', $3, $4, now())`,
      [catalog.category.id, quantity, ean, packageCount],
    );
    assert.equal((await insertProduct('0', null)).constraint, 'Product_quantity_check');
    assert.equal((await insertProduct('1', null, 0)).constraint, 'Product_packageCount_check');
    assert.equal((await insertProduct('1', '77abc')).constraint, 'Product_ean_format_check');
    assert.equal(await insertProduct('1', null), null);
    assert.equal(await insertProduct('1', null), null);
    assert.equal(await insertProduct('1', '07790000000017'), null);
    assert.equal((await insertProduct('1', '07790000000017')).code, '23505');
  });

  test('historial de precios append-only, positivo, en ARS e idempotente por fuente', async () => {
    const insertPrice = (key, price = '1000', currency = 'ARS') => violation(
      `INSERT INTO "ProductPrice" (id, "productId", "storeId", price, "unitPrice", "unitPriceUnit", currency, source, "idempotencyKey", "observedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $3, 'KG', $4, 'demo', $5, now())`,
      [catalog.product.id, catalog.store.id, price, currency, key],
    );
    assert.equal(await insertPrice('obs-1'), null);
    assert.equal(await insertPrice('obs-2', '1100'), null, 'misma sucursal/producto con otra observación conserva historia');
    assert.equal((await insertPrice('obs-1')).code, '23505');
    assert.equal((await insertPrice('obs-3', '0')).constraint, 'ProductPrice_price_check');
    assert.equal((await insertPrice('obs-4', '10', 'USD')).constraint, 'ProductPrice_currency_check');

    const update = await violation(`UPDATE "ProductPrice" SET price = 1 WHERE "idempotencyKey" = 'obs-1'`);
    assert.equal(update.code, '23001');
    assert.match(update.message, /append-only/);
    assert.equal((await violation(`DELETE FROM "ProductPrice" WHERE "idempotencyKey" = 'obs-1'`)).code, '23001');
  });

  test('promociones: alcance, vigencia, porcentaje, tope y coherencia por tipo', async () => {
    const insertPromo = (fields) => {
      const base = {
        name: 'Promo ficticia', type: 'PERCENTAGE', source: 'demo', storeId: catalog.store.id,
        discountPercentage: '10', validFrom: '2026-09-01T03:00:00Z', validUntil: '2026-09-08T03:00:00Z',
        ...fields,
      };
      const cols = Object.keys(base);
      return violation(
        `INSERT INTO "Promotion" (id, "updatedAt", ${cols.map((c) => `"${c}"`).join(', ')})
         VALUES (gen_random_uuid(), now(), ${cols.map((c, i) => (c === 'type' ? `$${i + 1}::"PromotionType"`
          : c === 'capPeriod' ? `$${i + 1}::"DiscountCapPeriod"` : c === 'paymentMethod' ? `$${i + 1}::"PaymentMethod"` : `$${i + 1}`)).join(', ')})`,
        Object.values(base),
      );
    };
    assert.equal(await insertPromo({}), null);
    assert.equal((await insertPromo({ chainId: catalog.chain.id })).constraint, 'Promotion_commercial_scope_check');
    assert.equal((await insertPromo({ storeId: null })).constraint, 'Promotion_commercial_scope_check');
    assert.equal((await insertPromo({ productId: catalog.product.id, canonicalProductId: randomUUID() })).constraint, 'Promotion_product_scope_check');
    assert.equal((await insertPromo({ validUntil: '2026-09-01T03:00:00Z' })).constraint, 'Promotion_validity_check');
    assert.equal((await insertPromo({ discountPercentage: '100.01' })).constraint, 'Promotion_discountPercentage_check');
    assert.equal((await insertPromo({ discountCap: '500' })).constraint, 'Promotion_cap_period_check');
    assert.equal(await insertPromo({ discountCap: '500', capPeriod: 'MONTH' }), null);
    assert.equal((await insertPromo({ eligibleWeekdays: [1, 1] })).constraint, 'Promotion_weekdays_check');
    assert.equal((await insertPromo({ eligibleWeekdays: [0] })).constraint, 'Promotion_weekdays_check');
    assert.equal(await insertPromo({ eligibleWeekdays: [1, 3, 7] }), null);
    assert.equal((await insertPromo({ type: 'FIXED_PRICE' })).constraint, 'Promotion_type_fields_check');
    assert.equal(await insertPromo({ type: 'FIXED_PRICE', discountPercentage: null, fixedPrice: '900' }), null);
    assert.equal((await insertPromo({ type: 'TWO_FOR_ONE' })).constraint, 'Promotion_type_fields_check');
    assert.equal((await insertPromo({ type: 'BANK_DISCOUNT' })).constraint, 'Promotion_type_fields_check');
    assert.equal(await insertPromo({ type: 'BANK_DISCOUNT', bank: 'Banco ficticio' }), null);
  });

  test('rutinas, inventario y planes', async () => {
    const user = (await pg.query(
      `INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), 'plan@example.com', 'x', now()) RETURNING id`,
    )).rows[0].id;
    const canonical = (await pg.query(
      `INSERT INTO "CanonicalProduct" (id, name, "normalizedName", "categoryId", "defaultUnit", "updatedAt")
       VALUES (gen_random_uuid(), 'Arroz', 'arroz', $1, 'KG', now()) RETURNING id`, [catalog.category.id],
    )).rows[0].id;
    assert.equal((await violation(
      `INSERT INTO "ShoppingRoutine" (id, "userId", name, "frequencyDays", "anchorDate", "updatedAt") VALUES (gen_random_uuid(), $1, 'r', 0, '2026-09-18', now())`, [user],
    )).constraint, 'ShoppingRoutine_frequencyDays_check');
    const routine = (await pg.query(
      `INSERT INTO "ShoppingRoutine" (id, "userId", name, "anchorDate", "updatedAt") VALUES (gen_random_uuid(), $1, 'r', '2026-09-18', now()) RETURNING id`, [user],
    )).rows[0].id;
    const item = (extra, values) => violation(
      `INSERT INTO "ShoppingRoutineItem" (id, "routineId", "canonicalProductId", quantity, unit, "updatedAt"${extra})
       VALUES (gen_random_uuid(), $1, $2, $3, 'KG', now()${values.slice(1).map((_, i) => `, $${i + 4}`).join('')})`,
      [routine, canonical, ...values],
    );
    assert.equal((await item('', ['0'])).constraint, 'ShoppingRoutineItem_quantity_check');
    assert.equal((await item(', "frequencyDays"', ['1', 15])).constraint, 'ShoppingRoutineItem_schedule_override_check');
    assert.equal((await item(', "allowSubstitutes"', ['1', false])).constraint, 'ShoppingRoutineItem_substitutes_check');
    assert.equal((await item(', "preferredBrands", "excludedBrands"', ['1', ['Marca A'], ['Marca A']])).constraint, 'ShoppingRoutineItem_brands_check');

    assert.equal((await violation(
      `INSERT INTO "UserInventory" (id, "userId", "canonicalProductId", quantity, unit, "updatedAt") VALUES (gen_random_uuid(), $1, $2, -1, 'KG', now())`,
      [user, canonical],
    )).constraint, 'UserInventory_quantity_check');

    const plan = (start, end, regular, optimized, savings, effective) => violation(
      `INSERT INTO "ShoppingPlan" (id, "userId", "startDate", "endDate", "estimatedRegularCost", "optimizedCost", "estimatedSavings",
         "storeVisitPenaltyCost", "distancePenaltyCost", "effectiveCost", "optimizerVersion", "baselineMethod", "inputSnapshot", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 100, 50, $7, 'v0', 'single-store', '{}', now())`,
      [user, start, end, regular, optimized, savings, effective],
    );
    assert.equal(await plan('2026-09-18', '2026-09-24', '1000', '800', '200', '950'), null);
    assert.equal((await plan('2026-09-24', '2026-09-18', '1000', '800', '200', '950')).constraint, 'ShoppingPlan_dates_check');
    assert.equal((await plan('2026-09-18', '2026-09-24', '1000', '800', '200', '800')).constraint, 'ShoppingPlan_effectiveCost_check');
    assert.equal((await plan('2026-09-18', '2026-09-24', '1000', '800', '300', '950')).constraint, 'ShoppingPlan_estimatedSavings_check');
  });

  test('categoría no puede ser su propio padre', async () => {
    const id = randomUUID();
    assert.equal((await violation(
      `INSERT INTO "Category" (id, name, slug, "parentId") VALUES ($1, 'c', $2, $1)`, [id, `c-${id}`],
    )).constraint, 'Category_parent_not_self_check');
  });
});
