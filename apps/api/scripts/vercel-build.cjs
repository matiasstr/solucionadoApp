/**
 * Build del proyecto Vercel `tusofertas-api` (ADR 0010): genera el cliente Prisma,
 * aplica las migraciones pendientes **solo en producción** y compila.
 *
 * La integración de Supabase inyecta `POSTGRES_URL_NON_POOLING` (conexión de sesión,
 * apta para migraciones); las credenciales nunca salen de Vercel ni se imprimen.
 * Nunca siembra el dataset DEMO.
 */
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const apiRoot = resolve(__dirname, '..');

function run(label, command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: apiRoot, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`vercel-build — ${label} terminó con código ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

run('prisma generate', 'npx', ['prisma', 'generate']);

if (process.env.VERCEL_ENV === 'production') {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!migrationUrl) {
    console.error('vercel-build — falta POSTGRES_URL_NON_POOLING (integración Supabase) o MIGRATION_DATABASE_URL.');
    process.exit(1);
  }
  console.log('vercel-build — aplicando migraciones pendientes');
  run('prisma migrate deploy', 'npx', ['prisma', 'migrate', 'deploy'], {
    ...process.env,
    DATABASE_URL: migrationUrl,
  });
} else {
  console.log(`vercel-build — entorno ${process.env.VERCEL_ENV ?? 'local'}: sin migraciones`);
}

run('build', 'npm', ['run', 'build']);
// Vercel exige un directorio de salida no vacío aunque la API sea solo una función.
mkdirSync(resolve(apiRoot, 'public'), { recursive: true });
writeFileSync(resolve(apiRoot, 'public/robots.txt'), 'User-agent: *\nDisallow: /\n');
