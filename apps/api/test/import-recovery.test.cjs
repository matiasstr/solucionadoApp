const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CommitWatermark, withRetries } = require('../dist/modules/imports/domain/recovery');
const { assertAllowedUrl } = require('../dist/modules/imports/infrastructure/providers/json-lines-price.provider');
const { ImportProviderError, sanitizeError } = require('../dist/modules/imports/application/import-run');
const { BatchRunError } = require('../dist/modules/imports/domain/batching');

test('reintentos: un error pasajero se supera; uno persistente se propaga tras el máximo', async () => {
  let calls = 0;
  const retried = [];
  const value = await withRetries(async () => {
    calls += 1;
    if (calls < 3) throw new Error('pasajero');
    return 'listo';
  }, { retries: 2, delayMs: 0, onRetry: (attempt) => retried.push(attempt) });
  assert.equal(value, 'listo');
  assert.deepEqual(retried, [1, 2]);

  let attempts = 0;
  await assert.rejects(withRetries(async () => {
    attempts += 1;
    throw new Error('siempre');
  }, { retries: 2, delayMs: 0 }), /siempre/);
  assert.equal(attempts, 3, 'primer intento + 2 reintentos');

  let validation = 0;
  await assert.rejects(withRetries(async () => {
    validation += 1;
    throw new RangeError('regla inválida');
  }, { retries: 5, delayMs: 0, shouldRetry: (error) => !(error instanceof RangeError) }), RangeError);
  assert.equal(validation, 1, 'lo que no mejora reintentando no se reintenta');

  for (const options of [{ retries: -1, delayMs: 0 }, { retries: 6, delayMs: 0 }, { retries: 1, delayMs: -5 }]) {
    await assert.rejects(withRetries(async () => 1, options), RangeError);
  }
});

test('marca de confirmado: avanza solo sin huecos aunque los lotes terminen en desorden', () => {
  const watermark = new CommitWatermark();
  const first = watermark.open(10);
  const second = watermark.open(25);
  const third = watermark.open(31);
  assert.equal(watermark.complete(third), 0, 'el tercero terminó pero faltan los anteriores');
  assert.equal(watermark.complete(first), 10);
  assert.equal(watermark.complete(second), 31, 'al completarse el hueco avanza hasta el tercero');
  assert.equal(watermark.finish(40), 40, 'al terminar bien, los rechazos del final también quedan resueltos');

  const resumed = new CommitWatermark(120);
  const next = resumed.open(130);
  assert.equal(resumed.committed, 120, 'arranca desde lo confirmado antes');
  assert.equal(resumed.complete(next), 130);
});

test('URL de una fuente: solo hosts permitidos, HTTPS y sin credenciales', () => {
  const allowed = ['datos.example.gob.ar', '127.0.0.1'];
  assert.equal(assertAllowedUrl('https://datos.example.gob.ar/precios.jsonl.gz', allowed).hostname, 'datos.example.gob.ar');
  assert.equal(assertAllowedUrl('http://127.0.0.1:8080/precios.jsonl', allowed).port, '8080', 'HTTP solo en la máquina local');
  for (const [url, message] of [
    ['https://otro.example.com/precios.jsonl', /no está entre los permitidos/],
    ['http://datos.example.gob.ar/precios.jsonl', /HTTPS/],
    ['https://usuario:clave@datos.example.gob.ar/p.jsonl', /credenciales/],
    ['ftp://datos.example.gob.ar/p.jsonl', /HTTPS/],
    ['no es una url', /no es válida/],
    ['https://DATOS.example.gob.ar.evil.com/p.jsonl', /no está entre los permitidos/],
  ]) {
    assert.throws(() => assertAllowedUrl(url, allowed), (error) => error instanceof ImportProviderError && message.test(error.message));
  }
  assert.throws(() => assertAllowedUrl('https://datos.example.gob.ar/p.jsonl', []), /no está entre los permitidos/);
});

test('errores saneados: sin mensajes crudos ni credenciales', () => {
  assert.equal(sanitizeError(new Error('postgresql://usuario:clave@host/db falló')), 'Error inesperado (Error).');
  assert.equal(sanitizeError(Object.assign(new Error('detalle interno'), { code: 'P2002' })), 'Error de base de datos (P2002).');
  assert.equal(sanitizeError(new BatchRunError(new ImportProviderError('El archivo supera el tamaño máximo.'), { batches: 1, maxHeldItems: 1 })), 'El archivo supera el tamaño máximo.');
});
