/**
 * URL de la base para el despliegue en Vercel (ADR 0010).
 *
 * La integración de Supabase expone `POSTGRES_URL` (pooler en modo transacción) y
 * no `DATABASE_URL`. `pg` 8 trata `sslmode=require` como `verify-full`, y la CA de
 * Supabase no está en el almacén de Node: por eso se usa la CA pública del proyecto
 * (`certs/supabase-ca.crt`, descargada del panel de Supabase) y se verifica
 * certificado **e** identidad del servidor. Sin ese archivo el arranque falla: no se
 * degrada a una conexión sin verificar.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const SUPABASE_CA = resolve(__dirname, '../certs/supabase-ca.crt');

function withSupabaseCa(raw, caPath = SUPABASE_CA) {
  if (!existsSync(caPath)) throw new Error('Falta certs/supabase-ca.crt (CA pública de Supabase).');
  const url = new URL(raw);
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', caPath);
  // `pgbouncer` es un parámetro de Prisma sin adaptador; `pg` no lo usa.
  url.searchParams.delete('pgbouncer');
  return url.toString();
}

/** `DATABASE_URL` explícita gana; si no, la del pooler de la integración, verificada con la CA. */
function resolveDatabaseUrl(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  return env.POSTGRES_URL ? withSupabaseCa(env.POSTGRES_URL) : undefined;
}

module.exports = { resolveDatabaseUrl, withSupabaseCa };
