const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  parseSearchTerm,
} = require('../dist/modules/catalog/domain/search-term');

test('el texto se normaliza sin tildes ni puntuación para comparar', () => {
  assert.deepEqual(parseSearchTerm('Azúcar'), { kind: 'TEXT', normalized: 'azucar', raw: 'Azúcar' });
  // Con o sin tilde, la misma búsqueda.
  assert.equal(parseSearchTerm('almacén').normalized, parseSearchTerm('almacen').normalized);
  assert.equal(parseSearchTerm('  Arroz   Largo  ').normalized, 'arroz largo');
  assert.equal(parseSearchTerm('Gaseosa cola 2,25 L').normalized, 'gaseosa cola 2 25 l');
  // El texto original se conserva para buscar por marca sin normalizar.
  assert.equal(parseSearchTerm('Del Sur').raw, 'Del Sur');
});

test('un código de barras se busca exacto, conservando ceros a la izquierda', () => {
  assert.deepEqual(parseSearchTerm('2900000000018'), { kind: 'EAN', ean: '2900000000018' });
  assert.deepEqual(parseSearchTerm('00012345'), { kind: 'EAN', ean: '00012345' });
  // Menos de 8 dígitos no es un EAN: se busca como texto.
  assert.equal(parseSearchTerm('1234567').kind, 'TEXT');
  assert.equal(parseSearchTerm('123456789012345').kind, 'TEXT');
});

test('un término vacío o sin contenido no es una búsqueda', () => {
  for (const term of [undefined, '', '   ', '%', '- -', '!!']) {
    assert.deepEqual(parseSearchTerm(term), { kind: 'EMPTY' }, JSON.stringify(term));
  }
  // Una sola letra tampoco alcanza.
  assert.equal(parseSearchTerm('a').kind, 'EMPTY');
  assert.equal(parseSearchTerm('ñ').kind, 'EMPTY');
  assert.equal(MIN_SEARCH_LENGTH, 2);
});

test('el término se recorta al máximo admitido', () => {
  const long = 'a'.repeat(MAX_SEARCH_LENGTH + 50);
  const parsed = parseSearchTerm(long);
  assert.equal(parsed.kind, 'TEXT');
  assert.equal(parsed.raw.length, MAX_SEARCH_LENGTH);
  assert.equal(parsed.normalized.length, MAX_SEARCH_LENGTH);
});
