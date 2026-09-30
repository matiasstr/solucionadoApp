/**
 * Jobs manuales (P8-01, ADR 0020): `npm.cmd run jobs -- …` (raíz). Encola y consulta; el
 * trabajo lo hace `npm.cmd run worker`. Ningún endpoint HTTP expone esto.
 *
 *   enqueue IMPORT_PRICES          [--provider=mock [--stores=5] [--products=20] [--days=7] [--seed=1] [--anchor=AAAA-MM-DD]
 *                                    [--corrupt-every=0] [--without-ean-every=0]]
 *                                  [--provider=jsonl --source=nombre (--file=relativa-a-IMPORT_FILES_DIR | --url=https://…) [--decimal=,|.]]
 *                                  [--batch-size=500] [--concurrency=2] [--max-retries=2] [--key=clave]
 *   enqueue IMPORT_PROMOTIONS      [--anchor=AAAA-MM-DD] [--batch-size=200] [--max-retries=2] [--key=clave]
 *   enqueue GENERATE_WEEKLY_PLANS  [--week=AAAA-MM-DD (lunes; por defecto, la próxima semana)] [--user=<uuid>]
 *   status <id del job>
 *   counts
 *
 * Imprime JSON y termina con código 1 si algo falló, incluido Redis sin responder: nunca
 * informa un encolado que no ocurrió.
 */
import { importTargetProblem } from '../imports/infrastructure/import-target';
import { assertAllowedUrl } from '../imports/infrastructure/providers/json-lines-price.provider';
import { ImportProviderError } from '../imports/application/import-run';
import { argentineToday } from '../routines/domain/routine-rules';
import { addDays } from '../shopping-plans/domain/plan-calendar';
import { PermanentJobError } from './application/job-context';
import { isJobName, jobIdFor, JobPayloadError, parseJobPayload, upcomingWeekStart } from './domain/job-contracts';
import type { JobName, JobPayloads } from './domain/job-contracts';
import { JobConflictError, JobProducer } from './infrastructure/job-producer';
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

/** Enteros como número; cualquier otra cosa pasa tal cual y la rechaza el contrato. */
function numeric(name: string, fallback: number): unknown {
  const raw = option(name);
  if (raw === undefined) return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function rawPayload(name: JobName, today: string, config: JobsConfig): Record<string, unknown> {
  const yesterday = addDays(today, -1);
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
      anchorDate: option('anchor') ?? yesterday,
      corruptEvery: numeric('corrupt-every', 0),
      withoutEanEvery: numeric('without-ean-every', 0),
      ...tuning,
    };
  }
  if (name === 'IMPORT_PROMOTIONS') {
    return { v: 1, provider: 'mock', anchorDate: option('anchor') ?? yesterday, batchSize: numeric('batch-size', 200), maxRetries: numeric('max-retries', 2) };
  }
  if (name === 'GENERATE_WEEKLY_PLANS') {
    const thisWeek = addDays(upcomingWeekStart(today), upcomingWeekStart(today) === today ? 0 : -7);
    const weekStart = option('week') ?? upcomingWeekStart(today);
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekStart) && (weekStart < thisWeek || weekStart > addDays(thisWeek, 7 * MAX_WEEKS_AHEAD))) {
      throw new CliError(`--week debe ser un lunes entre ${thisWeek} y ${addDays(thisWeek, 7 * MAX_WEEKS_AHEAD)}.`);
    }
    return { v: 1, weekStart, userId: option('user') ?? null };
  }
  return { v: 1, asOf: option('as-of') ?? today };
}

async function enqueue(producer: JobProducer, config: JobsConfig): Promise<unknown> {
  const name = positional[1];
  if (!isJobName(name)) throw new CliError('enqueue necesita IMPORT_PRICES, IMPORT_PROMOTIONS o GENERATE_WEEKLY_PLANS.');
  if (name === 'IMPORT_PRICES' || name === 'IMPORT_PROMOTIONS') {
    // Mismo resguardo que el worker: se avisa antes de dejar un job que igual se rechazaría.
    const problem = importTargetProblem(process.env);
    if (problem) throw new CliError(problem);
  }
  const today = argentineToday(new Date());
  const payload = parseJobPayload(name, rawPayload(name, today, config)) as JobPayloads[typeof name];
  const jobId = jobIdFor(name, payload, { today, key: option('key') });
  return producer.enqueue(name, payload, jobId);
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
      case 'status': {
        if (!positional[1]) throw new CliError('status necesita el id del job.');
        output = await producer.status(positional[1]);
        if (output === null) throw new CliError('no existe ese job (o ya se borró por antigüedad).');
        break;
      }
      case 'counts':
        output = await producer.counts();
        break;
      default:
        throw new CliError('usá enqueue, status o counts (ver el encabezado de src/modules/jobs/cli.ts).');
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await producer.close();
  }
}

main().catch((error: unknown) => {
  const known = [CliError, JobPayloadError, JobConflictError, PermanentJobError, ImportProviderError].some((type) => error instanceof type);
  const message = known || (error instanceof Error && error.message.startsWith('Configuración'))
    ? (error as Error).message
    // Sin detalles crudos: pueden incluir la URL de Redis.
    : `no se pudo completar: Redis no respondió o rechazó el pedido${error instanceof Error ? ` (${error.name})` : ''}.`;
  process.stderr.write(`jobs — ${message}\n`);
  process.exitCode = 1;
});
