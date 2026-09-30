/**
 * Recrea la base de PRUEBA aislada (TEST_DATABASE_URL, nombre terminado en _test),
 * aplica migraciones dos veces, verifica que no haya drift contra el schema y corre
 * los tests de integración con PostgreSQL/PostGIS y Redis reales. Nunca toca la base de
 * desarrollo ni las colas de desarrollo (los jobs usan un prefijo propio).
 */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { config } = require('dotenv');
const { Client } = require('pg');

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const apiRoot = resolve(__dirname, '..');

function fail(message) {
  console.error(`test:db — ${message}`);
  process.exit(1);
}

const raw = process.env.TEST_DATABASE_URL;
if (!raw) fail('falta TEST_DATABASE_URL (ver .env.example).');
const testUrl = new URL(raw);
const dbName = decodeURIComponent(testUrl.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(dbName)) fail('el nombre de la base de prueba debe terminar en _test.');
if (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === testUrl.pathname) {
  fail('TEST_DATABASE_URL no puede apuntar a la misma base que DATABASE_URL.');
}

const env = { ...process.env, DATABASE_URL: raw };

/**
 * Orden real de ejecución. Los primeros conservan el orden alfabético con el que se
 * escribieron (`catalog.test` asume que `catalog-api` ya sembró la base); los que agregan
 * datos a la base compartida (precios nuevos, sucursales simuladas) van al final.
 */
const INTEGRATION_FILES = [
  'test/integration/auth.test.cjs',
  'test/integration/catalog-api.test.cjs',
  'test/integration/catalog.test.cjs',
  'test/integration/database.test.cjs',
  'test/integration/promotions.test.cjs',
  'test/integration/routines-api.test.cjs',
  'test/integration/search-api.test.cjs',
  'test/integration/shopping-plans-api.test.cjs',
  'test/integration/shopping-plans.test.cjs',
  'test/integration/price-history.test.cjs',
  'test/integration/dashboard.test.cjs',
  'test/integration/imports.test.cjs',
  // Necesita Redis (docker compose): usa un prefijo propio y lo borra al terminar.
  'test/integration/jobs.test.cjs',
];
function run(label, command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, { cwd: apiRoot, env, shell: process.platform === 'win32', encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (capture) process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? '');
    fail(`${label} terminó con código ${result.status}.`);
  }
  return result.stdout ?? '';
}

async function recreateDatabase() {
  const adminUrl = new URL(raw);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

(async () => {
  await recreateDatabase().catch(() => fail('no se pudo recrear la base de prueba; ¿está corriendo docker compose?'));
  console.log(`test:db — base ${dbName} recreada`);
  run('migrate deploy', 'npx', ['prisma', 'migrate', 'deploy']);
  const second = run('migrate deploy (repetido)', 'npx', ['prisma', 'migrate', 'deploy'], { capture: true });
  if (!/No pending migrations/i.test(second)) fail('la segunda aplicación de migraciones no fue un no-op.');
  run('migrate diff (drift)', 'npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
  run('build', 'npm', ['run', 'build']);
  // Un proceso por archivo y en este orden: `node --test` ordena los archivos alfabéticamente,
  // y los últimos agregan datos a la base compartida (precios nuevos, sucursales simuladas).
  const totals = { tests: 0, pass: 0, fail: 0 };
  const failed = [];
  for (const file of INTEGRATION_FILES) {
    const result = spawnSync('node', ['--test', '--test-concurrency=1', file], { cwd: apiRoot, env, encoding: 'utf8' });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    for (const key of Object.keys(totals)) {
      const match = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(result.stdout ?? '');
      totals[key] += match ? Number(match[1]) : 0;
    }
    if (result.status !== 0) failed.push(file);
  }
  console.log(`test:db — total: ${totals.tests} tests, ${totals.pass} ok, ${totals.fail} con fallas (${INTEGRATION_FILES.length} archivos)`);
  if (failed.length) fail(`fallaron: ${failed.join(', ')}.`);
})();
