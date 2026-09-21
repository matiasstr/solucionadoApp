/**
 * Recrea la base de PRUEBA aislada (TEST_DATABASE_URL, nombre terminado en _test),
 * aplica migraciones dos veces, verifica que no haya drift contra el schema y corre
 * los tests de integración con PostgreSQL/PostGIS real. Nunca toca la base de desarrollo.
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
  run('tests de integración', 'node', [
    '--test',
    '--test-concurrency=1',
    'test/integration/database.test.cjs',
    'test/integration/auth.test.cjs',
    'test/integration/catalog.test.cjs',
    'test/integration/catalog-api.test.cjs',
  ]);
})();
