const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DecimalValue } = require('../dist/modules/catalog/domain/decimal');
const { buildCandidates } = require('../dist/modules/shopping-plans/domain/candidates');
const { resolvePlanWindow } = require('../dist/modules/shopping-plans/domain/plan-calendar');
const { countCombinations, optimizePlan } = require('../dist/modules/shopping-plans/domain/plan-optimizer');

// Lunes 2026-09-28 a domingo 2026-10-04: martes 29, miércoles 30.
const WINDOW = resolvePlanWindow({ startDate: '2026-09-28' }, 28);
const WEEK = WINDOW.dates;
const NOW = new Date('2026-09-28T18:00:00.000Z');
const YESTERDAY = new Date('2026-09-27T12:00:00.000Z');
const COORDINATES = { origin: 'COORDINATES', radiusKm: 5, city: null, province: null };
const LOCALITY = { origin: 'LOCALITY', radiusKm: null, city: 'Morón', province: 'Buenos Aires' };
const LIMITS = { maxStores: 8, maxOffersPerStore: 2, maxDates: 7 };
const SETTINGS = { storeVisitPenalty: '0.00', distancePenaltyPerKm: '0.00', maxStores: 2, maxCombinations: 100000 };

const product = (id, canonicalProductId, overrides = {}) => ({
  id,
  ean: null,
  name: id,
  normalizedName: id,
  brand: null,
  categoryId: 'cat',
  canonicalProductId,
  quantity: '1',
  unit: 'KG',
  saleMode: 'PACKAGED',
  packageCount: 1,
  isActive: true,
  ...overrides,
});
const PRODUCTS = [
  product('p-pollo', 'c-pollo', { saleMode: 'VARIABLE_WEIGHT' }),
  product('p-x', 'c-x'),
  product('p-y', 'c-y'),
  product('p-fideos', 'c-fideos', { quantity: '500', unit: 'G' }),
];
const store = (id, distanceMeters = null) => ({
  id,
  name: `Sucursal ${id}`,
  chainId: `ch-${id}`,
  chainName: `Cadena ${id}`,
  city: 'Ciudad',
  province: 'Provincia',
  distanceMeters,
});
const price = (productId, storeId, value) => ({
  id: `obs-${productId}-${storeId}`,
  productId,
  storeId,
  price: value,
  unitPrice: value,
  unitPriceUnit: 'KG',
  currency: 'ARS',
  source: 'demo-seed',
  observedAt: YESTERDAY,
  ingestedAt: YESTERDAY,
});
const need = (canonicalProductId, netQuantity, overrides = {}) => ({
  canonicalProductId,
  canonicalName: `Producto ${canonicalProductId}`,
  unit: 'KG',
  grossQuantity: netQuantity,
  netQuantity,
  firstOccurrence: '2026-09-28',
  inventory: null,
  sources: [],
  status: 'TO_BUY',
  ...overrides,
  constraints: {
    allowSubstitutes: true,
    requiredProductId: null,
    preferredProductIds: [],
    preferredBrands: [],
    excludedBrands: [],
    ...overrides.constraints,
  },
});
const promotion = (id, overrides) => ({
  id,
  name: `Promo ${id}`,
  type: 'PERCENTAGE',
  storeId: null,
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
  source: 'demo-seed',
  externalId: null,
  validFrom: new Date('2026-09-01T12:00:00.000Z'),
  validUntil: new Date('2026-10-30T12:00:00.000Z'),
  ...overrides,
});

/** Candidatos reales de P5-01 a partir de datos sintéticos. */
function candidatesFrom({ needs, stores, prices, promotions = [], scope = COORDINATES, dates = WEEK, limits = LIMITS }) {
  return {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    window: WINDOW,
    scope,
    limits,
    maxAgeDays: 7,
    needs,
    skippedItems: [],
    candidates: buildCandidates({ needs, products: PRODUCTS, stores, prices, promotions, dates, scope, limits, now: NOW, maxAgeDays: 7 }),
  };
}
const optimize = (scenario, settings = {}) => optimizePlan(candidatesFrom(scenario), { ...SETTINGS, ...settings });
const codes = (items) => items.map((item) => item.code);
const at = (plan, canonical) => plan.lines.find((line) => line.canonicalProductId === canonical);
const X_Y = (pricesAtA, pricesAtB) => ({
  needs: [need('c-x', '1'), need('c-y', '1')],
  stores: [store('s-a'), store('s-b')],
  prices: [
    ...Object.entries(pricesAtA).map(([id, value]) => price(id, 's-a', value)),
    ...Object.entries(pricesAtB).map(([id, value]) => price(id, 's-b', value)),
  ],
});

test('5 kg a $8.000/kg contra $7.000/kg: sin restricciones elige la segunda sucursal', () => {
  const plan = optimize({
    needs: [need('c-pollo', '5')],
    stores: [store('s-a', 1000), store('s-b', 2000)],
    prices: [price('p-pollo', 's-a', '8000.00'), price('p-pollo', 's-b', '7000.00')],
  });
  assert.equal(plan.search.method, 'EXACT_BOUNDED');
  assert.equal(plan.coverage, 'COMPLETE');
  const [line] = plan.lines;
  assert.deepEqual([line.storeId, line.total, line.purchase.units], ['s-b', '35000.00', '5']);
  assert.deepEqual(line.reasonCodes, ['CHEAPEST_EVALUATED']);
  assert.deepEqual(line.alternatives.map((alternative) => [alternative.storeName, alternative.difference]), [
    ['Sucursal s-a', '5000.00'],
  ]);
  assert.equal(plan.totals.productCost, '35000.00');
  assert.equal(plan.totals.effectiveCost, '35000.00');
  assert.equal(plan.optimizerVersion.startsWith('planner-'), true);
});

test('una segunda sucursal que ahorra $500 pero suma $1.000 de penalidad se rechaza', () => {
  const scenario = X_Y({ 'p-x': '1000.00', 'p-y': '2000.00' }, { 'p-x': '500.00' });
  const penalized = optimize(scenario, { storeVisitPenalty: '1000.00' });
  assert.deepEqual(penalized.visits.map((visit) => visit.storeId), ['s-a']);
  assert.deepEqual(
    [penalized.totals.productCost, penalized.totals.storeVisitPenaltyCost, penalized.totals.effectiveCost],
    ['3000.00', '1000.00', '4000.00'],
  );
  const x = at(penalized, 'c-x');
  assert.deepEqual(x.reasonCodes, ['CHEAPER_OPTION_NOT_WORTH_IT']);
  assert.match(x.reason, /En Sucursal s-b el 28\/09 cuesta \$500,00 menos/);

  const free = optimize(scenario);
  assert.deepEqual(free.visits.map((visit) => visit.storeId).sort(), ['s-a', 's-b']);
  assert.equal(free.totals.productCost, '2500.00');
  // Con $400 por visita, la segunda sucursal todavía conviene: 2.500 + 800 < 3.000 + 400.
  const cheapPenalty = optimize(scenario, { storeVisitPenalty: '400.00' });
  assert.equal(cheapPenalty.totals.visitCount, 2);
  assert.equal(cheapPenalty.totals.effectiveCost, '3300.00');
});

test('una sola sucursal obligatoria: la canasta completa más barata en un solo lugar', () => {
  const scenario = X_Y({ 'p-x': '1000.00', 'p-y': '2000.00' }, { 'p-x': '500.00', 'p-y': '2600.00' });
  const single = optimize(scenario, { maxStores: 1 });
  assert.deepEqual(single.visits.map((visit) => visit.storeId), ['s-a']);
  assert.equal(single.totals.productCost, '3000.00');
  assert.equal(single.totals.storeCount, 1);
  const unlimited = optimize(scenario, { maxStores: null });
  assert.equal(unlimited.totals.productCost, '2500.00');
  assert.equal(unlimited.totals.storeCount, 2);
});

test('el máximo de sucursales puede dejar faltantes: plan parcial y base solo sobre lo cubierto', () => {
  const plan = optimize(X_Y({ 'p-x': '1000.00' }, { 'p-y': '2000.00' }), { maxStores: 1 });
  assert.equal(plan.coverage, 'PARTIAL');
  assert.deepEqual(plan.lines.map((line) => line.canonicalProductId), ['c-x']);
  assert.deepEqual(plan.unfulfilled.map((entry) => [entry.canonicalProductId, entry.reason]), [['c-y', 'MAX_STORES_LIMIT']]);
  assert.ok(codes(plan.limitations).includes('PARTIAL_PLAN'));
  assert.deepEqual([plan.baseline.storeId, plan.baseline.productCost], ['s-a', '1000.00']);
});

test('distancia: ida y vuelta por visita multiplicada por la penalidad por km', () => {
  const scenario = {
    needs: [need('c-x', '1')],
    stores: [store('s-a', 1000), store('s-b', 10000)],
    prices: [price('p-x', 's-a', '5000.00'), price('p-x', 's-b', '4000.00')],
  };
  // s-a: 5.000 + 2 km × $100 = 5.200; s-b: 4.000 + 20 km × $100 = 6.000.
  const plan = optimize(scenario, { distancePenaltyPerKm: '100.00' });
  assert.deepEqual([plan.visits[0].storeId, plan.visits[0].roundTripKm], ['s-a', '2.000']);
  assert.deepEqual(
    [plan.totals.distancePenaltyCost, plan.totals.totalDistanceKm, plan.totals.effectiveCost],
    ['200.00', '2.000', '5200.00'],
  );
  assert.ok(codes(plan.limitations).includes('DISTANCE_IS_ESTIMATE'));
  assert.equal(optimize(scenario).visits[0].storeId, 's-b', 'sin penalidad por km gana el precio');

  const locality = optimize({ ...scenario, scope: LOCALITY, stores: [store('s-a'), store('s-b')] }, { distancePenaltyPerKm: '100.00' });
  assert.equal(locality.totals.totalDistanceKm, null, 'sin coordenadas no se inventan 0 km');
  assert.equal(locality.totals.distancePenaltyCost, '0.00');
  assert.ok(codes(locality.limitations).includes('DISTANCE_UNKNOWN'));
});

test('2×1 con cantidades impares: tres envases pagan dos; uno solo no activa la promoción', () => {
  const scenario = (quantity) => ({
    needs: [need('c-fideos', quantity)],
    stores: [store('s-a'), store('s-b')],
    prices: [price('p-fideos', 's-a', '1000.00'), price('p-fideos', 's-b', '800.00')],
    promotions: [promotion('dos-por-uno', { type: 'TWO_FOR_ONE', chainId: 'ch-s-a', productId: 'p-fideos' })],
  });
  const three = optimize(scenario('1.5'));
  assert.deepEqual([at(three, 'c-fideos').storeId, at(three, 'c-fideos').total, at(three, 'c-fideos').purchase.units], ['s-a', '2000.00', '3']);
  assert.ok(at(three, 'c-fideos').reasonCodes.includes('PROMOTION_APPLIED'));
  assert.match(at(three, 'c-fideos').reason, /Promo dos-por-uno/);
  assert.deepEqual([three.totals.regularProductCost, three.totals.promotionDiscount], ['3000.00', '1000.00']);
  const one = optimize(scenario('0.5'));
  assert.deepEqual([at(one, 'c-fideos').storeId, at(one, 'c-fideos').total], ['s-b', '800.00']);
  const two = optimize(scenario('1'));
  assert.deepEqual([at(two, 'c-fideos').storeId, at(two, 'c-fideos').total], ['s-a', '1000.00']);
});

test('la misma sucursal en dos días son dos visitas y una sola sucursal para el máximo', () => {
  const scenario = {
    needs: [need('c-x', '1'), need('c-y', '1')],
    stores: [store('s-a')],
    prices: [price('p-x', 's-a', '1000.00'), price('p-y', 's-a', '1000.00')],
    promotions: [
      promotion('martes', { chainId: 'ch-s-a', productId: 'p-x', discountPercentage: '50.00', eligibleWeekdays: [2] }),
      promotion('miercoles', { chainId: 'ch-s-a', productId: 'p-y', discountPercentage: '50.00', eligibleWeekdays: [3] }),
    ],
  };
  const free = optimize(scenario, { maxStores: 1 });
  assert.deepEqual(free.search.datesPerStore['s-a'], ['2026-09-29', '2026-09-30'], 'el lunes y el resto quedan dominados');
  assert.deepEqual(free.visits.map((visit) => [visit.storeId, visit.date]), [['s-a', '2026-09-29'], ['s-a', '2026-09-30']]);
  assert.deepEqual([free.totals.visitCount, free.totals.storeCount, free.totals.productCost], [2, 1, '1000.00']);
  // Con $600 por visita conviene ir una vez: 1.500 + 600 < 1.000 + 1.200. Empate martes/miércoles: gana el martes.
  const penalized = optimize(scenario, { maxStores: 1, storeVisitPenalty: '600.00' });
  assert.deepEqual(penalized.visits.map((visit) => visit.date), ['2026-09-29']);
  assert.equal(penalized.totals.effectiveCost, '2100.00');
});

test('empates: menos visitas, fecha más temprana y el id de sucursal, siempre igual', () => {
  const scenario = {
    scope: LOCALITY,
    needs: [need('c-x', '1')],
    stores: [store('s-b'), store('s-a')],
    prices: [price('p-x', 's-b', '1000.00'), price('p-x', 's-a', '1000.00')],
  };
  const plan = optimize(scenario);
  assert.deepEqual([plan.lines[0].storeId, plan.lines[0].date, plan.totals.visitCount], ['s-a', '2026-09-28', 1]);
  assert.deepEqual(optimize({ ...scenario, stores: [...scenario.stores].reverse() }), plan);
});

test('sin candidatos: nada se inventa, sin base ni ahorro', () => {
  const noLocation = optimize({
    scope: { origin: 'NONE', radiusKm: null, city: null, province: null },
    needs: [need('c-x', '1')],
    stores: [],
    prices: [],
  });
  assert.deepEqual(
    [noLocation.search.method, noLocation.coverage, noLocation.lines, noLocation.baseline, noLocation.savings],
    ['NO_CANDIDATES', 'PARTIAL', [], null, null],
  );
  assert.deepEqual(noLocation.unfulfilled.map((entry) => entry.reason), ['NO_LOCATION']);
  assert.equal(noLocation.baselineUnavailableReason, 'NOTHING_TO_BUY');
  assert.equal(noLocation.totals.effectiveCost, '0.00');

  const covered = optimize({ needs: [need('c-x', '0', { status: 'COVERED_BY_INVENTORY' })], stores: [store('s-a')], prices: [] });
  assert.equal(covered.coverage, 'EMPTY');
  assert.deepEqual(covered.coveredByInventory.map((entry) => entry.canonicalProductId), ['c-x']);
});

test('sin una sucursal que tenga todo no hay base comparable y no se muestra ahorro', () => {
  const plan = optimize(X_Y({ 'p-x': '1000.00' }, { 'p-y': '2000.00' }));
  assert.equal(plan.coverage, 'COMPLETE');
  assert.deepEqual([plan.baseline, plan.savings, plan.baselineUnavailableReason], [null, null, 'NO_SINGLE_STORE_COVERS_PLAN']);
  assert.ok(codes(plan.limitations).includes('NO_BASELINE'));
});

test('los importes cierran: sin descuentos contados dos veces ni redondeos que no suman', () => {
  const plan = optimize({
    needs: [need('c-x', '3'), need('c-y', '2'), need('c-fideos', '1.5')],
    stores: [store('s-a', 1234), store('s-b', 2345)],
    prices: [
      price('p-x', 's-a', '1111.11'),
      price('p-x', 's-b', '1099.99'),
      price('p-y', 's-a', '2222.22'),
      price('p-y', 's-b', '2345.67'),
      price('p-fideos', 's-a', '999.99'),
      price('p-fideos', 's-b', '1049.50'),
    ],
    promotions: [
      promotion('pct', { chainId: 'ch-s-a', productId: 'p-y', discountPercentage: '12.50' }),
      promotion('dos-por-uno', { type: 'TWO_FOR_ONE', chainId: 'ch-s-b', productId: 'p-fideos' }),
    ],
  }, { storeVisitPenalty: '333.33', distancePenaltyPerKm: '12.34', maxStores: null });
  const sum = (values) => values.reduce((total, value) => total.add(DecimalValue.parse(value)), DecimalValue.zero(2)).toFixed(2);
  const { totals } = plan;
  assert.equal(totals.productCost, sum(plan.lines.map((line) => line.total)));
  assert.equal(totals.regularProductCost, sum(plan.lines.map((line) => line.regularTotal)));
  assert.equal(totals.promotionDiscount, sum(plan.lines.map((line) => line.discount)));
  assert.equal(sum([totals.productCost, totals.promotionDiscount]), totals.regularProductCost);
  assert.equal(totals.effectiveCost, sum([totals.productCost, totals.storeVisitPenaltyCost, totals.distancePenaltyCost]));
  assert.equal(totals.storeVisitPenaltyCost, DecimalValue.parse('333.33').multiply(DecimalValue.parse(String(totals.visitCount))).toFixed(2));
  assert.equal(sum(plan.visits.map((visit) => visit.subtotal)), totals.productCost);
  assert.equal(plan.savings.estimatedSavings, DecimalValue.parse(plan.baseline.productCost).subtract(DecimalValue.parse(totals.productCost)).toFixed(2));
  assert.equal(plan.baseline.method, 'SINGLE_STORE_REGULAR_PRICES');
  assert.equal(sum(plan.baseline.lines.map((line) => line.regularTotal)), plan.baseline.productCost);
});

test('promociones que no se pueden comprobar quedan afuera y se avisa', () => {
  const plan = optimize({
    needs: [need('c-x', '1')],
    stores: [store('s-a')],
    prices: [price('p-x', 's-a', '1000.00')],
    promotions: [
      promotion('banco', { type: 'BANK_DISCOUNT', chainId: 'ch-s-a', discountPercentage: '30.00', bank: 'Banco Demo', paymentMethod: 'CREDIT_CARD' }),
      promotion('minimo', { chainId: 'ch-s-a', discountPercentage: '10.00', minimumSpend: '20000.00' }),
    ],
  });
  assert.equal(plan.lines[0].total, '1000.00');
  assert.ok(codes(plan.limitations).includes('PAYMENT_PROMOTIONS_EXCLUDED'));
  assert.ok(codes(plan.limitations).includes('MINIMUM_SPEND_NOT_EVALUATED'));
});

test('cuenta de combinaciones: subconjuntos de hasta m sucursales con sus alternativas', () => {
  assert.equal(countCombinations([1, 1, 1], 3), 7);
  assert.equal(countCombinations([1, 1, 1], 1), 3);
  assert.equal(countCombinations([3, 1], 2), 3 + 1 + 3);
  assert.equal(countCombinations([], 0), 0);
});

// ------------------------------------------------------- candidatos sintéticos

/** PlanCandidates mínimos: el optimizador solo lee ofertas, fechas, sucursales y necesidades. */
function synthetic({ stores, dates, needs, origin = 'COORDINATES' }) {
  const byId = new Map(stores.map((entry) => [entry.id, entry]));
  return {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    window: WINDOW,
    scope: { origin, radiusKm: null, city: null, province: null },
    limits: LIMITS,
    maxAgeDays: 7,
    needs: needs.map((entry) => need(entry.id, '1')),
    skippedItems: [],
    candidates: {
      dates: { evaluated: dates, trimmed: [] },
      stores: {
        kept: stores.map((entry) => ({ ...store(entry.id, entry.distanceMeters), coverage: 1, cheapestCoveredTotal: '0.00' })),
        trimmed: [],
      },
      needs: needs.map((entry) => ({
        canonicalProductId: entry.id,
        exclusions: [],
        unresolvedReason: entry.offers.length ? null : 'NO_PRICE_IN_SCOPE',
        offers: entry.offers.map((offer) => {
          const productId = offer.product ?? `p-${entry.id}`;
          const totals = offer.totals.map((value) => DecimalValue.parse(value));
          const regular = totals.reduce((max, value) => (value.compare(max) > 0 ? value : max));
          return {
            id: `${productId}:${offer.store}`,
            productId,
            productName: productId,
            brand: null,
            storeId: offer.store,
            storeName: `Sucursal ${offer.store}`,
            chainId: `ch-${offer.store}`,
            chainName: `Cadena ${offer.store}`,
            distanceMeters: byId.get(offer.store).distanceMeters,
            matchType: 'ALTERNATIVE',
            preferredBrand: false,
            purchase: { saleMode: 'PACKAGED', units: '1', unitContent: '1', purchasedQuantity: '1', surplus: '0', quantityIsEstimate: false },
            priceBasis: { basis: 'LATEST_OBSERVATION', observationId: `obs-${productId}-${offer.store}`, price: regular.toFixed(2), unitPrice: regular.toFixed(2), unitPriceUnit: 'KG', currency: 'ARS', source: 'test', observedAt: YESTERDAY.toISOString(), ageDays: 1 },
            regularTotal: regular.toFixed(2),
            bestTotal: totals.reduce((min, value) => (value.compare(min) < 0 ? value : min)).toFixed(2),
            bestDates: [],
            dateOptions: dates.map((date, index) => ({
              date,
              total: totals[index].toFixed(2),
              discount: regular.subtract(totals[index]).toFixed(2),
              appliedPromotionId: null,
              promotions: [],
            })),
          };
        }),
      })),
      warnings: [],
    },
  };
}

/** Enumeración independiente: cada necesidad elige una opción (o ninguna) y se suman visitas y km. */
function bruteForce(instance, settings) {
  const cents = (value) => Math.round(Number(value) * 100);
  const distance = new Map(instance.candidates.stores.kept.map((entry) => [entry.id, entry.distanceMeters]));
  const options = instance.candidates.needs
    .filter((entry) => entry.offers.length)
    .map((entry) => [null, ...entry.offers.flatMap((offer) => offer.dateOptions.map((option) => ({ store: offer.storeId, date: option.date, total: cents(option.total) })))]);
  const visitPenalty = cents(settings.storeVisitPenalty);
  const perKm = cents(settings.distancePenaltyPerKm);
  let best = null;
  const picked = [];
  const walk = (index) => {
    if (index === options.length) {
      const chosen = picked.filter(Boolean);
      if (settings.maxStores !== null && new Set(chosen.map((option) => option.store)).size > settings.maxStores) return;
      const visits = new Set(chosen.map((option) => `${option.store}|${option.date}`));
      let cost = chosen.reduce((total, option) => total + option.total, 0) + visits.size * visitPenalty;
      for (const visit of visits) {
        const meters = distance.get(visit.split('|')[0]);
        // Distancias múltiplos de 100 m: ida y vuelta × $/km da centavos exactos.
        if (meters !== null) cost += (2 * meters * perKm) / 1000;
      }
      const uncovered = picked.length - chosen.length;
      if (!best || uncovered < best.uncovered || (uncovered === best.uncovered && cost < best.cost)) best = { uncovered, cost };
      return;
    }
    for (const option of options[index]) {
      picked.push(option);
      walk(index + 1);
      picked.pop();
    }
  };
  walk(0);
  return best;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInstance(next) {
  const pick = (values) => values[Math.floor(next() * values.length)];
  const origin = next() < 0.8 ? 'COORDINATES' : 'LOCALITY';
  const stores = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, index) => ({
    id: `s-${index}`,
    distanceMeters: origin === 'COORDINATES' ? 100 * (1 + Math.floor(next() * 50)) : null,
  }));
  const dates = WEEK.slice(0, 1 + Math.floor(next() * 3));
  const needs = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, index) => ({
    id: `c-${index}`,
    offers: stores.filter(() => next() < 0.7).map((entry) => {
      const base = 100 + Math.floor(next() * 2000) + Math.floor(next() * 100) / 100;
      return {
        store: entry.id,
        totals: dates.map(() => (next() < 0.3 ? base * (0.5 + next() / 2) : base).toFixed(2)),
      };
    }),
  }));
  const settings = {
    storeVisitPenalty: pick(['0.00', '50.00', '137.25', '400.00']),
    distancePenaltyPerKm: pick(['0.00', '10.00', '25.50']),
    maxStores: pick([null, 1, 2, 3]),
    maxCombinations: 1000000,
  };
  return { instance: synthetic({ stores, dates, needs, origin }), settings };
}

test('contraste con enumeración exhaustiva independiente en 200 canastas chicas (con límites de sucursales)', () => {
  const next = random(20260929);
  for (let run = 0; run < 200; run += 1) {
    const { instance, settings } = randomInstance(next);
    const plan = optimizePlan(instance, settings);
    const expected = bruteForce(instance, settings);
    const uncovered = plan.unfulfilled.filter((entry) => entry.reason === 'MAX_STORES_LIMIT').length;
    const context = `corrida ${run}: ${JSON.stringify(settings)}`;
    if (!instance.candidates.needs.some((entry) => entry.offers.length)) {
      assert.deepEqual([plan.search.method, plan.lines.length], ['NO_CANDIDATES', 0], context);
      continue;
    }
    assert.equal(plan.search.method, 'EXACT_BOUNDED', context);
    assert.equal(uncovered, expected.uncovered, context);
    assert.equal(plan.totals.effectiveCost, (expected.cost / 100).toFixed(2), context);
    if (settings.maxStores !== null) assert.ok(plan.totals.storeCount <= settings.maxStores, context);
  }
});

test('presupuesto excedido: método aproximado identificado que respeta las restricciones', () => {
  // 8 sucursales con 4 fechas útiles cada una: la búsqueda exacta supera el presupuesto.
  const dates = WEEK.slice(0, 4);
  const stores = Array.from({ length: 8 }, (_, index) => ({ id: `s-${index}`, distanceMeters: 100 * (index + 1) }));
  const needs = Array.from({ length: 4 }, (_, needIndex) => ({
    id: `c-${needIndex}`,
    offers: stores.map((entry, storeIndex) => ({
      store: entry.id,
      totals: dates.map((_, dateIndex) => String(1000 + storeIndex * 7 + (dateIndex === needIndex ? -300 : 0) + needIndex) + '.00'),
    })),
  }));
  const instance = synthetic({ stores, dates, needs });
  const base = { storeVisitPenalty: '100.00', distancePenaltyPerKm: '10.00', maxStores: 3 };

  const exact = optimizePlan(instance, { ...base, maxCombinations: 1000000 });
  assert.equal(exact.search.method, 'EXACT_BOUNDED');
  assert.equal(exact.search.exactCombinations, 8 * 15 + 28 * 15 ** 2 + 56 * 15 ** 3);

  for (const maxCombinations of [1000, 10]) {
    const approximate = optimizePlan(instance, { ...base, maxCombinations });
    assert.equal(approximate.search.method, 'HEURISTIC');
    assert.ok(codes(approximate.limitations).includes('SEARCH_BUDGET_EXCEEDED'));
    assert.equal(approximate.coverage, 'COMPLETE');
    assert.ok(approximate.totals.storeCount <= 3);
    assert.ok(DecimalValue.parse(approximate.totals.effectiveCost).compare(DecimalValue.parse(exact.totals.effectiveCost)) >= 0);
    assert.deepEqual(optimizePlan(instance, { ...base, maxCombinations }), approximate, 'determinista');
  }
});

test('ajustes inválidos se rechazan antes de optimizar', () => {
  const instance = synthetic({ stores: [{ id: 's-a', distanceMeters: 100 }], dates: WEEK.slice(0, 1), needs: [{ id: 'c-x', offers: [{ store: 's-a', totals: ['10.00'] }] }] });
  for (const settings of [
    { storeVisitPenalty: '-1.00' },
    { distancePenaltyPerKm: '-0.01' },
    { maxStores: 0 },
    { maxStores: 1.5 },
    { maxCombinations: 0 },
  ]) {
    assert.throws(() => optimizePlan(instance, { ...SETTINGS, ...settings }), RangeError);
  }
});
