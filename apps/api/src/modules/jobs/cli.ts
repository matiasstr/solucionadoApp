/**
 * Jobs manuales (P8-01/P8-02, ADR 0020 y 0021): `npm.cmd run jobs -- …` (raíz). Encola, programa y
 * consulta; el trabajo lo hace `npm.cmd run worker`. Ningún endpoint HTTP expone esto.
 *
 *   enqueue IMPORT_PRICES          [--provider=mock [--stores=5] [--products=20] [--days=7] [--seed=1] [--anchor=AAAA-MM-DD]
 *                                    [--corrupt-every=0] [--without-ean-every=0]]
 *                                  [--provider=jsonl --source=nombre (--file=relativa-a-IMPORT_FILES_DIR | --url=https://…) [--decimal=,|.]]
 *                                  [--batch-size=500] [--concurrency=2] [--max-retries=2] [--key=clave]
 *   enqueue IMPORT_PROMOTIONS      [--anchor=AAAA-MM-DD] [--batch-size=200] [--max-retries=2] [--key=clave]
 *   enqueue GENERATE_WEEKLY_PLANS  [--week=AAAA-MM-DD (lunes; por defecto, la próxima semana)] [--user=<uuid>]
 *   schedule <JOB> --cron="m h dm M dw" [mismas opciones que enqueue; sin --anchor/--week las fechas son relativas] [--id=…]
 *   schedules | unschedule <id>
 *   status <id del job> | counts | failed [--limit=20] | retry <id del job> [--force]
 *   report                          estado de colas, programaciones, fallidos, importaciones, frescura y planes
 *   close-stale-runs                cierra ejecuciones de importación abiertas sin avance (JOBS_STALE_RUN_MINUTES)
 *
 * Imprime JSON y termina con código 1 si algo falló, incluido Redis sin responder: nunca
 * informa algo que no ocurrió.
 */
import { PrismaService } from '../../database/prisma.service';
import { ImportProviderError } from '../imports/application/import-run';
import { importTargetProblem } from '../imports/infrastructure/import-target';
import { PrismaImportRunRecorder } from '../imports/infrastructure/prisma-import-run.recorder';
import { assertAllowedUrl } from '../imports/infrastructure/providers/json-lines-price.provider';
import { argentineToday } from '../routines/domain/routine-rules';
import { addDays } from '../shopping-plans/domain/plan-calendar';
import { PermanentJobError } from './application/job-context';
import { OperationsReport } from './application/operations-report';
import { isJobName, jobIdFor, JobPayloadError, parseJobPayload, upcomingWeekStart } from './domain/job-contracts';
import type { JobName, JobPayloads } from './domain/job-contracts';
import { JobConflictError, JobProducer, JobRetryError } from './infrastructure/job-producer';
import { validateJobsEnvironment } from './jobs.config';
import type { JobsConfig } from './jobs.config';

/** Cuántas semanas adelante se pueden pedir planes: los precios más lejanos son estimaciones viejas. */
const MAX_WEEKS_AHEAD = 4;

class CliError extends Error {}

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const flag = (name: string): boolean => args.includes(`--${name}`);

/** Enteros como número; cualquier otra cosa pasa tal cual y la rechaza el contrato. */
function numeric(name: string, fallback: number): unknown {
  const raw = option(name);
  if (raw === undefined) return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

/**
 * Datos del job desde las opciones. Al encolar, las fechas por defecto se fijan hoy; en una
 * programación (`relative`) quedan en null y se resuelven con el instante programado de cada job.
 */
function rawPayload(name: JobName, today: string, config: JobsConfig, relative: boolean): Record<string, unknown> {
  const defaultAnchor = relative ? null : addDays(today, -1);
  if (name === 'IMPORT_PRICES') {
    const tuning = { batchSize: numeric('batch-size', 500), concurrency: numeric('concurrency', 2), maxRetries: numeric('max-retries', 2) };
    const provider = option('provider') ?? 'mock';
    if (provider === 'jsonl') {
      const url = option('url') ?? null;
      if (url !== null) assertAllowedUrl(url, config.allowedHosts);
      return { v: 1, provider, source: option('source'), decimalSeparator: option('decimal') ?? ',', file: option('file') ?? null, url, ...tuning };
    }
    return {
      v: 1,
      provider,
      seed: numeric('seed', 1),
      stores: numeric('stores', 5),
      products: numeric('products', 20),
      days: numeric('days', 7),
      anchorDate: option('anchor') ?? defaultAnchor,
      corruptEvery: numeric('corrupt-every', 0),
      withoutEanEvery: numeric('without-ean-every', 0),
      ...tuning,
    };
  }
  if (name === 'IMPORT_PROMOTIONS') {
    return { v: 1, provider: 'mock', anchorDate: option('anchor') ?? defaultAnchor, batchSize: numeric('batch-size', 200), maxRetries: numeric('max-retries', 2) };
  }
  if (name === 'GENERATE_WEEKLY_PLANS') {
    const thisWeek = addDays(upcomingWeekStart(today), upcomingWeekStart(today) === today ? 0 : -7);
    const weekStart = option('week') ?? (relative ? null : upcomingWeekStart(today));
    if (weekStart !== null && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) && (weekStart < thisWeek || weekStart > addDays(thisWeek, 7 * MAX_WEEKS_AHEAD))) {
      throw new CliError(`--week debe ser un lunes entre ${thisWeek} y ${addDays(thisWeek, 7 * MAX_WEEKS_AHEAD)}.`);
    }
    return { v: 1, weekStart, userId: option('user') ?? null };
  }
  return { v: 1, asOf: option('as-of') ?? today };
}

function jobArgument(): JobName {
  const name = positional[1];
  if (!isJobName(name)) throw new CliError('indicá IMPORT_PRICES, IMPORT_PROMOTIONS o GENERATE_WEEKLY_PLANS.');
  if (name === 'IMPORT_PRICES' || name === 'IMPORT_PROMOTIONS') {
    // Mismo resguardo que el worker: se avisa antes de dejar un job que igual se rechazaría.
    const problem = importTargetProblem(process.env);
    if (problem) throw new CliError(problem);
  }
  return name;
}

async function enqueue(producer: JobProducer, config: JobsConfig): Promise<unknown> {
  const name = jobArgument();
  const today = argentineToday(new Date());
  const payload = parseJobPayload(name, rawPayload(name, today, config, false)) as JobPayloads[typeof name];
  const jobId = jobIdFor(name, payload, { today, key: option('key') });
  return producer.enqueue(name, payload, jobId);
}

/** Una programación por job y fuente: el id por defecto la identifica y el upsert no la duplica. */
function defaultScheduleId(name: JobName, payload: Record<string, unknown>): string {
  const slug = (value: unknown) => String(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (name === 'IMPORT_PRICES') return `import-prices-${slug(payload.provider === 'mock' ? 'mock-provider' : payload.source)}`;
  if (name === 'IMPORT_PROMOTIONS') return 'import-promotions-mock-provider';
  return payload.userId ? `weekly-plans-${slug(payload.userId)}` : 'weekly-plans';
}

async function schedule(producer: JobProducer, config: JobsConfig): Promise<unknown> {
  const name = jobArgument();
  const cron = option('cron');
  if (!cron) throw new CliError('schedule necesita --cron="m h dm M dw" (hora argentina), por ejemplo --cron="0 20 * * 0".');
  const payload = parseJobPayload(name, rawPayload(name, argentineToday(new Date()), config, true)) as JobPayloads[typeof name];
  return producer.schedule(option('id') ?? defaultScheduleId(name, payload as unknown as Record<string, unknown>), name, payload, cron);
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new CliError('falta DATABASE_URL (ver .env.example).');
  return value;
}

async function withDatabase<T>(run: (prisma: PrismaService) => Promise<T>): Promise<T> {
  const prisma = new PrismaService(databaseUrl());
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function report(producer: JobProducer, config: JobsConfig): Promise<unknown> {
  const [queues, schedules, failed] = await Promise.all([producer.health(), producer.schedules(), producer.failed(10)]);
  const operations = await withDatabase((prisma) =>
    new OperationsReport(prisma, { staleRunMinutes: config.staleRunMinutes, priceMaxAgeDays: config.priceMaxAgeDays }).snapshot(),
  );
  return { generatedAt: new Date().toISOString(), queues, schedules, failed, ...operations };
}

async function closeStaleRuns(config: JobsConfig): Promise<unknown> {
  const now = new Date();
  const closed = await withDatabase((prisma) =>
    new PrismaImportRunRecorder(prisma).closeStale(new Date(now.getTime() - config.staleRunMinutes * 60_000), now),
  );
  return { closed, olderThanMinutes: config.staleRunMinutes, next: closed.length ? 'Reanudalas con npm.cmd run import -- … --resume=<id> o volvé a encolarlas.' : null };
}

async function main(): Promise<void> {
  const config = validateJobsEnvironment(process.env);
  const producer = new JobProducer(config);
  try {
    let output: unknown;
    switch (positional[0]) {
      case 'enqueue':
        output = await enqueue(producer, config);
        break;
      case 'schedule':
        output = await schedule(producer, config);
        break;
      case 'schedules':
        output = await producer.schedules();
        break;
      case 'unschedule':
        if (!positional[1]) throw new CliError('unschedule necesita el id de la programación.');
        output = { id: positional[1], removed: await producer.unschedule(positional[1]) };
        if (!(output as { removed: boolean }).removed) throw new CliError('no existe esa programación.');
        break;
      case 'status':
        if (!positional[1]) throw new CliError('status necesita el id del job.');
        output = await producer.status(positional[1]);
        if (output === null) throw new CliError('no existe ese job (o ya se borró por antigüedad).');
        break;
      case 'counts':
        output = await producer.counts();
        break;
      case 'failed': {
        const limit = Number(option('limit') ?? 20);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new CliError('--limit debe ser un entero entre 1 y 200.');
        output = await producer.failed(limit);
        break;
      }
      case 'retry':
        if (!positional[1]) throw new CliError('retry necesita el id del job.');
        output = await producer.retry(positional[1], { force: flag('force') });
        break;
      case 'report':
        output = await report(producer, config);
        break;
      case 'close-stale-runs':
        output = await closeStaleRuns(config);
        break;
      default:
        throw new CliError('usá enqueue, schedule, schedules, unschedule, status, counts, failed, retry, report o close-stale-runs (ver src/modules/jobs/cli.ts).');
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await producer.close();
  }
}

main().catch((error: unknown) => {
  const known = [CliError, JobPayloadError, JobConflictError, JobRetryError, PermanentJobError, ImportProviderError].some((type) => error instanceof type);
  const message = known || (error instanceof Error && error.message.startsWith('Configuración'))
    ? (error as Error).message
    // Sin detalles crudos: pueden incluir la URL de Redis o de la base.
    : `no se pudo completar: Redis o la base no respondieron${error instanceof Error ? ` (${error.name})` : ''}.`;
  process.stderr.write(`jobs — ${message}\n`);
  process.exitCode = 1;
});
