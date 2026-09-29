const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildCandidates } = require('../dist/modules/shopping-plans/domain/candidates');
const { resolvePlanWindow } = require('../dist/modules/shopping-plans/domain/plan-calendar');

// Lunes 2026-09-28 a domingo 2026-10-04; el martes es 2026-09-29.
const WEEK = resolvePlanWindow({ startDate: '2026-09-28' }, 28).dates;
const NOW = new Date('2026-09-28T18:00:00.000Z');
const YESTERDAY = new Date('2026-09-27T12:00:00.000Z');
const COORDINATES = { origin: 'COORDINATES', radiusKm: 5, city: null, province: null };
const LIMITS = { maxStores: 8, maxOffersPerStore: 2, maxDates: 7 };

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
  product('p-aceite-900', 'c-aceite', { quantity: '900', unit: 'ML', brand: 'Del Sur' }),
  product('p-aceite-15', 'c-aceite', { quantity: '1.5', unit: 'L', brand: 'Del Sur' }),
  product('p-arroz-pampa', 'c-arroz', { brand: 'Pampa' }),
  product('p-arroz-pampa-500', 'c-arroz', { quantity: '500', unit: 'G', brand: 'Pampa' }),
  product('p-arroz-delsur', 'c-arroz', { brand: 'Del Sur' }),
  product('p-fideos', 'c-fideos', { quantity: '500', unit: 'G', brand: 'Pampa' }),
];

const store = (id, distanceMeters, chainId = `ch-${id}`) => ({
  id,
  name: `Sucursal ${id}`,
  chainId,
  chainName: `Cadena ${id}`,
  city: 'Ciudad Autónoma de Buenos Aires',
  province: 'Ciudad Autónoma de Buenos Aires',
  distanceMeters,
});
const STORES = [store('s-a', 1200), store('s-b', 800), store('s-c', null)];

const price = (productId, storeId, value, observedAt = YESTERDAY) => ({
  id: `obs-${productId}-${storeId}`,
  productId,
  storeId,
  price: value,
  unitPrice: value,
  unitPriceUnit: 'KG',
  currency: 'ARS',
  source: 'demo-seed',
  observedAt,
  ingestedAt: observedAt,
});

const need = (canonicalProductId, netQuantity, overrides = {}) => ({
  canonicalProductId,
  canonicalName: canonicalProductId,
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
  name: id,
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

const run = (overrides) => buildCandidates({
  needs: [],
  products: PRODUCTS,
  stores: STORES,
  prices: [],
  promotions: [],
  dates: WEEK,
  scope: COORDINATES,
  limits: LIMITS,
  now: NOW,
  maxAgeDays: 7,
  ...overrides,
});
const reasons = (result, index = 0) =>
  result.needs[index].exclusions.map((exclusion) => [exclusion.productId, exclusion.storeId, exclusion.reason]);

test('venta por peso: 3 kg de pollo se compran exactos y el precio usado es una estimación con fecha', () => {
  const result = run({ needs: [need('c-pollo', '3')], prices: [price('p-pollo', 's-a', '3290.00')] });
  const [offer] = result.needs[0].offers;
  assert.equal(offer.id, 'p-pollo:s-a');
  assert.deepEqual(offer.purchase, {
    saleMode: 'VARIABLE_WEIGHT',
    units: '3',
    unitContent: '1',
    purchasedQuantity: '3',
    surplus: '0',
    quantityIsEstimate: true,
  });
  assert.equal(offer.regularTotal, '9870.00');
  assert.equal(offer.bestTotal, '9870.00');
  assert.deepEqual(offer.priceBasis, {
    basis: 'LATEST_OBSERVATION',
    observationId: 'obs-p-pollo-s-a',
    price: '3290.00',
    unitPrice: '3290.00',
    unitPriceUnit: 'KG',
    currency: 'ARS',
    source: 'demo-seed',
    observedAt: '2026-09-27T12:00:00.000Z',
    ageDays: 1,
  });
  assert.equal(offer.distanceMeters, 1200);
  assert.equal(offer.dateOptions.length, 7);
  assert.equal(result.needs[0].unresolvedReason, null);
});

test('envases enteros: 3 L de aceite en botellas de 900 ml dejan 0,6 L de excedente visible', () => {
  const result = run({
    needs: [need('c-aceite', '3', { unit: 'L' })],
    prices: [price('p-aceite-900', 's-a', '2890.00'), price('p-aceite-15', 's-a', '4590.00')],
  });
  const byProduct = Object.fromEntries(result.needs[0].offers.map((offer) => [offer.productId, offer]));
  assert.deepEqual(
    [byProduct['p-aceite-900'].purchase.units, byProduct['p-aceite-900'].purchase.purchasedQuantity, byProduct['p-aceite-900'].purchase.surplus],
    ['4', '3.6', '0.6'],
  );
  assert.equal(byProduct['p-aceite-900'].regularTotal, '11560.00');
  assert.deepEqual(
    [byProduct['p-aceite-15'].purchase.units, byProduct['p-aceite-15'].purchase.surplus],
    ['2', '0'],
  );
  assert.equal(byProduct['p-aceite-15'].regularTotal, '9180.00');
  assert.deepEqual(result.needs[0].offers.map((offer) => offer.productId), ['p-aceite-15', 'p-aceite-900'], 'más barata primero');
});

test('un preferido sin reemplazos se mantiene exacto: el resto queda descartado con su motivo', () => {
  const result = run({
    needs: [need('c-arroz', '2', { constraints: { allowSubstitutes: false, requiredProductId: 'p-arroz-pampa' } })],
    prices: [
      price('p-arroz-pampa', 's-a', '1290.00'),
      price('p-arroz-delsur', 's-a', '1180.00'),
      price('p-arroz-pampa-500', 's-a', '720.00'),
    ],
  });
  assert.deepEqual(result.needs[0].offers.map((offer) => [offer.productId, offer.matchType]), [['p-arroz-pampa', 'EXACT']]);
  assert.deepEqual(reasons(result), [
    ['p-arroz-delsur', null, 'SUBSTITUTION_NOT_ALLOWED'],
    ['p-arroz-pampa-500', null, 'SUBSTITUTION_NOT_ALLOWED'],
  ]);
});

test('un preferido desactivado: sin reemplazos la necesidad queda sin resolver; con reemplazos se ofrecen alternativas', () => {
  const inactive = PRODUCTS.map((entry) => (entry.id === 'p-arroz-pampa' ? { ...entry, isActive: false } : entry));
  const prices = [price('p-arroz-pampa', 's-a', '1290.00'), price('p-arroz-delsur', 's-a', '1180.00')];
  const strict = run({
    products: inactive,
    prices,
    needs: [need('c-arroz', '1', { constraints: { allowSubstitutes: false, requiredProductId: 'p-arroz-pampa' } })],
  });
  assert.equal(strict.needs[0].unresolvedReason, 'PREFERRED_PRODUCT_UNAVAILABLE');
  assert.deepEqual(strict.needs[0].offers, []);
  assert.deepEqual(reasons(strict)[1], ['p-arroz-pampa', null, 'PRODUCT_INACTIVE']);

  const flexible = run({
    products: inactive,
    prices,
    needs: [need('c-arroz', '1', { constraints: { preferredProductIds: ['p-arroz-pampa'] } })],
  });
  assert.equal(flexible.needs[0].unresolvedReason, null);
  assert.deepEqual(flexible.needs[0].offers.map((offer) => [offer.productId, offer.matchType]), [['p-arroz-delsur', 'ALTERNATIVE']]);
});

test('marcas: la excluida se descarta sin distinguir mayúsculas ni tildes y la preferida se marca', () => {
  const result = run({
    needs: [need('c-arroz', '1', { constraints: { excludedBrands: ['DEL SUR'], preferredBrands: ['pampa'] } })],
    prices: [price('p-arroz-pampa', 's-a', '1290.00'), price('p-arroz-delsur', 's-a', '1180.00')],
  });
  assert.deepEqual(result.needs[0].offers.map((offer) => [offer.productId, offer.preferredBrand]), [['p-arroz-pampa', true]]);
  assert.deepEqual(reasons(result).find(([productId]) => productId === 'p-arroz-delsur'), ['p-arroz-delsur', null, 'BRAND_EXCLUDED']);
});

test('una presentación de otra dimensión nunca es candidata', () => {
  const litros = [...PRODUCTS, product('p-arroz-raro', 'c-arroz', { quantity: '1', unit: 'L' })];
  const result = run({ products: litros, needs: [need('c-arroz', '1')], prices: [price('p-arroz-pampa', 's-a', '1290.00')] });
  assert.ok(reasons(result).some(([productId, , reason]) => productId === 'p-arroz-raro' && reason === 'UNIT_MISMATCH'));
});

test('precio viejo: se descarta con su antigüedad; si es lo único que hay, la necesidad lo dice', () => {
  const old = new Date('2026-09-16T12:00:00.000Z');
  const mixed = run({
    needs: [need('c-arroz', '1', { constraints: { allowSubstitutes: false, requiredProductId: 'p-arroz-pampa' } })],
    prices: [price('p-arroz-pampa', 's-a', '990.00', old), price('p-arroz-pampa', 's-b', '1290.00')],
  });
  assert.deepEqual(mixed.needs[0].offers.map((offer) => offer.storeId), ['s-b'], 'el precio viejo y barato no gana');
  const stale = mixed.needs[0].exclusions.find((exclusion) => exclusion.reason === 'PRICE_STALE');
  assert.deepEqual(stale, { productId: 'p-arroz-pampa', storeId: 's-a', reason: 'PRICE_STALE', ageDays: 12 });

  const onlyStale = run({ needs: [need('c-arroz', '1')], prices: [price('p-arroz-pampa', 's-a', '990.00', old)] });
  assert.equal(onlyStale.needs[0].unresolvedReason, 'ONLY_STALE_PRICES');
});

test('sin precio en las sucursales del alcance la necesidad se conserva sin ofertas', () => {
  const result = run({ needs: [need('c-pollo', '1')], prices: [price('p-pollo', 's-lejana', '3000.00')] });
  assert.equal(result.needs[0].unresolvedReason, 'NO_PRICE_IN_SCOPE');
  assert.deepEqual(reasons(result), [['p-pollo', null, 'NO_PRICE_IN_SCOPE']]);
  assert.equal(run({ needs: [need('c-pollo', '1')], stores: [] }).needs[0].unresolvedReason, 'NO_STORES_IN_SCOPE');
  assert.equal(run({ needs: [need('c-inexistente', '1')] }).needs[0].unresolvedReason, 'NO_ELIGIBLE_PRODUCT');
});

test('sin ubicación no hay sucursales: nada se inventa y se avisa', () => {
  const result = run({
    scope: { origin: 'NONE', radiusKm: null, city: null, province: null },
    needs: [need('c-pollo', '3'), need('c-arroz', '1')],
    prices: [price('p-pollo', 's-a', '3290.00')],
  });
  assert.deepEqual(result.needs.map((entry) => entry.unresolvedReason), ['NO_LOCATION', 'NO_LOCATION']);
  assert.deepEqual(result.stores.kept, []);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['LOCATION_MISSING']);
});

test('solo localidad: se avisa que el radio y la distancia no se pueden garantizar', () => {
  const result = run({
    scope: { origin: 'LOCALITY', radiusKm: null, city: 'Morón', province: 'Buenos Aires' },
    stores: [store('s-moron', null)],
    needs: [need('c-pollo', '1')],
    prices: [price('p-pollo', 's-moron', '3100.00')],
  });
  assert.equal(result.needs[0].offers[0].distanceMeters, null);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['LOCATION_APPROXIMATE']);
});

test('promociones por fecha: la de los martes solo abarata el martes y la bancaria nunca se aplica', () => {
  const result = run({
    needs: [need('c-arroz', '2')],
    stores: [store('s-a', 1200, 'ch-vea')],
    prices: [price('p-arroz-delsur', 's-a', '1180.00')],
    products: PRODUCTS.filter((entry) => entry.id === 'p-arroz-delsur'),
    promotions: [
      promotion('promo-martes', { chainId: 'ch-vea', canonicalProductId: 'c-arroz', discountPercentage: '15.00', eligibleWeekdays: [2] }),
      promotion('promo-banco', { type: 'BANK_DISCOUNT', chainId: 'ch-vea', discountPercentage: '25.00', bank: 'Banco Demo', paymentMethod: 'CREDIT_CARD' }),
      promotion('promo-otra-cadena', { chainId: 'ch-coto', discountPercentage: '50.00' }),
    ],
  });
  const [offer] = result.needs[0].offers;
  assert.equal(offer.regularTotal, '2360.00');
  assert.equal(offer.bestTotal, '2006.00');
  assert.deepEqual(offer.bestDates, ['2026-09-29']);
  const tuesday = offer.dateOptions.find((option) => option.date === '2026-09-29');
  assert.deepEqual([tuesday.total, tuesday.discount, tuesday.appliedPromotionId], ['2006.00', '354.00', 'promo-martes']);
  const monday = offer.dateOptions.find((option) => option.date === '2026-09-28');
  assert.equal(monday.total, '2360.00');
  assert.deepEqual(monday.promotions.map((check) => [check.promotionId, check.skipReason]), [
    ['promo-banco', 'PAYMENT_CONDITIONED'],
    ['promo-martes', 'WEEKDAY_NOT_ELIGIBLE'],
  ], 'la de otra cadena no se lista: no alcanza a esta oferta');
});

test('un 2×1 necesita dos envases: con uno se informa sin ahorro, con dos cobra uno', () => {
  const setup = (quantity) => run({
    needs: [need('c-fideos', quantity)],
    prices: [price('p-fideos', 's-a', '1450.00')],
    promotions: [promotion('promo-2x1', { type: 'TWO_FOR_ONE', chainId: 'ch-s-a', productId: 'p-fideos' })],
  }).needs[0].offers[0];
  const one = setup('0.5');
  assert.equal(one.purchase.units, '1');
  assert.equal(one.bestTotal, '1450.00');
  assert.equal(one.dateOptions[0].promotions[0].skipReason, 'NO_SAVINGS');
  const two = setup('1');
  assert.equal(two.purchase.units, '2');
  assert.deepEqual([two.regularTotal, two.bestTotal], ['2900.00', '1450.00']);
});

test('recorte de sucursales: quedan las que cubren más necesidades; el resto se registra', () => {
  const result = run({
    limits: { ...LIMITS, maxStores: 1 },
    needs: [need('c-pollo', '1'), need('c-arroz', '1'), need('c-fideos', '0.5')],
    prices: [
      price('p-pollo', 's-a', '3290.00'),
      price('p-arroz-delsur', 's-a', '1180.00'),
      price('p-pollo', 's-b', '2990.00'),
      price('p-fideos', 's-b', '1450.00'),
      price('p-fideos', 's-c', '1400.00'),
    ],
  });
  // s-a y s-b cubren dos necesidades; s-a suma 4470 y s-b 4440: gana s-b por la canasta cubierta.
  assert.deepEqual(result.stores.kept.map((entry) => [entry.id, entry.coverage, entry.cheapestCoveredTotal]), [['s-b', 2, '4440.00']]);
  assert.deepEqual(result.stores.trimmed.map((entry) => entry.id), ['s-a', 's-c']);
  assert.equal(result.needs[1].unresolvedReason, 'ONLY_IN_TRIMMED_STORES', 'el arroz solo estaba en s-a');
  assert.deepEqual(reasons(result, 1), [
    ['p-arroz-delsur', 's-a', 'STORE_LIMIT'],
    ['p-arroz-pampa', null, 'NO_PRICE_IN_SCOPE'],
    ['p-arroz-pampa-500', null, 'NO_PRICE_IN_SCOPE'],
  ]);
  assert.deepEqual(result.needs[0].offers.map((offer) => offer.storeId), ['s-b']);
  assert.ok(result.warnings.some((warning) => warning.code === 'STORES_TRIMMED'));
});

test('ante igual cobertura y costo gana la sucursal más cercana; sin distancia va al final', () => {
  const result = run({
    limits: { ...LIMITS, maxStores: 2 },
    needs: [need('c-pollo', '1')],
    prices: [price('p-pollo', 's-a', '3000.00'), price('p-pollo', 's-b', '3000.00'), price('p-pollo', 's-c', '3000.00')],
  });
  assert.deepEqual(result.stores.kept.map((entry) => entry.id), ['s-b', 's-a']);
  assert.deepEqual(result.stores.trimmed.map((entry) => entry.id), ['s-c']);
});

test('recorte de ofertas por sucursal: las más baratas y además la presentación preferida', () => {
  const result = run({
    limits: { ...LIMITS, maxOffersPerStore: 1 },
    needs: [need('c-arroz', '1', { constraints: { preferredProductIds: ['p-arroz-pampa'] } })],
    prices: [
      price('p-arroz-pampa', 's-a', '1290.00'),
      price('p-arroz-delsur', 's-a', '1180.00'),
      price('p-arroz-pampa-500', 's-a', '720.00'),
    ],
  });
  // 1 kg con envases de 500 g son dos envases: 1440, más caro que Del Sur.
  assert.deepEqual(result.needs[0].offers.map((offer) => [offer.productId, offer.matchType, offer.bestTotal]), [
    ['p-arroz-delsur', 'ALTERNATIVE', '1180.00'],
    ['p-arroz-pampa', 'EXACT', '1290.00'],
  ]);
  assert.deepEqual(reasons(result), [['p-arroz-pampa-500', 's-a', 'OFFER_LIMIT']]);
});

test('fechas: se evalúan las primeras de la ventana y el recorte se informa', () => {
  const fortnight = resolvePlanWindow({ startDate: '2026-09-28', endDate: '2026-10-07' }, 28).dates;
  const result = run({ dates: fortnight, needs: [need('c-pollo', '1')], prices: [price('p-pollo', 's-a', '3290.00')] });
  assert.equal(result.dates.evaluated.length, 7);
  assert.deepEqual(result.dates.trimmed, ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.equal(result.needs[0].offers[0].dateOptions.length, 7);
  assert.ok(result.warnings.some((warning) => warning.code === 'DATES_TRIMMED'));
});

test('conflictos y necesidades cubiertas: el conflicto se informa y lo cubierto no busca ofertas', () => {
  const result = run({
    needs: [
      need('c-arroz', '1', { status: 'CONFLICT', constraints: { allowSubstitutes: false } }),
      need('c-pollo', '0', { status: 'COVERED_BY_INVENTORY' }),
    ],
    prices: [price('p-arroz-pampa', 's-a', '1290.00'), price('p-pollo', 's-a', '3290.00')],
  });
  assert.deepEqual(result.needs.map((entry) => [entry.canonicalProductId, entry.unresolvedReason]), [
    ['c-arroz', 'CONFLICTING_EXACT_PRODUCTS'],
  ]);
});

test('determinista: el orden de productos, precios, sucursales y promociones no cambia el resultado', () => {
  const input = {
    needs: [need('c-pollo', '3'), need('c-arroz', '2'), need('c-aceite', '3', { unit: 'L' })],
    prices: [
      price('p-pollo', 's-a', '3290.00'),
      price('p-pollo', 's-b', '3290.00'),
      price('p-arroz-delsur', 's-a', '1180.00'),
      price('p-arroz-pampa', 's-b', '1180.00'),
      price('p-aceite-900', 's-c', '2890.00'),
      price('p-aceite-15', 's-b', '4590.00'),
    ],
    promotions: [
      promotion('promo-2', { chainId: 'ch-s-b', discountPercentage: '10.00', eligibleWeekdays: [3] }),
      promotion('promo-1', { chainId: 'ch-s-a', canonicalProductId: 'c-arroz', discountPercentage: '10.00' }),
    ],
    limits: { ...LIMITS, maxStores: 2, maxOffersPerStore: 1 },
  };
  const forward = run(input);
  const backward = run({
    ...input,
    products: [...PRODUCTS].reverse(),
    stores: [...STORES].reverse(),
    prices: [...input.prices].reverse(),
    promotions: [...input.promotions].reverse(),
  });
  assert.deepEqual(backward, forward);
});
