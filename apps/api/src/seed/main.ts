/**
 * Ejecutable del seed DEMO: `npm run db:seed` (raíz) o `npm run db:seed -w @tusofertas/api`.
 *
 * Opciones: `--anchor=AAAA-MM-DD` (día del precio más reciente, por defecto hoy)
 * y `--days=N` (días de historia, por defecto 31).
 *
 * No se ejecuta en producción ni contra una base remota sin `SEED_ALLOW_REMOTE=true`:
 * son datos ficticios y no deben mezclarse con datos reales. No borra nada.
 */
import { PrismaService } from '../database/prisma.service';
import { seedDemoCatalog } from './seed-demo-catalog';
import { DEFAULT_HISTORY_DAYS } from './seed-demo-catalog';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function fail(message: string): never {
  process.stderr.write(`db:seed — ${message}\n`);
  process.exit(1);
}

function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length);
}

function parseAnchor(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('--anchor debe tener el formato AAAA-MM-DD.');
  const anchor = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) fail('--anchor no es una fecha válida.');
  return anchor;
}

function parseDays(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 400) fail('--days debe ser un entero entre 1 y 400.');
  return days;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    fail('el seed DEMO no se ejecuta en producción: son datos ficticios.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('falta DATABASE_URL (ver .env.example).');

  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    fail('DATABASE_URL no es una URL válida.');
  }
  if (!LOCAL_HOSTS.has(host) && process.env.SEED_ALLOW_REMOTE !== 'true') {
    // El nombre del host no es un secreto; la URL completa sí puede serlo.
    fail(`la base "${host}" no es local; para cargar datos demo ahí, definir SEED_ALLOW_REMOTE=true.`);
  }

  const prisma = new PrismaService(databaseUrl);
  try {
    const summary = await seedDemoCatalog(prisma, {
      anchorDate: parseAnchor(readOption('anchor')),
      historyDays: parseDays(readOption('days')) ?? DEFAULT_HISTORY_DAYS,
    });
    process.stdout.write(
      [
        `db:seed — dataset DEMO (source=${summary.source}, lote=${summary.importBatchId})`,
        `  fecha ancla: ${summary.anchorDate} | historia: ${summary.historyDays} días`,
        `  categorías: ${summary.categories} | canónicos: ${summary.canonicalProducts} | productos: ${summary.products}`,
        `  cadenas: ${summary.chains} | sucursales: ${summary.stores}`,
        `  observaciones generadas: ${summary.observationsGenerated} | nuevas: ${summary.observationsInserted}`,
        '  Precios ficticios: no representan ofertas reales de esas cadenas.',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : 'error desconocido al cargar el dataset demo.');
});
