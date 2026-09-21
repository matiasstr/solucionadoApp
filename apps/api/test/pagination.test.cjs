const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  CursorError,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  keysetFilter,
  toPage,
  toPaginatedDto,
} = require('../dist/common/pagination');
const { parseCursorOrFail, requireUuid } = require('../dist/common/query');

test('el cursor va y vuelve sin perder la clave ni el id', () => {
  const cursor = { key: 'arroz largo fino pampa 1 kg', id: '7f1c2a3b-4d5e-5f60-8a1b-2c3d4e5f6071' };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  // Es opaco: no expone el orden interno en la URL.
  assert.equal(encodeCursor(cursor).includes(' '), false);
});

test('rechaza cursores que no generó la API', () => {
  const rejects = (raw) => assert.throws(() => decodeCursor(raw), (error) => error instanceof CursorError, raw);
  for (const raw of ['', 'no-base64!!', Buffer.from('{}').toString('base64url'), Buffer.from('["solo"]').toString('base64url'), Buffer.from('["clave",""]').toString('base64url'), Buffer.from('[1,2]').toString('base64url')]) {
    rejects(raw);
  }
  assert.throws(() => parseCursorOrFail('roto'), (error) => error.getStatus() === 400 && error.fields[0] === 'cursor');
  assert.equal(parseCursorOrFail(undefined), null);
});

test('la página devuelve cursor solo cuando hay más resultados', () => {
  const rows = [{ id: 'a', name: 'uno' }, { id: 'b', name: 'dos' }, { id: 'c', name: 'tres' }];
  const cursorOf = (row) => ({ key: row.name, id: row.id });
  const full = toPage(rows, 2, cursorOf);
  assert.equal(full.items.length, 2);
  assert.deepEqual(decodeCursor(full.nextCursor), { key: 'dos', id: 'b' });
  const last = toPage(rows.slice(0, 2), 2, cursorOf);
  assert.equal(last.items.length, 2);
  assert.equal(last.nextCursor, null);
  assert.deepEqual(toPage([], 10, cursorOf), { items: [], nextCursor: null });
});

test('el filtro keyset ordena por (clave, id) sin saltear filas', () => {
  assert.deepEqual(keysetFilter('normalizedName', null), {});
  assert.deepEqual(keysetFilter('normalizedName', { key: 'leche', id: 'abc' }), {
    OR: [
      { normalizedName: { gt: 'leche' } },
      { AND: [{ normalizedName: 'leche' }, { id: { gt: 'abc' } }] },
    ],
  });
});

test('la forma pública de una página es estable', () => {
  const page = { items: [{ id: 'a' }], nextCursor: null };
  assert.deepEqual(toPaginatedDto(page, 20, (item) => ({ id: item.id })), {
    items: [{ id: 'a' }],
    page: { limit: 20, nextCursor: null },
  });
  assert.equal(DEFAULT_PAGE_LIMIT, 20);
  assert.equal(MAX_PAGE_LIMIT, 50);
});

test('un identificador mal formado es 400, no 404', () => {
  const valid = '7f1c2a3b-4d5e-5f60-8a1b-2c3d4e5f6071';
  assert.equal(requireUuid(valid.toUpperCase()), valid);
  for (const invalid of ['', 'abc', '7f1c2a3b-4d5e-5f60-8a1b', `${valid}x`, "' OR 1=1--"]) {
    assert.throws(
      () => requireUuid(invalid),
      (error) => error.getStatus() === 400 && error.error === 'VALIDATION_FAILED' && error.fields[0] === 'id',
      invalid,
    );
  }
});
