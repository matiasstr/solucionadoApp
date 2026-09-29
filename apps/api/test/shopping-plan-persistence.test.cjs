const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DecimalValue } = require('../dist/modules/catalog/domain/decimal');
const { buildCandidates } = require('../dist/modules/shopping-plans/domain/candidates');
const { resolvePlanWindow } = require('../dist/modules/shopping-plans/domain/plan-calendar');
const { optimizePlan } = require('../dist/modules/shopping-plans/domain/plan-optimizer');
const { toPlanRecord } = require('../dist/modules/shopping-plans/domain/plan-snapshot');
const { PlanStatusError, assertTransition, effectiveStatus } = require('../dist/modules/shopping-plans/domain/plan-status');

const WINDOW = resolvePlanWindow({ startDate: '2026-09-28' }, 28);
const NOW = new Date('2026-09-28T18:00:00.000Z');
const OBSERVED = new Date('2026-09-27T12:00:00.000Z');
const COORDINATES = { origin: 'COORDINATES', radiusKm: 5, city: null, province: null };
const LIMITS = { maxStores: 8, maxOffersPerStore: 2, maxDates: 7 };
const SETTINGS = { storeVisitPenalty: '0.00', distancePenaltyPerKm: '0.00', maxStores: 2, maxCombinations: 100000 };

const product = (id, canonicalProductId, overrides = {}) => ({
  id, ean: null, name: id, normalizedName: id, brand: null, categoryId: 'cat', canonicalProductId,
  quantity: '1', unit: 'KG', saleMode: 'PACKAGED', packageCount: 1, isActive: true, ...overrides,
});
const store = (id, distanceMeters) => ({
  id, name: `Sucursal ${id}`, chainId: `ch-${id}`, chainName: `Cadena ${id}`, city: 'Ciudad', province: 'Provincia', distanceMeters,
});
const price = (productId, storeId, value) => ({
  id: `obs-${productId}-${storeId}`, productId, storeId, price: value, unitPrice: value, unitPriceUnit: 'KG',
  currency: 'ARS', source: 'demo-seed', observedAt: OBSERVED, ingestedAt: OBSERVED,
});
const need = (canonicalProductId, netQuantity, overrides = {}) => ({
  canonicalProductId, canonicalName: `Producto ${canonicalProductId}`, unit: 'KG', grossQuantity: netQuantity, netQuantity,
  firstOccurrence: '2026-09-28', inventory: null, sources: [], status: 'TO_BUY',
  constraints: { allowSubstitutes: true, requiredProductId: null, preferredProductIds: [], preferredBrands: [], excludedBrands: [] },
  ...overrides,
});

function computation({ needs, products, stores, prices }) {
  const candidates = {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    window: WINDOW,
    scope: COORDINATES,
    limits: LIMITS,
    maxAgeDays: 7,
    needs,
    skippedItems: [],
    candidates: buildCandidates({ needs, products, stores, prices, promotions: [], dates: WINDOW.dates, scope: COORDINATES, limits: LIMITS, now: NOW, maxAgeDays: 7 }),
  };
  return { candidates, plan: optimizePlan(candidates, SETTINGS) };
}

test('estados: transiciones explícitas, reintento sin error y vencimiento por fecha', () => {
  assert.equal(assertTransition('DRAFT', 'ACTIVE'), true);
  assert.equal(assertTransition('DRAFT', 'COMPLETED'), true);
  assert.equal(assertTransition('ACTIVE', 'COMPLETED'), true);
  assert.equal(assertTransition('ACTIVE', 'ACTIVE'), false, 'mismo estado: no-op');
  assert.equal(assertTransition('COMPLETED', 'COMPLETED'), false);
  const fails = (from, to, code) => assert.throws(() => assertTransition(from, to), (error) => {
    assert.ok(error instanceof PlanStatusError);
    assert.deepEqual([error.code, error.fields], [code, ['status']]);
    return true;
  });
  fails('COMPLETED', 'ACTIVE', 'PLAN_STATUS_TRANSITION_INVALID');
  fails('EXPIRED', 'ACTIVE', 'PLAN_EXPIRED');
  fails('EXPIRED', 'COMPLETED', 'PLAN_EXPIRED');

  assert.equal(effectiveStatus('DRAFT', '2026-09-27', '2026-09-28'), 'EXPIRED');
  assert.equal(effectiveStatus('ACTIVE', '2026-09-27', '2026-09-28'), 'EXPIRED');
  assert.equal(effectiveStatus('ACTIVE', '2026-09-28', '2026-09-28'), 'ACTIVE', 'el último día todavía vale');
  assert.equal(effectiveStatus('COMPLETED', '2026-09-01', '2026-09-28'), 'COMPLETED', 'lo completado no vence');
});

test('registro del plan: columnas que cumplen los CHECK y líneas con snapshot autosuficiente', () => {
  const { candidates, plan } = computation({
    needs: [need('c-pollo', '3'), need('c-aceite', '3', { unit: 'L' })],
    products: [
      product('p-pollo', 'c-pollo', { saleMode: 'VARIABLE_WEIGHT', name: 'Pollo por kg' }),
      product('p-aceite', 'c-aceite', { quantity: '900', unit: 'ML', name: 'Aceite 900 ml', brand: 'Del Sur' }),
    ],
    stores: [store('s-a', 1000), store('s-b', 2000)],
    prices: [price('p-pollo', 's-a', '3290.00'), price('p-pollo', 's-b', '3190.00'), price('p-aceite', 's-a', '2890.00'), price('p-aceite', 's-b', '2990.00')],
  });
  const record = toPlanRecord(candidates, plan);
  const amount = (value) => DecimalValue.parse(value);
  assert.equal(record.startDate, '2026-09-28');
  assert.equal(record.endDate, '2026-10-04');
  assert.equal(record.baselineMethod, 'SINGLE_STORE_REGULAR_PRICES');
  assert.equal(record.optimizedCost, plan.totals.productCost);
  // Los CHECK de la tabla: efectivo = productos + penalidades; ahorro = base − optimizado.
  assert.ok(amount(record.effectiveCost).equals(amount(record.optimizedCost).add(amount(record.storeVisitPenaltyCost)).add(amount(record.distancePenaltyCost))));
  assert.ok(amount(record.estimatedSavings).equals(amount(record.estimatedRegularCost).subtract(amount(record.optimizedCost))));
  assert.equal(record.inputSnapshot.schemaVersion, 1);
  assert.equal(record.resultSnapshot.schemaVersion, 1);
  assert.deepEqual(record.inputSnapshot.candidates.needs.map((entry) => entry.canonicalProductId), ['c-pollo', 'c-aceite']);

  const pollo = record.items.find((item) => item.canonicalProductId === 'c-pollo');
  assert.deepEqual([pollo.storeId, pollo.packageCount, pollo.quantity, pollo.neededQuantity], ['s-b', null, '3', '3']);
  assert.equal(pollo.productPriceId, 'obs-p-pollo-s-b');
  const aceite = record.items.find((item) => item.canonicalProductId === 'c-aceite');
  assert.deepEqual([aceite.packageCount, aceite.quantity, aceite.neededQuantity], [4, '3.6', '3'], 'envases enteros con excedente');
  assert.deepEqual(
    [aceite.snapshot.schemaVersion, aceite.snapshot.productName, aceite.snapshot.brand, aceite.snapshot.priceBasis.observedAt],
    [1, 'Aceite 900 ml', 'Del Sur', '2026-09-27T12:00:00.000Z'],
  );
  for (const item of record.items) {
    assert.ok(amount(item.quantity).compare(amount(item.neededQuantity)) >= 0, 'nunca se compra menos de lo necesario');
    assert.ok(amount(item.estimatedSavings).equals(amount(item.estimatedRegularPrice).subtract(amount(item.price))));
  }
});

test('sin base comparable se guarda ahorro cero y método NONE (la API no lo muestra)', () => {
  const { candidates, plan } = computation({
    needs: [need('c-x', '1'), need('c-y', '1')],
    products: [product('p-x', 'c-x'), product('p-y', 'c-y')],
    stores: [store('s-a', 1000), store('s-b', 2000)],
    prices: [price('p-x', 's-a', '1000.00'), price('p-y', 's-b', '2000.00')],
  });
  const record = toPlanRecord(candidates, plan);
  assert.equal(plan.baseline, null);
  assert.deepEqual(
    [record.baselineMethod, record.estimatedRegularCost, record.optimizedCost, record.estimatedSavings],
    ['NONE', '3000.00', '3000.00', '0.00'],
  );
});
