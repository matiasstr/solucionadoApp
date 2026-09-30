const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

/**
 * Dónde se permite importar (P7-01; también los jobs de P8-01): nunca en producción, y en
 * una base que no es local solo con `IMPORT_ALLOW_REMOTE=true`. Devuelve el motivo si no se
 * permite; el mensaje nombra el host, nunca la URL (puede llevar la contraseña).
 */
export function importTargetProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  if (env.NODE_ENV === 'production') return 'la importación no se ejecuta en producción.';
  const value = env.DATABASE_URL;
  if (!value) return 'falta DATABASE_URL (ver .env.example).';
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return 'DATABASE_URL no es una URL válida.';
  }
  if (!LOCAL_HOSTS.has(host) && env.IMPORT_ALLOW_REMOTE !== 'true') {
    return `la base "${host}" no es local; para importar ahí, definir IMPORT_ALLOW_REMOTE=true.`;
  }
  return null;
}
