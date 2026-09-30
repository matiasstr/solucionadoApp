const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  IMPLEMENTED_JOBS,
  JOB_QUEUE,
  JobPayloadError,
  jobIdFor,
  parseJobPayload,
  samePayload,
  upcomingWeekStart,
  WORKER_QUEUES,
} = require('../dist/modules/jobs/domain/job-contracts');
const { validateJobsEnvironment } = require('../dist/modules/jobs/jobs.config');
const { importTargetProblem } = require('../dist/modules/imports/infrastructure/import-target');
const { producerConnection, workerConnection } = require('../dist/modules/jobs/infrastructure/redis-connection');

const tuning = { batchSize: 500, concurrency: 2, maxRetries: 2 };
const mock = { v: 1, provider: 'mock', seed: 1, stores: 5, products: 20, days: 7, anchorDate: '2026-09-28', corruptEvery: 0, withoutEanEvery: 0, ...tuning };
const jsonl = { v: 1, provider: 'jsonl', source: 'mi-fuente', decimalSeparator: ',', file: 'sepa/precios.jsonl.gz', url: null, ...tuning };

const rejects = (name, raw, field) =>
  assert.throws(() => parseJobPayload(name, raw), (error) => error instanceof JobPayloadError && error.fields.includes(field), `${name}: ${field}`);

test('contratos: nombres, colas y qué está implementado', () => {
  assert.deepEqual(JOB_QUEUE, { IMPORT_PRICES: 'imports', IMPORT_PROMOTIONS: 'imports', GENERATE_WEEKLY_PLANS: 'plans', CHECK_PRICE_ALERTS: 'alerts' });
  assert.deepEqual(IMPLEMENTED_JOBS, ['IMPORT_PRICES', 'IMPORT_PROMOTIONS', 'GENERATE_WEEKLY_PLANS']);
  assert.deepEqual(WORKER_QUEUES, ['imports', 'plans'], 'la cola de alertas no se consume hasta la fase 9');
  assert.deepEqual(parseJobPayload('CHECK_PRICE_ALERTS', { v: 1, asOf: '2026-09-29' }), { v: 1, asOf: '2026-09-29' });
});

test('datos de importación: válidos, completos y sin campos de más', () => {
  assert.deepEqual(parseJobPayload('IMPORT_PRICES', mock), mock);
  assert.deepEqual(parseJobPayload('IMPORT_PRICES', jsonl), jsonl);
  const byUrl = { ...jsonl, file: null, url: 'https://datos.example.gob.ar/precios.jsonl.gz' };
  assert.deepEqual(parseJobPayload('IMPORT_PRICES', byUrl), byUrl);
  const promotions = { v: 1, provider: 'mock', anchorDate: '2026-09-28', batchSize: 200, maxRetries: 2 };
  assert.deepEqual(parseJobPayload('IMPORT_PROMOTIONS', promotions), promotions);

  rejects('IMPORT_PRICES', { ...mock, v: 2 }, 'v');
  rejects('IMPORT_PRICES', { ...mock, extra: true }, 'extra');
  rejects('IMPORT_PRICES', { ...mock, anchorDate: undefined }, 'anchorDate');
  rejects('IMPORT_PRICES', { ...mock, anchorDate: '2026-02-30' }, 'anchorDate');
  rejects('IMPORT_PRICES', { ...mock, stores: 0 }, 'stores');
  rejects('IMPORT_PRICES', { ...mock, products: '20' }, 'products');
  rejects('IMPORT_PRICES', { ...mock, batchSize: 1001 }, 'batchSize');
  rejects('IMPORT_PRICES', { ...mock, provider: 'sepa' }, 'provider');
  rejects('IMPORT_PRICES', { ...jsonl, source: 'Mi Fuente' }, 'source');
  rejects('IMPORT_PRICES', { ...jsonl, decimalSeparator: ';' }, 'decimalSeparator');
  rejects('IMPORT_PRICES', { ...jsonl, url: 'https://x.example/p.jsonl' }, 'url');
  rejects('IMPORT_PRICES', { ...jsonl, file: null }, 'file');
  rejects('IMPORT_PROMOTIONS', { ...promotions, provider: 'jsonl' }, 'provider');
  assert.throws(() => parseJobPayload('IMPORT_PRICES', [mock]), JobPayloadError);
  assert.throws(() => parseJobPayload('IMPORT_PRICES', { ...mock, seed: 'x'.repeat(5000) }), /demasiado grandes/);
});

test('archivos y URLs: nada fuera del directorio permitido ni secretos en la cola', () => {
  for (const file of ['../secreto.jsonl', 'a/../../b.jsonl', '/etc/passwd.jsonl', 'C:\\datos\\p.jsonl', '.oculto.jsonl', 'a//b.jsonl', 'precios.csv', 'precios.jsonl.zip']) {
    rejects('IMPORT_PRICES', { ...jsonl, file }, 'file');
  }
  for (const url of [
    'https://usuario:clave@datos.example/p.jsonl',
    'https://datos.example/p.jsonl?token=abc',
    'https://datos.example/p.jsonl#x',
    'ftp://datos.example/p.jsonl',
    'no es una url',
  ]) {
    rejects('IMPORT_PRICES', { ...jsonl, file: null, url }, 'url');
  }
});

test('planes semanales: lunes, usuario opcional y semana por defecto', () => {
  assert.deepEqual(parseJobPayload('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-05', userId: null }), { v: 1, weekStart: '2026-10-05', userId: null });
  const user = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
  assert.equal(parseJobPayload('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-05', userId: user }).userId, user.toLowerCase());
  rejects('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-06', userId: null }, 'weekStart');
  rejects('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-05', userId: 'yo' }, 'userId');
  rejects('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-05' }, 'userId');

  assert.equal(upcomingWeekStart('2026-09-29'), '2026-10-05', 'martes: la semana siguiente');
  assert.equal(upcomingWeekStart('2026-10-04'), '2026-10-05', 'domingo: mañana');
  assert.equal(upcomingWeekStart('2026-10-05'), '2026-10-05', 'lunes: la que empieza hoy');
  assert.equal(upcomingWeekStart('2027-01-01'), '2027-01-04', 'cruza el año');
});

test('ids de job: una ejecución lógica, deterministas y aptos para BullMQ', () => {
  const today = '2026-09-29';
  const first = jobIdFor('IMPORT_PRICES', mock, { today });
  assert.match(first, /^prices-2026-09-29-[0-9a-f]{16}$/);
  assert.equal(jobIdFor('IMPORT_PRICES', { ...mock }, { today }), first, 'mismos datos, mismo día: mismo id');
  assert.equal(jobIdFor('IMPORT_PRICES', Object.fromEntries(Object.entries(mock).reverse()), { today }), first, 'el orden de las claves no importa');
  assert.notEqual(jobIdFor('IMPORT_PRICES', { ...mock, seed: 2 }, { today }), first, 'otros datos: otra ejecución');
  assert.notEqual(jobIdFor('IMPORT_PRICES', mock, { today: '2026-09-30' }), first, 'otro día: otra ejecución');
  assert.equal(jobIdFor('IMPORT_PRICES', mock, { today, key: 'reproceso-1' }), 'prices-reproceso-1');
  assert.equal(jobIdFor('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-05', userId: null }, { today }), 'weekly-plans-2026-10-05');
  assert.throws(() => jobIdFor('IMPORT_PRICES', mock, { today, key: 'con:dos-puntos' }), JobPayloadError);
  assert.throws(() => jobIdFor('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: '2026-10-05', userId: null }, { today, key: 'otra' }), JobPayloadError);
  for (const id of [first, 'weekly-plans-2026-10-05', jobIdFor('CHECK_PRICE_ALERTS', { v: 1, asOf: today }, { today })]) {
    assert.ok(!id.includes(':') && !/^\d+$/.test(id), id);
  }
  assert.ok(samePayload({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(!samePayload({ a: 1 }, { a: 2 }));
});

test('configuración de jobs: valores por defecto y errores sin valores', () => {
  const config = validateJobsEnvironment({ REDIS_URL: 'redis://localhost:6379', IMPORT_ALLOWED_HOSTS: ' datos.example.gob.ar , ,otro.example ' });
  assert.deepEqual(
    [config.prefix, config.attempts, config.backoffMs, config.concurrency, config.lockDurationMs, config.importFilesDir, config.allowedHosts],
    ['tusofertas', 3, 30000, { imports: 1, plans: 2 }, 60000, null, ['datos.example.gob.ar', 'otro.example']],
  );
  assert.equal(validateJobsEnvironment({ REDIS_URL: 'rediss://:secreto@redis.example:6380', JOBS_ATTEMPTS: '5' }).attempts, 5);

  const secret = 'redis-secreto-no-mostrar';
  assert.throws(
    () => validateJobsEnvironment({ REDIS_URL: `http://${secret}@localhost`, JOBS_PREFIX: 'Con:Dos', JOBS_ATTEMPTS: '0', IMPORT_FILES_DIR: 'relativo/dir' }),
    (error) => error.message === 'Configuración de jobs inválida: IMPORT_FILES_DIR, JOBS_ATTEMPTS, JOBS_PREFIX, REDIS_URL' && !error.message.includes(secret),
  );
  assert.throws(() => validateJobsEnvironment({}), /REDIS_URL/);
});

test('conexiones: el worker reconecta siempre; el comando falla rápido', () => {
  const worker = workerConnection('redis://localhost:6379', 'w');
  assert.equal(worker.maxRetriesPerRequest, null);
  const producer = producerConnection('redis://localhost:6379', 'p');
  assert.equal(producer.enableOfflineQueue, false);
  assert.equal(producer.retryStrategy(1), 200);
  assert.equal(producer.retryStrategy(3), null, 'después de dos reintentos se rinde');
});

test('destino de importación: nunca producción ni una base remota sin permiso explícito', () => {
  const local = 'postgresql://u:clave-secreta@localhost:5432/db';
  assert.equal(importTargetProblem({ DATABASE_URL: local }), null);
  assert.match(importTargetProblem({ NODE_ENV: 'production', DATABASE_URL: local }), /producción/);
  const remote = importTargetProblem({ DATABASE_URL: 'postgresql://u:clave-secreta@db.example.com:5432/db' });
  assert.match(remote, /db\.example\.com.*IMPORT_ALLOW_REMOTE/);
  assert.ok(!remote.includes('clave-secreta'));
  assert.equal(importTargetProblem({ DATABASE_URL: 'postgresql://u@db.example.com/db', IMPORT_ALLOW_REMOTE: 'true' }), null);
  assert.match(importTargetProblem({}), /DATABASE_URL/);
});

const {
  importRunIdOf,
  isPermanentFailure,
  resolveAnchorDate,
  resolveWeekStart,
} = require('../dist/modules/jobs/domain/job-contracts');
const { startHealthServer } = require('../dist/modules/jobs/infrastructure/worker-health');

test('programaciones: fechas relativas con reloj controlado, en hora argentina', () => {
  // Domingo 20:00 en Argentina (23:00 UTC): la semana que empieza el lunes siguiente.
  assert.equal(resolveWeekStart(null, new Date('2026-10-04T23:00:00Z')), '2026-10-05');
  // Domingo 23:30 en Argentina, ya lunes en UTC: sigue siendo domingo acá.
  assert.equal(resolveWeekStart(null, new Date('2026-10-05T02:30:00Z')), '2026-10-05');
  // Lunes 00:00 en Argentina: la semana que empieza hoy.
  assert.equal(resolveWeekStart(null, new Date('2026-10-05T03:00:00Z')), '2026-10-05');
  assert.equal(resolveWeekStart(null, new Date('2026-10-06T12:00:00Z')), '2026-10-12', 'martes: la siguiente');
  assert.equal(resolveWeekStart('2026-10-19', new Date('2026-10-04T23:00:00Z')), '2026-10-19', 'una fecha fija gana');

  // Ancla del simulado: el día anterior en Argentina.
  assert.equal(resolveAnchorDate(null, new Date('2026-10-01T09:30:00Z')), '2026-09-30');
  assert.equal(resolveAnchorDate(null, new Date('2026-10-01T02:00:00Z')), '2026-09-29', 'miércoles 23:00 en Argentina');
  assert.equal(resolveAnchorDate('2026-09-01', new Date('2026-10-01T09:30:00Z')), '2026-09-01');

  assert.equal(parseJobPayload('IMPORT_PRICES', { ...mock, anchorDate: null }).anchorDate, null);
  assert.equal(parseJobPayload('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: null, userId: null }).weekStart, null);
  assert.equal(jobIdFor('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: null, userId: null }, { today: '2026-09-30' }), 'weekly-plans-proxima');
});

test('progreso de un job: marca de falla permanente e id de la ejecución', () => {
  const runId = '0b9f7f0c-8a3c-4c1e-9a55-3c1d2f6b7e10';
  assert.ok(isPermanentFailure({ failure: 'permanent', importRunId: runId }));
  assert.ok(!isPermanentFailure({ importRunId: runId }));
  assert.ok(!isPermanentFailure(0));
  assert.equal(importRunIdOf({ importRunId: runId }), runId);
  assert.equal(importRunIdOf({ runId, created: 3 }), runId, 'también desde el resultado');
  assert.equal(importRunIdOf({ importRunId: 'no-es-uuid' }), null);
  assert.equal(importRunIdOf(null), null);
});

test('configuración de operación: umbrales, frescura y servidor de salud', () => {
  const base = { REDIS_URL: 'redis://localhost:6379' };
  const defaults = validateJobsEnvironment(base);
  assert.deepEqual([defaults.staleRunMinutes, defaults.priceMaxAgeDays, defaults.health], [30, 7, null]);
  const custom = validateJobsEnvironment({ ...base, JOBS_STALE_RUN_MINUTES: '45', PRICE_MAX_AGE_DAYS: '3', WORKER_HEALTH_PORT: '8080', WORKER_HEALTH_HOST: '0.0.0.0' });
  assert.deepEqual([custom.staleRunMinutes, custom.priceMaxAgeDays, custom.health], [45, 3, { port: 8080, host: '0.0.0.0' }]);
  assert.throws(() => validateJobsEnvironment({ ...base, WORKER_HEALTH_PORT: '0', JOBS_STALE_RUN_MINUTES: '1' }), /JOBS_STALE_RUN_MINUTES, WORKER_HEALTH_PORT/);
});

test('servidor de salud del worker: vivo, listo según Redis y la base, y nada más', async () => {
  let alive = true;
  let database = 'up';
  const server = await startHealthServer({ host: '127.0.0.1', port: 0, alive: () => alive, checks: async () => ({ redis: 'up', database }) });
  const get = async (path, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method });
    return [response.status, await response.json()];
  };
  try {
    assert.deepEqual(await get('/health'), [200, { status: 'ok', service: 'tusofertas-worker' }]);
    assert.deepEqual(await get('/ready'), [200, { status: 'ok', service: 'tusofertas-worker', checks: { redis: 'up', database: 'up' } }]);
    database = 'down';
    assert.deepEqual((await get('/ready'))[0], 503);
    assert.deepEqual((await get('/otra'))[0], 404);
    assert.deepEqual((await get('/health', 'POST'))[0], 405);
    alive = false;
    database = 'up';
    assert.deepEqual(await get('/health'), [503, { status: 'stopping', service: 'tusofertas-worker' }]);
    assert.equal((await get('/ready'))[0], 503, 'mientras se apaga no está listo');
  } finally {
    await server.close();
  }
});

test('instante de un job: el programado (desde el id del turno) o el de encolado', () => {
  const { scheduledFor } = require('../dist/modules/jobs/infrastructure/job-workers');
  const sunday = Date.UTC(2026, 9, 4, 23, 0, 0);
  assert.equal(scheduledFor({ id: `repeat:weekly-plans:${sunday}`, repeatJobKey: 'weekly-plans', timestamp: sunday - 5_000 }).getTime(), sunday);
  assert.equal(scheduledFor({ id: 'weekly-plans-2026-10-05', repeatJobKey: undefined, timestamp: 123_000 }).getTime(), 123_000);
  assert.equal(scheduledFor({ id: 'repeat:raro', repeatJobKey: 'raro', timestamp: 456_000 }).getTime(), 456_000, 'un id sin instante usa el de encolado');
});
