// Rutinas, despensa y preferencias privadas (P4-01) contra PostgreSQL/PostGIS real.
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
const { argentineToday, MAX_ROUTINES_PER_USER } = require('../../dist/modules/routines/domain/routine-rules');
const {
  latestObservationAnchor,
  seedDemoCatalog,
  demoCanonicalProductId,
  demoProductId,
} = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const POLLO = demoCanonicalProductId('pollo-entero');
const ARROZ = demoCanonicalProductId('arroz-largo-fino');
const LECHE = demoCanonicalProductId('leche-entera');
const HUEVOS = demoCanonicalProductId('huevos');
const ARROZ_PAMPA_1KG = demoProductId('arroz-pampa-1kg');
const LECHE_SACHET = demoProductId('leche-vallealto-sachet');

let app;
let server;
let prisma;
let pg;
before(async () => {
  prisma = new PrismaService(url);
  // Idempotente: si otro archivo ya sembró, no duplica nada.
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
async function register() {
  const email = `rutinas${Date.now()}${counter++}@example.com`;
  const response = await request(server)
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'tusofertas-web')
    .send({ email, password: 'private-fixture-password' })
    .expect(201);
  const token = response.body.accessToken;
  const as = (method) => (path) => request(server)[method](path).set('Authorization', `Bearer ${token}`);
  return { id: response.body.user.id, get: as('get'), post: as('post'), patch: as('patch'), del: as('delete') };
}

async function expectError(promise, status, error, fields) {
  const response = await promise.expect(status);
  assert.equal(response.body.error, error, JSON.stringify(response.body));
  if (fields) assert.deepEqual(response.body.fields, fields);
  return response.body;
}

const newRoutine = (user, body = { name: 'Compra semanal' }) =>
  user.post('/api/shopping-routines').send(body).expect(201).then((response) => response.body);
const newItem = (user, routineId, body) =>
  user.post(`/api/shopping-routines/${routineId}/items`).send(body).expect(201).then((response) => response.body);

describe('sesión obligatoria', () => {
  test('sin token todos los endpoints privados responden 401', async () => {
    const id = randomUUID();
    const calls = [
      () => request(server).get('/api/shopping-routines'),
      () => request(server).post('/api/shopping-routines').send({ name: 'x' }),
      () => request(server).get(`/api/shopping-routines/${id}`),
      () => request(server).patch(`/api/shopping-routines/${id}`).send({}),
      () => request(server).delete(`/api/shopping-routines/${id}`),
      () => request(server).post(`/api/shopping-routines/${id}/items`).send({}),
      () => request(server).patch(`/api/shopping-routines/${id}/items/${id}`).send({}),
      () => request(server).delete(`/api/shopping-routines/${id}/items/${id}`),
      () => request(server).get('/api/inventory'),
      () => request(server).post('/api/inventory').send({}),
      () => request(server).patch(`/api/inventory/${id}`).send({}),
      () => request(server).delete(`/api/inventory/${id}`),
    ];
    // Se crean de a una: supertest abre y cierra un puerto efímero por pedido.
    for (const call of calls) await expectError(call(), 401, 'UNAUTHORIZED');
  });
});

describe('rutinas', () => {
  test('alta con valores por defecto: semanal y anclada hoy en Argentina', async () => {
    const user = await register();
    const routine = await newRoutine(user, { name: '  Compra semanal  ' });
    assert.equal(routine.name, 'Compra semanal');
    assert.equal(routine.frequencyDays, 7);
    assert.equal(routine.anchorDate, argentineToday(new Date()));
    assert.deepEqual(routine.items, []);
    assert.deepEqual(Object.keys(routine).sort(), ['anchorDate', 'createdAt', 'frequencyDays', 'id', 'items', 'name', 'updatedAt']);

    const fortnightly = await newRoutine(user, { name: 'Quincenal', frequencyDays: 15, anchorDate: '2026-09-25' });
    assert.equal(fortnightly.frequencyDays, 15);
    assert.equal(fortnightly.anchorDate, '2026-09-25');

    const list = await user.get('/api/shopping-routines').expect(200);
    assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual(list.body.items.map((entry) => entry.id), [routine.id, fortnightly.id]);
  });

  test('editar reemplaza solo lo enviado y borrar elimina sus ítems en cascada', async () => {
    const user = await register();
    const routine = await newRoutine(user);
    await newItem(user, routine.id, { canonicalProductId: POLLO, quantity: '5', unit: 'KG' });

    const renamed = await user.patch(`/api/shopping-routines/${routine.id}`).send({ name: 'Súper del sábado' }).expect(200);
    assert.equal(renamed.body.name, 'Súper del sábado');
    assert.equal(renamed.body.frequencyDays, 7);
    const rescheduled = await user.patch(`/api/shopping-routines/${routine.id}`)
      .send({ frequencyDays: 14, anchorDate: '2026-10-03' }).expect(200);
    assert.equal(rescheduled.body.frequencyDays, 14);
    assert.equal(rescheduled.body.items[0].schedule.frequencyDays, 14, 'el ítem hereda la frecuencia nueva');

    await user.del(`/api/shopping-routines/${routine.id}`).expect(204);
    await expectError(user.get(`/api/shopping-routines/${routine.id}`), 404, 'NOT_FOUND');
    const orphans = await pg.query('SELECT count(*)::int AS n FROM "ShoppingRoutineItem" WHERE "routineId" = $1', [routine.id]);
    assert.equal(orphans.rows[0].n, 0);
    await expectError(user.del(`/api/shopping-routines/${routine.id}`), 404, 'NOT_FOUND');
  });

  test('rechaza frecuencias, fechas y campos inválidos', async () => {
    const user = await register();
    const create = (body) => user.post('/api/shopping-routines').send(body);
    await expectError(create({}), 400, 'VALIDATION_FAILED', ['name']);
    await expectError(create({ name: '   ' }), 400, 'VALIDATION_FAILED', ['name']);
    await expectError(create({ name: 'x', frequencyDays: 0 }), 400, 'VALIDATION_FAILED', ['frequencyDays']);
    await expectError(create({ name: 'x', frequencyDays: 366 }), 400, 'VALIDATION_FAILED', ['frequencyDays']);
    await expectError(create({ name: 'x', frequencyDays: 7.5 }), 400, 'VALIDATION_FAILED', ['frequencyDays']);
    await expectError(create({ name: 'x', frequencyDays: 'mensual' }), 400, 'VALIDATION_FAILED', ['frequencyDays']);
    await expectError(create({ name: 'x', anchorDate: '2026-02-30' }), 400, 'ANCHOR_DATE_INVALID', ['anchorDate']);
    await expectError(create({ name: 'x', anchorDate: '25/09/2026' }), 400, 'VALIDATION_FAILED', ['anchorDate']);
    await expectError(create({ name: 'x', userId: randomUUID() }), 400, 'VALIDATION_FAILED', ['userId']);

    const routine = await newRoutine(user);
    const patch = (body) => user.patch(`/api/shopping-routines/${routine.id}`).send(body);
    await expectError(patch({ name: null }), 400, 'VALIDATION_FAILED', ['name']);
    await expectError(patch({ frequencyDays: null }), 400, 'VALIDATION_FAILED', ['frequencyDays']);
    await expectError(patch({ id: randomUUID() }), 400, 'VALIDATION_FAILED', ['id']);
    await expectError(user.get('/api/shopping-routines/no-es-un-uuid'), 400, 'VALIDATION_FAILED', ['id']);
  });

  test('límite de rutinas por usuario respetado aun con altas simultáneas', async () => {
    const user = await register();
    const attempts = MAX_ROUTINES_PER_USER + 5;
    const results = await Promise.all(Array.from({ length: attempts }, (_, index) =>
      user.post('/api/shopping-routines').send({ name: `Rutina ${index}` })));
    const statuses = results.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 201).length, MAX_ROUTINES_PER_USER);
    assert.equal(statuses.filter((status) => status === 409).length, 5);
    assert.ok(results.filter((response) => response.status === 409).every((response) => response.body.error === 'ROUTINE_LIMIT'));
    const stored = await pg.query('SELECT count(*)::int AS n FROM "ShoppingRoutine" WHERE "userId" = $1', [user.id]);
    assert.equal(stored.rows[0].n, MAX_ROUTINES_PER_USER);
  });
});

describe('ítems de rutina', () => {
  test('5 kg de pollo semanal heredan la frecuencia; 500 g de arroz se guardan como 0,5 kg', async () => {
    const user = await register();
    const routine = await newRoutine(user, { name: 'Semanal', anchorDate: '2026-09-21' });
    const pollo = await newItem(user, routine.id, { canonicalProductId: POLLO, quantity: '5', unit: 'KG' });
    assert.equal(pollo.quantity, '5');
    assert.equal(pollo.unit, 'KG');
    assert.deepEqual(pollo.schedule, { frequencyDays: 7, anchorDate: '2026-09-21', inherited: true });
    assert.equal(pollo.allowSubstitutes, true);
    assert.equal(pollo.preferredProduct, null);
    assert.deepEqual(pollo.canonicalProduct, { id: POLLO, name: 'Pollo entero fresco', defaultUnit: 'KG' });

    const arroz = await newItem(user, routine.id, {
      canonicalProductId: ARROZ,
      quantity: '500',
      unit: 'G',
      preferredProductId: ARROZ_PAMPA_1KG,
      allowSubstitutes: false,
      preferredBrands: [' Pampa ', 'pampa'],
      excludedBrands: ['Del Sur'],
    });
    assert.equal(arroz.quantity, '0.5');
    assert.equal(arroz.unit, 'KG');
    assert.equal(arroz.preferredProduct.id, ARROZ_PAMPA_1KG);
    assert.equal(arroz.preferredProduct.brand, 'Pampa');
    assert.deepEqual(arroz.preferredBrands, ['Pampa'], 'recortadas y sin duplicados por mayúsculas');
    assert.deepEqual(arroz.excludedBrands, ['Del Sur']);
    const row = (await pg.query('SELECT quantity::text, unit::text FROM "ShoppingRoutineItem" WHERE id = $1', [arroz.id])).rows[0];
    assert.deepEqual(row, { quantity: '0.5000', unit: 'KG' });

    const huevos = await newItem(user, routine.id, {
      canonicalProductId: HUEVOS, quantity: '12', unit: 'UNIT', frequencyDays: 15, anchorDate: '2026-09-25',
    });
    assert.deepEqual(huevos.schedule, { frequencyDays: 15, anchorDate: '2026-09-25', inherited: false });

    // La rutina lista sus ítems por nombre del canónico.
    const full = await user.get(`/api/shopping-routines/${routine.id}`).expect(200);
    assert.deepEqual(full.body.items.map((item) => item.canonicalProduct.name), [
      'Arroz largo fino', 'Huevos de gallina', 'Pollo entero fresco',
    ]);
  });

  test('un solo ítem por canónico en cada rutina, también en altas simultáneas', async () => {
    const user = await register();
    const routine = await newRoutine(user);
    const body = { canonicalProductId: LECHE, quantity: '2', unit: 'L' };
    const results = await Promise.all([1, 2, 3].map(() => user.post(`/api/shopping-routines/${routine.id}/items`).send(body)));
    assert.deepEqual(results.map((response) => response.status).sort(), [201, 409, 409]);
    assert.equal(results.find((response) => response.status === 409).body.error, 'ROUTINE_ITEM_DUPLICATE');
    // Otra rutina del mismo usuario sí puede tener el mismo canónico.
    const other = await newRoutine(user, { name: 'Otra' });
    await newItem(user, other.id, body);
  });

  test('rechaza unidades, cantidades, preferidos y marcas incompatibles', async () => {
    const user = await register();
    const routine = await newRoutine(user);
    const add = (body) => user.post(`/api/shopping-routines/${routine.id}/items`).send({
      canonicalProductId: ARROZ, quantity: '1', unit: 'KG', ...body,
    });
    await expectError(add({ unit: 'L' }), 400, 'UNIT_DIMENSION_MISMATCH', ['unit']);
    await expectError(add({ unit: 'UNIT' }), 400, 'UNIT_DIMENSION_MISMATCH', ['unit']);
    await expectError(add({ unit: 'LB' }), 400, 'VALIDATION_FAILED', ['unit']);
    await expectError(add({ quantity: '0' }), 400, 'QUANTITY_INVALID', ['quantity']);
    await expectError(add({ quantity: '-1' }), 400, 'VALIDATION_FAILED', ['quantity']);
    await expectError(add({ quantity: 1 }), 400, 'VALIDATION_FAILED', ['quantity']);
    await expectError(add({ quantity: '0.05', unit: 'G' }), 400, 'QUANTITY_INVALID', ['quantity']);
    await expectError(add({ canonicalProductId: randomUUID() }), 400, 'CANONICAL_NOT_FOUND', ['canonicalProductId']);
    // Un preferido de otro canónico (leche para arroz) o inexistente no es válido.
    await expectError(add({ preferredProductId: LECHE_SACHET }), 400, 'PREFERRED_PRODUCT_INVALID', ['preferredProductId']);
    await expectError(add({ preferredProductId: randomUUID() }), 400, 'PREFERRED_PRODUCT_INVALID', ['preferredProductId']);
    await expectError(add({ allowSubstitutes: false }), 400, 'PREFERRED_PRODUCT_REQUIRED', ['preferredProductId']);
    await expectError(add({ preferredBrands: ['Pampa'], excludedBrands: ['PAMPA'] }), 400, 'BRANDS_OVERLAP', [
      'preferredBrands', 'excludedBrands',
    ]);
    await expectError(add({ frequencyDays: 15 }), 400, 'SCHEDULE_OVERRIDE_INCOMPLETE', ['frequencyDays', 'anchorDate']);
    await expectError(add({ anchorDate: '2026-09-25' }), 400, 'SCHEDULE_OVERRIDE_INCOMPLETE', ['frequencyDays', 'anchorDate']);
    await expectError(add({ allowSubstitutes: null }), 400, 'VALIDATION_FAILED', ['allowSubstitutes']);
    await expectError(add({ routineId: randomUUID() }), 400, 'VALIDATION_FAILED', ['routineId']);

    const stored = await pg.query('SELECT count(*)::int AS n FROM "ShoppingRoutineItem" WHERE "routineId" = $1', [routine.id]);
    assert.equal(stored.rows[0].n, 0, 'ningún intento inválido dejó filas');
  });

  test('editar un ítem: cantidad con unidad, frecuencia en par y reglas sobre el estado resultante', async () => {
    const user = await register();
    const routine = await newRoutine(user, { name: 'Semanal', anchorDate: '2026-09-21' });
    const item = await newItem(user, routine.id, { canonicalProductId: ARROZ, quantity: '1', unit: 'KG' });
    const path = `/api/shopping-routines/${routine.id}/items/${item.id}`;
    const patch = (body) => user.patch(path).send(body);

    const grams = await patch({ quantity: '750', unit: 'G' }).expect(200);
    assert.equal(grams.body.quantity, '0.75');
    await expectError(patch({ quantity: '2' }), 400, 'VALIDATION_FAILED', ['quantity', 'unit']);
    await expectError(patch({ unit: 'L', quantity: '1' }), 400, 'UNIT_DIMENSION_MISMATCH', ['unit']);
    await expectError(patch({ canonicalProductId: LECHE }), 400, 'VALIDATION_FAILED', ['canonicalProductId']);

    const override = await patch({ frequencyDays: 15, anchorDate: '2026-09-25' }).expect(200);
    assert.deepEqual(override.body.schedule, { frequencyDays: 15, anchorDate: '2026-09-25', inherited: false });
    await expectError(patch({ frequencyDays: 30 }), 400, 'SCHEDULE_OVERRIDE_INCOMPLETE');
    await expectError(patch({ frequencyDays: null }), 400, 'SCHEDULE_OVERRIDE_INCOMPLETE');
    const inherited = await patch({ frequencyDays: null, anchorDate: null }).expect(200);
    assert.deepEqual(inherited.body.schedule, { frequencyDays: 7, anchorDate: '2026-09-21', inherited: true });

    // Sin sustitutos exige preferido, y no se puede quitar el preferido mientras no se acepten reemplazos.
    await expectError(patch({ allowSubstitutes: false }), 400, 'PREFERRED_PRODUCT_REQUIRED');
    const strict = await patch({ allowSubstitutes: false, preferredProductId: ARROZ_PAMPA_1KG }).expect(200);
    assert.equal(strict.body.preferredProduct.id, ARROZ_PAMPA_1KG);
    await expectError(patch({ preferredProductId: null }), 400, 'PREFERRED_PRODUCT_REQUIRED');
    await expectError(patch({ preferredProductId: LECHE_SACHET }), 400, 'PREFERRED_PRODUCT_INVALID');

    // Marcas: la regla mira la combinación final, no solo la lista enviada.
    await patch({ excludedBrands: ['Del Sur'] }).expect(200);
    await expectError(patch({ preferredBrands: ['del sur'] }), 400, 'BRANDS_OVERLAP');

    await user.del(path).expect(204);
    await expectError(user.del(path), 404, 'NOT_FOUND');
    await expectError(patch({ quantity: '1', unit: 'KG' }), 404, 'NOT_FOUND');
  });
});

describe('despensa', () => {
  test('una fila por canónico en su unidad; cero es válido y negativo no', async () => {
    const user = await register();
    const created = await user.post('/api/inventory').send({ canonicalProductId: POLLO, quantity: '2000', unit: 'G' }).expect(201);
    assert.equal(created.body.quantity, '2');
    assert.equal(created.body.unit, 'KG');
    assert.deepEqual(Object.keys(created.body).sort(), ['canonicalProduct', 'id', 'quantity', 'unit', 'updatedAt']);

    await expectError(user.post('/api/inventory').send({ canonicalProductId: POLLO, quantity: '1', unit: 'KG' }), 409, 'INVENTORY_DUPLICATE', ['canonicalProductId']);
    await expectError(user.post('/api/inventory').send({ canonicalProductId: LECHE, quantity: '-1', unit: 'L' }), 400, 'VALIDATION_FAILED', ['quantity']);
    await expectError(user.post('/api/inventory').send({ canonicalProductId: LECHE, quantity: '1', unit: 'KG' }), 400, 'UNIT_DIMENSION_MISMATCH', ['unit']);
    await expectError(user.post('/api/inventory').send({ canonicalProductId: randomUUID(), quantity: '1', unit: 'KG' }), 400, 'CANONICAL_NOT_FOUND');
    await expectError(user.post('/api/inventory').send({ canonicalProductId: LECHE, quantity: '1', unit: 'L', userId: randomUUID() }), 400, 'VALIDATION_FAILED', ['userId']);

    const leche = await user.post('/api/inventory').send({ canonicalProductId: LECHE, quantity: '0', unit: 'ML' }).expect(201);
    assert.equal(leche.body.quantity, '0');
    assert.equal(leche.body.unit, 'L');

    const before = created.body.updatedAt;
    const updated = await user.patch(`/api/inventory/${created.body.id}`).send({ quantity: '1.5', unit: 'KG' }).expect(200);
    assert.equal(updated.body.quantity, '1.5');
    assert.ok(updated.body.updatedAt > before, 'registra la fecha de actualización');
    await expectError(user.patch(`/api/inventory/${created.body.id}`).send({ quantity: '1' }), 400, 'VALIDATION_FAILED', ['unit']);
    await expectError(user.patch(`/api/inventory/${created.body.id}`).send({ quantity: '1', unit: 'L' }), 400, 'UNIT_DIMENSION_MISMATCH');

    const list = await user.get('/api/inventory').expect(200);
    assert.deepEqual(list.body.items.map((item) => item.canonicalProduct.name), ['Leche entera', 'Pollo entero fresco']);

    await user.del(`/api/inventory/${leche.body.id}`).expect(204);
    await expectError(user.del(`/api/inventory/${leche.body.id}`), 404, 'NOT_FOUND');
  });
});

describe('ownership entre dos usuarios', () => {
  test('nadie lista, lee, edita ni borra rutinas, ítems o despensa ajenos', async () => {
    const ana = await register();
    const beto = await register();
    const anaRoutine = await newRoutine(ana, { name: 'Rutina de Ana' });
    const anaItem = await newItem(ana, anaRoutine.id, { canonicalProductId: POLLO, quantity: '5', unit: 'KG' });
    const anaStock = (await ana.post('/api/inventory').send({ canonicalProductId: POLLO, quantity: '2', unit: 'KG' }).expect(201)).body;
    const betoRoutine = await newRoutine(beto, { name: 'Rutina de Beto' });
    const betoItem = await newItem(beto, betoRoutine.id, { canonicalProductId: ARROZ, quantity: '1', unit: 'KG' });

    assert.deepEqual((await beto.get('/api/shopping-routines').expect(200)).body.items.map((entry) => entry.id), [betoRoutine.id]);
    assert.deepEqual((await beto.get('/api/inventory').expect(200)).body.items, []);

    // Ajeno e inexistente responden exactamente igual.
    const missing = await expectError(beto.get(`/api/shopping-routines/${randomUUID()}`), 404, 'NOT_FOUND');
    const foreign = await expectError(beto.get(`/api/shopping-routines/${anaRoutine.id}`), 404, 'NOT_FOUND');
    assert.deepEqual(foreign, missing);
    assert.equal(JSON.stringify(foreign).includes('Ana'), false);

    const anaPath = `/api/shopping-routines/${anaRoutine.id}`;
    await expectError(beto.patch(anaPath).send({ name: 'Hackeada' }), 404, 'NOT_FOUND');
    await expectError(beto.del(anaPath), 404, 'NOT_FOUND');
    await expectError(beto.post(`${anaPath}/items`).send({ canonicalProductId: ARROZ, quantity: '1', unit: 'KG' }), 404, 'NOT_FOUND');
    await expectError(beto.patch(`${anaPath}/items/${anaItem.id}`).send({ quantity: '9', unit: 'KG' }), 404, 'NOT_FOUND');
    await expectError(beto.del(`${anaPath}/items/${anaItem.id}`), 404, 'NOT_FOUND');
    // Ítem propio bajo rutina ajena, e ítem ajeno bajo rutina propia.
    await expectError(beto.patch(`${anaPath}/items/${betoItem.id}`).send({ quantity: '9', unit: 'KG' }), 404, 'NOT_FOUND');
    await expectError(beto.del(`${anaPath}/items/${betoItem.id}`), 404, 'NOT_FOUND');
    await expectError(beto.patch(`/api/shopping-routines/${betoRoutine.id}/items/${anaItem.id}`).send({ quantity: '9', unit: 'KG' }), 404, 'NOT_FOUND');
    await expectError(beto.del(`/api/shopping-routines/${betoRoutine.id}/items/${anaItem.id}`), 404, 'NOT_FOUND');
    // Ni siquiera Ana puede mover un ítem suyo a otra rutina por la URL.
    await expectError(ana.patch(`/api/shopping-routines/${betoRoutine.id}/items/${anaItem.id}`).send({ quantity: '9', unit: 'KG' }), 404, 'NOT_FOUND');
    await expectError(beto.patch(`/api/inventory/${anaStock.id}`).send({ quantity: '0', unit: 'KG' }), 404, 'NOT_FOUND');
    await expectError(beto.del(`/api/inventory/${anaStock.id}`), 404, 'NOT_FOUND');

    // Nada de Ana cambió y Beto no creó filas bajo la rutina de Ana.
    const anaView = (await ana.get(anaPath).expect(200)).body;
    assert.equal(anaView.name, 'Rutina de Ana');
    assert.deepEqual(anaView.items.map((item) => [item.id, item.quantity]), [[anaItem.id, '5']]);
    assert.equal((await ana.get('/api/inventory').expect(200)).body.items[0].quantity, '2');
    const betoOwn = (await beto.get(`/api/shopping-routines/${betoRoutine.id}`).expect(200)).body;
    assert.deepEqual(betoOwn.items.map((item) => [item.id, item.quantity]), [[betoItem.id, '1']]);
  });
});

describe('preferencias de compra en PATCH /users/me', () => {
  test('radio, máximo de sucursales y localidad válidos; "sin límite" es null', async () => {
    const user = await register();
    const ok = await user.patch('/api/users/me').send({
      city: 'Ciudad Autónoma de Buenos Aires',
      province: 'Ciudad Autónoma de Buenos Aires',
      maxTravelDistanceKm: '10',
      maxStoresPerShoppingPlan: null,
    }).expect(200);
    assert.equal(ok.body.maxTravelDistanceKm, '10');
    assert.equal(ok.body.maxStoresPerShoppingPlan, null);
    assert.equal((await user.patch('/api/users/me').send({ maxStoresPerShoppingPlan: 3 }).expect(200)).body.maxStoresPerShoppingPlan, 3);

    const cases = [
      [{ maxTravelDistanceKm: '150' }, ['maxTravelDistanceKm']],
      [{ maxTravelDistanceKm: '0.05' }, ['maxTravelDistanceKm']],
      [{ maxTravelDistanceKm: null }, ['maxTravelDistanceKm']],
      [{ maxStoresPerShoppingPlan: 0 }, ['maxStoresPerShoppingPlan']],
      [{ maxStoresPerShoppingPlan: 21 }, ['maxStoresPerShoppingPlan']],
      [{ city: 'Rosario' }, ['city', 'province']],
      [{ city: 'Rosario', province: null }, ['city', 'province']],
      [{ storeVisitPenalty: null }, ['storeVisitPenalty']],
      [{ banks: null }, ['banks']],
    ];
    for (const [body, fields] of cases) {
      await expectError(user.patch('/api/users/me').send(body), 400, 'VALIDATION_FAILED', fields);
    }
    const cleared = await user.patch('/api/users/me').send({ city: null, province: null }).expect(200);
    assert.equal(cleared.body.city, null);
    assert.equal(cleared.body.maxTravelDistanceKm, '10', 'los rechazos no cambiaron nada');
  });
});
