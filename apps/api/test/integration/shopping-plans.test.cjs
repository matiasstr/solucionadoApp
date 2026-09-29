// Necesidades y candidatos del planificador (P5-01) contra PostgreSQL/PostGIS real.
// Ejecutar con `npm.cmd run test:db`. Rutinas, despensa y preferencias se cargan por
// la API, como lo hace la web; el cálculo se invoca con el caso de uso.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const request = require('supertest');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaService } = require('../../dist/database/prisma.service');
const { argentineToday } = require('../../dist/modules/routines/domain/routine-rules');
const { BuildPlanCandidatesUseCase } = require('../../dist/modules/shopping-plans/application/build-plan-candidates.use-case');
const {
  latestObservationAnchor,
  seedDemoCatalog,
  demoCanonicalProductId,
  demoProductId,
  demoPromotionId,
  demoStoreId,
} = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const POLLO = demoCanonicalProductId('pollo-entero');
const ARROZ = demoCanonicalProductId('arroz-largo-fino');
const ARROZ_PAMPA_1KG = demoProductId('arroz-pampa-1kg');
const CARREFOUR_ALMAGRO = demoStoreId('carrefour-almagro');
const DISCO_BELGRANO = demoStoreId('disco-belgrano');
const VEA_MORON = demoStoreId('vea-moron');
const CABA = 'Ciudad Autónoma de Buenos Aires';
// Coto Caballito (DEMO): con 5 km alcanza Almagro y Flores, no Belgrano ni Villa Urquiza.
const CABALLITO = { latitude: '-34.6187', longitude: '-58.4407' };

let app;
let server;
let prisma;
let planner;
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
  planner = app.get(BuildPlanCandidatesUseCase);
});
after(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

let counter = 0;
async function register(profile = {}) {
  const response = await request(server)
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'tusofertas-web')
    .send({ email: `planificador${Date.now()}${counter++}@example.com`, password: 'private-fixture-password' })
    .expect(201);
  const token = response.body.accessToken;
  const as = (method) => (path) => request(server)[method](path).set('Authorization', `Bearer ${token}`);
  const user = { id: response.body.user.id, post: as('post'), patch: as('patch') };
  if (Object.keys(profile).length) await user.patch('/api/users/me').send(profile).expect(200);
  return user;
}
const routine = (user, body) =>
  user.post('/api/shopping-routines').send({ anchorDate: argentineToday(new Date()), ...body }).expect(201).then((r) => r.body);
const addItem = (user, routineId, body) =>
  user.post(`/api/shopping-routines/${routineId}/items`).send(body).expect(201).then((r) => r.body);
const stock = (user, body) => user.post('/api/inventory').send(body).expect(201);
const needFor = (result, canonicalId) => result.needs.find((need) => need.canonicalProductId === canonicalId);
const candidatesFor = (result, canonicalId) =>
  result.candidates.needs.find((need) => need.canonicalProductId === canonicalId);

describe('necesidades', () => {
  test('5 kg de pollo semanales menos 2 kg en la despensa: 3 kg con ofertas dentro del radio real', async () => {
    const user = await register({ ...CABALLITO, maxTravelDistanceKm: '5' });
    const weekly = await routine(user, { name: 'Compra semanal', frequencyDays: 7 });
    await addItem(user, weekly.id, { canonicalProductId: POLLO, quantity: '5', unit: 'KG' });
    await stock(user, { canonicalProductId: POLLO, quantity: '2000', unit: 'G' });

    const result = await planner.execute(user.id);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.window.startDate, argentineToday(new Date()));
    assert.equal(result.window.days, 7);
    const need = needFor(result, POLLO);
    assert.deepEqual([need.grossQuantity, need.netQuantity, need.status], ['5', '3', 'TO_BUY']);
    assert.deepEqual([need.inventory.quantity, need.inventory.subtracted, need.inventory.applied], ['2', '2', true]);
    assert.deepEqual(need.sources.map((source) => [source.routineName, source.occurrences.length]), [['Compra semanal', 1]]);

    assert.deepEqual(result.scope, { origin: 'COORDINATES', radiusKm: 5, city: null, province: null });
    const candidates = candidatesFor(result, POLLO);
    assert.equal(candidates.unresolvedReason, null);
    assert.ok(candidates.offers.length >= 2, 'hay más de una sucursal cerca');
    const kept = new Set(result.candidates.stores.kept.map((store) => store.id));
    for (const offer of candidates.offers) {
      assert.ok(offer.distanceMeters !== null && offer.distanceMeters <= 5000, `${offer.storeName} dentro de 5 km`);
      assert.ok(kept.has(offer.storeId));
      assert.deepEqual([offer.purchase.saleMode, offer.purchase.units, offer.purchase.quantityIsEstimate], ['VARIABLE_WEIGHT', '3', true]);
      assert.equal(offer.priceBasis.basis, 'LATEST_OBSERVATION');
      assert.equal(offer.priceBasis.source, 'demo-seed');
      assert.ok(offer.priceBasis.ageDays <= result.maxAgeDays);
    }
    assert.ok(!kept.has(DISCO_BELGRANO), 'Belgrano queda fuera del radio');
    assert.deepEqual(result.candidates.warnings, []);
  });

  test('dos rutinas con el mismo canónico suman y restan la despensa una sola vez', async () => {
    const user = await register({ ...CABALLITO });
    const first = await routine(user, { name: 'Semana', frequencyDays: 7 });
    const second = await routine(user, { name: 'Viandas', frequencyDays: 7 });
    await addItem(user, first.id, { canonicalProductId: ARROZ, quantity: '1', unit: 'KG' });
    await addItem(user, second.id, { canonicalProductId: ARROZ, quantity: '500', unit: 'G' });
    await stock(user, { canonicalProductId: ARROZ, quantity: '250', unit: 'G' });

    const need = needFor(await planner.execute(user.id), ARROZ);
    assert.deepEqual([need.grossQuantity, need.netQuantity], ['1.5', '1.25']);
    assert.equal(need.inventory.subtracted, '0.25');
    assert.deepEqual(need.sources.map((source) => source.routineName).sort(), ['Semana', 'Viandas']);
  });

  test('frecuencia propia quincenal: fuera de la ventana no suma y queda registrada', async () => {
    const user = await register({ ...CABALLITO });
    const weekly = await routine(user, { name: 'Semana', frequencyDays: 7 });
    const today = argentineToday(new Date());
    const item = await addItem(user, weekly.id, {
      canonicalProductId: ARROZ,
      quantity: '1',
      unit: 'KG',
      frequencyDays: 15,
      anchorDate: today,
    });
    const nextWeek = new Date(Date.now() + 8 * 86_400_000);
    const later = await planner.execute(user.id, { startDate: argentineToday(nextWeek) });
    assert.deepEqual(later.needs, []);
    assert.deepEqual(later.skippedItems.map((skipped) => [skipped.routineItemId, skipped.reason]), [
      [item.id, 'NO_OCCURRENCES_IN_WINDOW'],
    ]);
    const twoWeeks = await planner.execute(user.id, {
      startDate: today,
      endDate: argentineToday(new Date(Date.now() + 15 * 86_400_000)),
    });
    assert.equal(needFor(twoWeeks, ARROZ).grossQuantity, '2', 'hoy y dentro de 15 días');
  });
});

describe('candidatos', () => {
  test('preferido sin reemplazos: solo esa presentación, con la promoción vigente y la bancaria sin aplicar', async () => {
    const user = await register({ ...CABALLITO });
    const weekly = await routine(user, { name: 'Semana', frequencyDays: 7 });
    await addItem(user, weekly.id, {
      canonicalProductId: ARROZ,
      quantity: '2',
      unit: 'KG',
      preferredProductId: ARROZ_PAMPA_1KG,
      allowSubstitutes: false,
    });

    const candidates = candidatesFor(await planner.execute(user.id), ARROZ);
    assert.ok(candidates.offers.length > 0);
    for (const offer of candidates.offers) assert.deepEqual([offer.productId, offer.matchType], [ARROZ_PAMPA_1KG, 'EXACT']);
    assert.ok(candidates.exclusions.some((exclusion) => exclusion.reason === 'SUBSTITUTION_NOT_ALLOWED'));

    const almagro = candidates.offers.find((offer) => offer.storeId === CARREFOUR_ALMAGRO);
    const today = almagro.dateOptions[0];
    assert.equal(today.appliedPromotionId, demoPromotionId('carrefour-arroz-20'));
    assert.equal(almagro.purchase.units, '2');
    // 20 % sobre dos paquetes: el total con promoción es el 80 % del regular.
    assert.equal(today.total, (Number(almagro.regularTotal) * 0.8).toFixed(2));
    const bank = today.promotions.find((check) => check.promotionId === demoPromotionId('carrefour-banco-25'));
    assert.deepEqual([bank.applied, bank.skipReason], [false, 'PAYMENT_CONDITIONED']);
  });

  test('solo localidad: sucursales de la ciudad sin distancia, con aviso, y el precio viejo descartado', async () => {
    const user = await register({ city: CABA, province: CABA });
    const weekly = await routine(user, { name: 'Semana', frequencyDays: 7 });
    await addItem(user, weekly.id, { canonicalProductId: POLLO, quantity: '1', unit: 'KG' });

    const result = await planner.execute(user.id);
    assert.equal(result.scope.origin, 'LOCALITY');
    assert.deepEqual(result.candidates.warnings.map((warning) => warning.code), ['LOCATION_APPROXIMATE']);
    const candidates = candidatesFor(result, POLLO);
    assert.ok(candidates.offers.length > 0);
    for (const offer of candidates.offers) assert.equal(offer.distanceMeters, null);
    // Disco Belgrano dejó de informar hace 12 días: su precio no prueba disponibilidad.
    const stale = candidates.exclusions.find((exclusion) => exclusion.storeId === DISCO_BELGRANO);
    assert.equal(stale.reason, 'PRICE_STALE');
    assert.ok(stale.ageDays > result.maxAgeDays);
    assert.ok(!candidates.offers.some((offer) => offer.storeId === DISCO_BELGRANO));

    const moron = await register({ city: 'Morón', province: 'Buenos Aires' });
    const moronRoutine = await routine(moron, { name: 'Semana', frequencyDays: 7 });
    await addItem(moron, moronRoutine.id, { canonicalProductId: POLLO, quantity: '1', unit: 'KG' });
    const moronOffers = candidatesFor(await planner.execute(moron.id), POLLO).offers;
    assert.deepEqual(moronOffers.map((offer) => [offer.storeId, offer.distanceMeters]), [[VEA_MORON, null]]);
  });

  test('sin ubicación: las necesidades se calculan igual y quedan sin ofertas, con aviso', async () => {
    const user = await register();
    const weekly = await routine(user, { name: 'Semana', frequencyDays: 7 });
    await addItem(user, weekly.id, { canonicalProductId: POLLO, quantity: '5', unit: 'KG' });

    const result = await planner.execute(user.id);
    assert.equal(result.scope.origin, 'NONE');
    assert.equal(needFor(result, POLLO).netQuantity, '5');
    assert.equal(candidatesFor(result, POLLO).unresolvedReason, 'NO_LOCATION');
    assert.deepEqual(result.candidates.stores.kept, []);
    assert.deepEqual(result.candidates.warnings.map((warning) => warning.code), ['LOCATION_MISSING']);
  });
});

describe('aislamiento y validación', () => {
  test('las rutinas y la despensa de otra cuenta no entran en el cálculo', async () => {
    const owner = await register({ ...CABALLITO });
    const other = await register({ ...CABALLITO });
    const theirs = await routine(other, { name: 'Ajena', frequencyDays: 1 });
    await addItem(other, theirs.id, { canonicalProductId: POLLO, quantity: '9', unit: 'KG' });
    await stock(other, { canonicalProductId: ARROZ, quantity: '5', unit: 'KG' });
    const mine = await routine(owner, { name: 'Propia', frequencyDays: 7 });
    await addItem(owner, mine.id, { canonicalProductId: ARROZ, quantity: '1', unit: 'KG' });

    const result = await planner.execute(owner.id);
    assert.deepEqual(result.needs.map((need) => need.canonicalProductId), [ARROZ]);
    assert.equal(needFor(result, ARROZ).inventory, null, 'la despensa ajena no se resta');

    const empty = await register({ ...CABALLITO });
    const nothing = await planner.execute(empty.id);
    assert.deepEqual([nothing.needs, nothing.skippedItems, nothing.candidates.needs], [[], [], []]);
  });

  test('ventana inválida es 400 con el campo; cuenta inexistente es 401', async () => {
    const user = await register();
    const cases = [
      [{ startDate: '2026-02-30' }, 'PLAN_WINDOW_INVALID', ['startDate']],
      [{ startDate: '2026-10-10', endDate: '2026-10-01' }, 'PLAN_WINDOW_INVALID', ['endDate']],
      [{ startDate: '2026-10-01', endDate: '2026-12-01' }, 'PLAN_WINDOW_TOO_LONG', ['startDate', 'endDate']],
    ];
    for (const [query, code, fields] of cases) {
      await assert.rejects(planner.execute(user.id, query), (error) => {
        assert.equal(error.getStatus(), 400);
        assert.deepEqual([error.error, error.fields], [code, fields]);
        return true;
      });
    }
    await assert.rejects(planner.execute(randomUUID()), (error) => error.getStatus() === 401);
  });
});
