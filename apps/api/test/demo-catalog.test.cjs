const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEMO_CANONICAL_PRODUCTS,
  DEMO_CATEGORIES,
  DEMO_CHAINS,
  DEMO_PRODUCTS,
  DEMO_STORES,
  DEMO_SOURCE,
  eanCheckDigit,
  demoEan,
} = require('../dist/seed/demo-catalog');
const { demoId, uuidV5, stableHash32 } = require('../dist/seed/demo-id');
const { baseUnitOf } = require('../dist/modules/catalog/domain/units');

const canonicalByKey = new Map(DEMO_CANONICAL_PRODUCTS.map((canonical) => [canonical.key, canonical]));
const categorySlugs = new Set(DEMO_CATEGORIES.map((category) => category.slug));

test('el dataset demo es coherente: referencias, claves y dimensiones', () => {
  assert.equal(DEMO_SOURCE, 'demo-seed');
  const duplicated = (values) => values.length !== new Set(values).size;
  assert.equal(duplicated(DEMO_PRODUCTS.map((product) => product.key)), false);
  assert.equal(duplicated(DEMO_STORES.map((store) => store.key)), false);
  assert.equal(duplicated(DEMO_CATEGORIES.map((category) => category.slug)), false);
  assert.equal(duplicated(DEMO_CANONICAL_PRODUCTS.map((canonical) => canonical.key)), false);

  for (const category of DEMO_CATEGORIES) {
    if (category.parentSlug) assert.equal(categorySlugs.has(category.parentSlug), true);
  }
  for (const canonical of DEMO_CANONICAL_PRODUCTS) {
    assert.equal(categorySlugs.has(canonical.categorySlug), true, canonical.key);
  }
  const chainKeys = new Set(DEMO_CHAINS.map((chain) => chain.key));
  for (const store of DEMO_STORES) {
    assert.equal(chainKeys.has(store.chainKey), true, store.key);
    // Coordenadas completas o ninguna: sin ambas no se puede informar distancia.
    assert.equal(store.latitude === undefined, store.longitude === undefined, store.key);
  }
  for (const product of DEMO_PRODUCTS) {
    const canonical = canonicalByKey.get(product.canonicalKey);
    assert.ok(canonical, `${product.key} referencia un canónico inexistente`);
    assert.equal(baseUnitOf(product.unit), canonical.defaultUnit, product.key);
    assert.equal(Number.isInteger(product.basePriceCents) && product.basePriceCents > 0, true, product.key);
    if (product.saleMode === 'VARIABLE_WEIGHT') assert.notEqual(product.unit, 'UNIT', product.key);
  }
});

test('cubre presentaciones comparables, venta por peso y packs', () => {
  const byCanonical = new Map();
  for (const product of DEMO_PRODUCTS) {
    byCanonical.set(product.canonicalKey, (byCanonical.get(product.canonicalKey) ?? 0) + 1);
  }
  // Al menos un canónico con varias presentaciones: sirve para comparar precio por unidad.
  assert.ok([...byCanonical.values()].filter((count) => count > 1).length >= 5);
  assert.ok(DEMO_PRODUCTS.some((product) => product.saleMode === 'VARIABLE_WEIGHT'));
  assert.ok(DEMO_PRODUCTS.some((product) => (product.packageCount ?? 1) > 1));
  assert.ok(DEMO_PRODUCTS.some((product) => product.eanSeed === undefined));
  assert.ok(DEMO_STORES.some((store) => store.latitude === undefined));
  assert.ok(DEMO_STORES.some((store) => (store.stopsDaysBeforeAnchor ?? 0) > 0));
  assert.ok(DEMO_STORES.length >= 10 && DEMO_CHAINS.length === 5);
});

test('los EAN demo llevan dígito de control válido y no se repiten', () => {
  // EAN-13 conocido: el dígito de control de 400638133393 es 1.
  assert.equal(eanCheckDigit('400638133393'), '1');
  assert.equal(demoEan('400638133393'), '4006381333931');
  assert.throws(() => eanCheckDigit('123'), RangeError);
  const eans = DEMO_PRODUCTS.filter((product) => product.eanSeed).map((product) => demoEan(product.eanSeed));
  assert.equal(eans.length, new Set(eans).size);
  for (const ean of eans) assert.match(ean, /^29\d{11}$/);
});

test('los ids demo son deterministas, válidos y distintos por tipo de entidad', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(demoId('product', 'arroz-pampa-1kg'), uuid);
  assert.equal(demoId('product', 'arroz-pampa-1kg'), demoId('product', 'arroz-pampa-1kg'));
  assert.notEqual(demoId('product', 'arroz-pampa-1kg'), demoId('store', 'arroz-pampa-1kg'));
  // Vector de prueba RFC 4122: namespace DNS con el nombre "www.example.org".
  assert.equal(
    uuidV5('www.example.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    '74738ff5-5367-5958-9aee-98fffdcd1876',
  );
  assert.equal(stableHash32('demo'), stableHash32('demo'));
  assert.equal(Number.isInteger(stableHash32('demo')), true);
});
