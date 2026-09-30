// Jobs con BullMQ (P8-01) contra Redis y PostgreSQL/PostGIS reales. Ejecutar con `npm.cmd run test:db`.
// Último en scripts/test-db.cjs: importa datos simulados y genera planes. Usa un prefijo propio en
// Redis y lo borra al terminar: no toca las colas de desarrollo.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { after, before, describe, test } = require('node:test');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const { Client } = require('pg');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');
const { PrismaImportGateway } = require('../../dist/modules/imports/infrastructure/prisma-import.gateway');
const { ImportJobRunner } = require('../../dist/modules/jobs/application/import-jobs');
const { WEEKLY_PLAN_KEY_PREFIX } = require('../../dist/modules/jobs/application/weekly-plans.job');
const { jobIdFor, upcomingWeekStart } = require('../../dist/modules/jobs/domain/job-contracts');
const { JobConflictError, JobProducer } = require('../../dist/modules/jobs/infrastructure/job-producer');
const { RedisUnavailableError, startJobWorkers } = require('../../dist/modules/jobs/infrastructure/job-workers');
const { validateJobsEnvironment } = require('../../dist/modules/jobs/jobs.config');
const { createWorkerContext } = require('../../dist/modules/jobs/worker.module');
const { argentineToday } = require('../../dist/modules/routines/domain/routine-rules');
const { addDays } = require('../../dist/modules/shopping-plans/domain/plan-calendar');
const { demoCanonicalProductId, latestObservationAnchor, seedDemoCatalog } = require('../../dist/seed/seed-demo-catalog');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
if (!redisUrl) throw new Error('Los tests de jobs requieren REDIS_URL (docker compose up -d).');

const apiRoot = resolve(__dirname, '../..');
const PREFIX = `tusofertas-test-${process.pid}`;
const JWT_ACCESS_SECRET = 'integration-secret-with-at-least-32-chars';
const TODAY = argentineToday(new Date());
const WEEK = upcomingWeekStart(TODAY);
const POLLO = demoCanonicalProductId('pollo-entero');
// Coto Caballito (DEMO): con 5 km hay varias sucursales con pollo.
const CABALLITO = { latitude: '-34.6187', longitude: '-58.4407' };
const silent = new JsonLogger(() => {});

const filesDir = mkdtempSync(join(tmpdir(), 'tusofertas-jobs-'));
const jobsConfig = validateJobsEnvironment({
  REDIS_URL: redisUrl,
  JOBS_PREFIX: PREFIX,
  JOBS_ATTEMPTS: '2',
  JOBS_BACKOFF_MS: '10',
  JOBS_LOCK_DURATION_MS: '1000',
  JOBS_STALLED_INTERVAL_MS: '500',
  IMPORT_FILES_DIR: filesDir,
});

let context;
let producer;
let pg;
before(async () => {
  const apiConfig = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, JWT_ACCESS_SECRET });
  context = await createWorkerContext(apiConfig, jobsConfig, { NODE_ENV: 'test', DATABASE_URL: url }, silent);
  const prisma = context.app.get(require('../../dist/database/prisma.service').PrismaService);
  await seedDemoCatalog(prisma, { anchorDate: latestObservationAnchor(), historyDays: 31 });
  producer = new JobProducer(jobsConfig, 'tusofertas-test-cli');
  pg = new Client({ connectionString: url });
  await pg.connect();
});
after(async () => {
  await producer?.close();
  for (const name of ['imports', 'plans']) {
    const queue = new Queue(name, { connection: { url: redisUrl }, prefix: PREFIX });
    await queue.obliterate({ force: true });
    await queue.close();
  }
  await context?.app.close();
  await pg?.end();
  rmSync(filesDir, { recursive: true, force: true });
});

const count = async (sql, params = []) => (await pg.query(sql, params)).rows[0].n;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(jobId, states = ['completed', 'failed'], timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await producer.status(jobId);
    if (status && states.includes(status.state)) return status;
    if (Date.now() > deadline) throw new Error(`el job ${jobId} no llegó a ${states.join('/')} (estado: ${status?.state})`);
    await sleep(100);
  }
}

/** Datos del job como los arma el comando, con un ancla propia para no cruzarse con otros tests. */
const mockPrices = (overrides = {}) => ({
  v: 1,
  provider: 'mock',
  seed: 7,
  stores: 2,
  products: 3,
  days: 2,
  anchorDate: addDays(TODAY, -40),
  corruptEvery: 0,
  withoutEanEvery: 0,
  batchSize: 500,
  concurrency: 2,
  maxRetries: 0,
  ...overrides,
});
const enqueue = (name, payload, key) => producer.enqueue(name, payload, jobIdFor(name, payload, { today: TODAY, key }));
const pricesOfRun = (runId) => count('SELECT count(*)::int AS n FROM "ProductPrice" WHERE "importBatchId" = $1', [runId]);
const mockPricesBetween = (from, to) =>
  count(
    `SELECT count(*)::int AS n FROM "ProductPrice" WHERE "source" = 'mock-provider' AND "observedAt" >= $1::date AND "observedAt" < ($2::date + 1)`,
    [from, to],
  );

async function withWorkers(handlers, run, options = {}) {
  const runtime = await startJobWorkers(jobsConfig, handlers, silent, options);
  try {
    return await run(runtime);
  } finally {
    await runtime.close();
  }
}

let fixtures = 0;
/** Usuario con ubicación y una rutina de pollo; `anchorOffset` corre la rutina fuera de la semana. */
async function userWithRoutine({ frequencyDays = 7, anchorOffset = 0 } = {}) {
  const prisma = context.app.get(require('../../dist/database/prisma.service').PrismaService);
  const user = await prisma.user.create({
    data: { email: `jobs-${process.pid}-${fixtures++}@example.com`, passwordHash: 'fixture-sin-login', ...CABALLITO, maxTravelDistanceKm: '5' },
  });
  await prisma.shoppingRoutine.create({
    data: {
      userId: user.id,
      name: 'Compra semanal',
      frequencyDays,
      anchorDate: new Date(`${addDays(WEEK, anchorOffset)}T00:00:00Z`),
      items: { create: [{ canonicalProductId: POLLO, quantity: '2', unit: 'KG' }] },
    },
  });
  return user.id;
}

describe('jobs (P8-01)', () => {
  test('IMPORT_PRICES: el worker importa, registra la ejecución y deja el resultado en la cola', async () => {
    const payload = mockPrices();
    const first = await enqueue('IMPORT_PRICES', payload);
    assert.deepEqual([first.created, first.queue, first.name], [true, 'imports', 'IMPORT_PRICES']);

    const status = await withWorkers(context.handlers, () => waitFor(first.jobId));
    assert.equal(status.state, 'completed', status.failedReason);
    assert.deepEqual([status.result.status, status.result.read, status.result.created, status.attemptsMade], ['COMPLETED', 12, 12, 1]);
    assert.equal(await pricesOfRun(status.result.runId), 12);
    const { rows: [run] } = await pg.query('SELECT "status", "created" FROM "ImportRun" WHERE "id" = $1', [status.result.runId]);
    assert.deepEqual(run, { status: 'COMPLETED', created: 12 });

    const again = await enqueue('IMPORT_PRICES', payload);
    assert.deepEqual([again.jobId, again.created, again.state], [first.jobId, false, 'completed'], 'la misma ejecución lógica no se encola dos veces');
    await assert.rejects(producer.enqueue('IMPORT_PRICES', mockPrices({ seed: 8 }), first.jobId), JobConflictError, 'el mismo id con otros datos no se ignora');
  });

  test('IMPORT_PROMOTIONS y CHECK_PRICE_ALERTS: uno se procesa, el otro es solo contrato', async () => {
    const payload = { v: 1, provider: 'mock', anchorDate: addDays(TODAY, -1), batchSize: 200, maxRetries: 0 };
    const job = await enqueue('IMPORT_PROMOTIONS', payload);
    const status = await withWorkers(context.handlers, () => waitFor(job.jobId));
    assert.equal(status.state, 'completed', status.failedReason);
    assert.deepEqual([status.result.kind, status.result.status, status.result.read, status.result.rejected], ['promotions', 'COMPLETED_WITH_REJECTIONS', 6, 2]);
    await assert.rejects(enqueue('CHECK_PRICE_ALERTS', { v: 1, asOf: TODAY }), /fase 9/);
  });

  test('GENERATE_WEEKLY_PLANS: un borrador por usuario y semana, sin duplicar ni guardar planes vacíos', async () => {
    const withNeeds = await userWithRoutine();
    const withoutNeeds = await userWithRoutine({ frequencyDays: 30, anchorOffset: 10 });
    const one = await enqueue('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: WEEK, userId: withNeeds });
    const empty = await enqueue('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: WEEK, userId: withoutNeeds });

    const [oneStatus, emptyStatus, allStatus] = await withWorkers(context.handlers, async () => {
      const results = [await waitFor(one.jobId), await waitFor(empty.jobId)];
      // Después de los puntuales: el de todos los usuarios encuentra el plan ya guardado.
      const all = await enqueue('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: WEEK, userId: null });
      assert.equal(all.jobId, `weekly-plans-${WEEK}`);
      results.push(await waitFor(all.jobId));
      return results;
    });
    assert.equal(oneStatus.state, 'completed', oneStatus.failedReason);
    assert.deepEqual([oneStatus.result.users, oneStatus.result.created, oneStatus.result.weekEnd], [1, 1, addDays(WEEK, 6)]);
    assert.deepEqual([emptyStatus.result.users, emptyStatus.result.withoutNeeds, emptyStatus.result.created], [1, 1, 0]);

    const { rows: plans } = await pg.query(
      `SELECT "userId"::text AS user, "status", "startDate"::text AS start, "endDate"::text AS end FROM "ShoppingPlan" WHERE "idempotencyKey" = $1 AND "userId" = ANY($2::uuid[])`,
      [`${WEEKLY_PLAN_KEY_PREFIX}${WEEK}`, [withNeeds, withoutNeeds]],
    );
    assert.deepEqual(plans, [{ user: withNeeds, status: 'DRAFT', start: WEEK, end: addDays(WEEK, 6) }], 'un borrador y ningún plan vacío');

    assert.equal(allStatus.state, 'completed', allStatus.failedReason);
    const eligible = await count(
      `SELECT count(DISTINCT r."userId")::int AS n FROM "ShoppingRoutine" r JOIN "ShoppingRoutineItem" i ON i."routineId" = r."id"`,
    );
    const { users, created, replayed, withoutNeeds: none, skipped } = allStatus.result;
    assert.equal(users, eligible, 'todos los usuarios con rutinas con productos');
    assert.equal(created + replayed + none + Object.values(skipped).reduce((sum, n) => sum + n, 0), users);
    assert.ok(replayed >= 1, 'el usuario ya planificado se repite, no se duplica');
    assert.equal(await count(`SELECT count(*)::int AS n FROM "ShoppingPlan" WHERE "userId" = $1`, [withNeeds]), 1);
  });

  test('reintento: un intento que muere después de escribir se repite sin duplicar precios', async () => {
    const payload = mockPrices({ seed: 11, anchorDate: addDays(TODAY, -45) });
    const job = await enqueue('IMPORT_PRICES', payload);
    const handlers = {
      ...context.handlers,
      IMPORT_PRICES: async (data, jobContext) => {
        const result = await context.handlers.IMPORT_PRICES(data, jobContext);
        if (jobContext.attempt === 1) throw new Error('el proceso se cayó antes de confirmar');
        return result;
      },
    };
    const status = await withWorkers(handlers, () => waitFor(job.jobId));
    assert.equal(status.state, 'completed', status.failedReason);
    assert.deepEqual([status.attemptsMade, status.result.created, status.result.duplicates], [2, 0, 12], 'el segundo intento encuentra todo escrito');
    assert.equal(await mockPricesBetween(addDays(TODAY, -46), addDays(TODAY, -45)), 12, 'sin precios duplicados');
  });

  test('reintento: una importación que falla se reanuda desde su posición confirmada', async () => {
    const prisma = context.app.get(require('../../dist/database/prisma.service').PrismaService);
    const real = new PrismaImportGateway(prisma);
    let failing = true;
    let calls = 0;
    const gateway = {
      resolveStores: (...args) => real.resolveStores(...args),
      resolveProducts: (...args) => real.resolveProducts(...args),
      resolvePromotionScope: (...args) => real.resolvePromotionScope(...args),
      upsertPromotion: (...args) => real.upsertPromotion(...args),
      persistPrices: async (inputs) => {
        calls += 1;
        if (failing && calls === 3) throw new Error('la base no responde');
        return real.persistPrices(inputs);
      },
    };
    const runner = new ImportJobRunner({ prisma, importFilesDir: null, allowedHosts: [], blockedReason: null, gateway });
    const handlers = {
      ...context.handlers,
      IMPORT_PRICES: (data, jobContext) => {
        failing = jobContext.attempt === 1;
        return runner.importPrices(data, jobContext);
      },
    };
    const payload = mockPrices({ seed: 13, anchorDate: addDays(TODAY, -50), batchSize: 4, concurrency: 1 });
    const job = await enqueue('IMPORT_PRICES', payload);
    const status = await withWorkers(handlers, () => waitFor(job.jobId));
    assert.equal(status.state, 'completed', status.failedReason);
    assert.equal(status.attemptsMade, 2);
    const failedRunId = status.progress.importRunId;
    const { rows: [failed] } = await pg.query('SELECT "status", "committedPosition" FROM "ImportRun" WHERE "id" = $1', [failedRunId]);
    assert.deepEqual(failed, { status: 'FAILED', committedPosition: 8 });
    assert.deepEqual(
      [status.result.resumedFromId, status.result.read, status.result.created, status.result.committedPosition],
      [failedRunId, 4, 4, 12],
      'el reintento procesa solo lo posterior a lo confirmado',
    );
    assert.equal(await mockPricesBetween(addDays(TODAY, -51), addDays(TODAY, -50)), 12);
  });

  test('caída del worker: otro worker retoma el job en curso y no duplica', async () => {
    const payload = mockPrices({ seed: 17, anchorDate: addDays(TODAY, -55) });
    const job = await enqueue('IMPORT_PRICES', payload);
    let wrote = false;
    const dying = {
      ...context.handlers,
      // Escribe y "muere" antes de avisar a la cola: el job queda activo con su bloqueo.
      IMPORT_PRICES: async (data, jobContext) => {
        await context.handlers.IMPORT_PRICES(data, jobContext);
        wrote = true;
        return new Promise(() => {});
      },
    };
    const first = await startJobWorkers(jobsConfig, dying, silent, { connectionName: 'tusofertas-test-dying' });
    while (!wrote) await sleep(50);
    await Promise.all(first.workers.map((worker) => worker.close(true)));
    assert.equal((await producer.status(job.jobId)).state, 'active', 'el job quedó tomado por el worker caído');

    const status = await withWorkers(context.handlers, () => waitFor(job.jobId, ['completed', 'failed'], 20_000));
    assert.equal(status.state, 'completed', status.failedReason);
    assert.deepEqual([status.result.created, status.result.duplicates], [0, 12], 'lo retomó otro worker y encontró todo escrito');
    assert.equal(await mockPricesBetween(addDays(TODAY, -56), addDays(TODAY, -55)), 12);
  });

  test('apagado ordenado: espera el job en curso y libera las conexiones con Redis', async () => {
    const name = `tusofertas-test-shutdown-${process.pid}`;
    const slow = { ...context.handlers, GENERATE_WEEKLY_PLANS: async () => (await sleep(600), { slow: true }) };
    const job = await enqueue('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: addDays(WEEK, 7), userId: randomUUID() });
    const redis = new Redis(redisUrl);
    const runtime = await startJobWorkers(jobsConfig, slow, silent, { connectionName: name });
    try {
      // BullMQ renombra la conexión bloqueante del worker a `<prefijo>:<cola en base64>`.
      const connections = async () =>
        (await redis.client('LIST')).split('\n').filter((line) => line.includes(`name=${name}`) || line.includes(`name=${PREFIX}:`)).length;
      await waitFor(job.jobId, ['active']);
      assert.ok((await connections()) > 0, 'el worker tiene conexiones abiertas');
      await runtime.close();
      assert.equal((await producer.status(job.jobId)).state, 'completed', 'close esperó el job en curso');
      assert.equal(await connections(), 0, 'no quedan conexiones del worker');
    } finally {
      await redis.quit();
    }
  });

  test('Redis caído: encolar falla, el worker no arranca y el comando termina con error', async () => {
    const down = validateJobsEnvironment({ REDIS_URL: 'redis://127.0.0.1:1', JOBS_PREFIX: PREFIX });
    const offline = new JobProducer(down, 'tusofertas-test-offline');
    try {
      await assert.rejects(offline.enqueue('IMPORT_PRICES', mockPrices(), 'sin-redis'));
    } finally {
      await offline.close();
    }
    await assert.rejects(startJobWorkers(down, context.handlers, silent, { readyTimeoutMs: 1500 }), RedisUnavailableError);

    const cli = spawnSync('node', ['dist/modules/jobs/cli.js', 'counts'], {
      cwd: apiRoot,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, REDIS_URL: 'redis://:secreto-redis@127.0.0.1:1' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout, '', 'nada que parezca un resultado');
    assert.match(cli.stderr, /Redis no respondió/);
    assert.ok(!cli.stderr.includes('secreto-redis'));
  });

  test('el worker como proceso aparte arranca con la configuración y procesa jobs', async () => {
    const userId = await userWithRoutine();
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_ACCESS_SECRET,
      REDIS_URL: redisUrl,
      JOBS_PREFIX: PREFIX,
    };
    const child = spawn('node', ['dist/worker.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    try {
      const deadline = Date.now() + 20_000;
      while (!output.includes('worker_started')) {
        if (child.exitCode !== null || Date.now() > deadline) throw new Error(`el worker no arrancó: ${output.slice(-500)}`);
        await sleep(100);
      }
      const job = await enqueue('GENERATE_WEEKLY_PLANS', { v: 1, weekStart: WEEK, userId });
      const status = await waitFor(job.jobId);
      assert.equal(status.state, 'completed', status.failedReason);
      assert.equal(status.result.created, 1);
      assert.match(output, /"event":"job_completed"/);
      assert.ok(!output.includes(JWT_ACCESS_SECRET) && !output.includes(url), 'los logs no muestran secretos');
    } finally {
      child.kill();
    }
  });
});
