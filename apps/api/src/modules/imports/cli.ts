/**
 * Importación manual (P7-01): `npm.cmd run import -- --provider=mock` (raíz) o
 * `npm run import -w @tusofertas/api -- …`. Sin jobs ni servicios externos.
 *
 *   --provider=mock   [--stores=5] [--products=20] [--days=7] [--seed=1] [--anchor=AAAA-MM-DD]
 *                     [--corrupt-every=0] [--without-ean-every=0] [--promotions]
 *   --provider=jsonl  --file=ruta.jsonl[.gz] --source=nombre [--decimal=,|.]
 *   comunes:          [--batch-size=500] [--concurrency=2]
 *
 * Imprime el resumen en JSON y termina con código 1 si la ejecución falló. No corre
 * en producción ni contra una base remota sin `IMPORT_ALLOW_REMOTE=true`.
 */
import { PrismaService } from '../../database/prisma.service';
import { PriceImporter } from './application/price-importer';
import { PromotionImporter } from './application/promotion-importer';
import type { PriceProvider } from './application/ports';
import { PrismaImportGateway } from './infrastructure/prisma-import.gateway';
import { JsonLinesPriceProvider } from './infrastructure/providers/json-lines-price.provider';
import { MockPriceProvider, MockPromotionProvider } from './infrastructure/providers/mock-price.provider';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function fail(message: string): never {
  process.stderr.write(`import — ${message}\n`);
  process.exit(1);
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const flag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) fail(`--${name} debe ser un entero entre ${min} y ${max}.`);
  return value;
}

function provider(): PriceProvider {
  const kind = option('provider') ?? 'mock';
  if (kind === 'mock') {
    const anchor = option('anchor');
    if (anchor !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) fail('--anchor debe tener el formato AAAA-MM-DD.');
    return new MockPriceProvider({
      seed: integer('seed', 1, 0, 1_000_000),
      stores: integer('stores', 5, 1, 1000),
      products: integer('products', 20, 1, 100_000),
      days: integer('days', 7, 1, 400),
      anchorDate: anchor,
      corruptEvery: integer('corrupt-every', 0, 0, 1_000_000),
      withoutEanEvery: integer('without-ean-every', 0, 0, 1_000_000),
    });
  }
  if (kind === 'jsonl') {
    const file = option('file');
    const source = option('source');
    const decimal = option('decimal') ?? ',';
    if (!file || !source) fail('--provider=jsonl necesita --file y --source.');
    if (decimal !== ',' && decimal !== '.') fail('--decimal debe ser "," o ".".');
    return new JsonLinesPriceProvider({ path: file, source, decimalSeparator: decimal });
  }
  return fail('--provider debe ser mock o jsonl.');
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') fail('la importación manual no se ejecuta en producción.');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('falta DATABASE_URL (ver .env.example).');
  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    fail('DATABASE_URL no es una URL válida.');
  }
  if (!LOCAL_HOSTS.has(host) && process.env.IMPORT_ALLOW_REMOTE !== 'true') {
    // El nombre del host no es un secreto; la URL completa sí puede serlo.
    fail(`la base "${host}" no es local; para importar ahí, definir IMPORT_ALLOW_REMOTE=true.`);
  }

  const batchSize = integer('batch-size', 500, 1, 10_000);
  const concurrency = integer('concurrency', 2, 1, 16);
  const source = provider();
  const prisma = new PrismaService(databaseUrl);
  let failed = false;
  try {
    const gateway = new PrismaImportGateway(prisma);
    const prices = await new PriceImporter(gateway).run(source, { batchSize, concurrency });
    process.stdout.write(`${JSON.stringify(prices, null, 2)}\n`);
    failed = prices.status === 'FAILED';
    if (!failed && flag('promotions') && source instanceof MockPriceProvider) {
      const promotions = await new PromotionImporter(gateway).run(new MockPromotionProvider(option('anchor')), { batchSize });
      process.stdout.write(`${JSON.stringify(promotions, null, 2)}\n`);
      failed = promotions.status === 'FAILED';
    }
  } finally {
    await prisma.$disconnect();
  }
  if (failed) process.exit(1);
}

main().catch((error: unknown) => {
  // Sin detalles del error: puede incluir la URL de la base.
  process.stderr.write(`import — error inesperado${error instanceof Error ? ` (${error.name})` : ''}.\n`);
  process.exit(1);
});
