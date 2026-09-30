import { UnrecoverableError, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { sanitizeError } from '../../imports/application/import-run';
import { JobFailedError, PermanentJobError } from '../application/job-context';
import type { JobCheckpoint, JobContext } from '../application/job-context';
import { isImplementedJob, isJobName, JOB_QUEUE, JobPayloadError, parseJobPayload, WORKER_QUEUES } from '../domain/job-contracts';
import type { JobName, JobPayloads, QueueName } from '../domain/job-contracts';
import type { JobsConfig } from '../jobs.config';
import { workerConnection } from './redis-connection';

type ImplementedJob = Exclude<JobName, 'CHECK_PRICE_ALERTS'>;

/** Un handler por job implementado: recibe datos ya validados. */
export type JobHandlers = {
  readonly [K in ImplementedJob]: (payload: JobPayloads[K], context: JobContext) => Promise<unknown>;
};

export interface WorkerLogger {
  log(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
}

export interface WorkerRuntime {
  readonly workers: readonly Worker[];
  /** Deja de tomar jobs, espera los que están en curso y libera las conexiones con Redis. */
  close(): Promise<void>;
}

export interface WorkerStartOptions {
  /** Cuánto esperar a Redis al arrancar antes de rendirse. */
  readonly readyTimeoutMs?: number;
  readonly connectionName?: string;
}

export class RedisUnavailableError extends Error {
  constructor() {
    super('Redis no respondió: revisá REDIS_URL y que el servicio esté corriendo (docker compose up -d).');
    this.name = 'RedisUnavailableError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_LOG_INTERVAL_MS = 30_000;

/** El progreso viene de Redis: solo se acepta la forma esperada. */
function readCheckpoint(progress: unknown): JobCheckpoint | null {
  if (typeof progress !== 'object' || progress === null) return null;
  const runId = (progress as { importRunId?: unknown }).importRunId;
  return typeof runId === 'string' && UUID.test(runId) ? { importRunId: runId } : null;
}

async function processJob(queue: QueueName, job: Job, handlers: JobHandlers): Promise<unknown> {
  const name: unknown = job.name;
  if (!isJobName(name) || JOB_QUEUE[name] !== queue || !isImplementedJob(name)) {
    throw new UnrecoverableError('Tipo de job desconocido para esta cola.');
  }
  let payload: JobPayloads[ImplementedJob];
  try {
    payload = parseJobPayload(name as ImplementedJob, job.data);
  } catch (error: unknown) {
    if (error instanceof JobPayloadError) throw new UnrecoverableError(`Datos del job inválidos: ${error.fields.join(', ')}.`);
    throw error;
  }
  const context: JobContext = {
    jobId: job.id ?? '',
    attempt: job.attemptsMade + 1,
    checkpoint: readCheckpoint(job.progress),
    saveCheckpoint: (checkpoint) => job.updateProgress({ ...checkpoint }),
  };
  const handler = handlers[name as ImplementedJob] as (payload: unknown, context: JobContext) => Promise<unknown>;
  try {
    return await handler(payload, context);
  } catch (error: unknown) {
    // Lo que queda en Redis y en los logs es siempre un mensaje saneado.
    if (error instanceof PermanentJobError) throw new UnrecoverableError(error.message);
    if (error instanceof JobFailedError) throw error;
    throw new JobFailedError(sanitizeError(error));
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RedisUnavailableError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Un worker de BullMQ por cola (P8-01, ADR 0020), fuera del proceso HTTP. Entrega al menos
 * una vez: si el proceso cae, el bloqueo del job vence y otro worker lo retoma; los
 * handlers son idempotentes. Concurrencia acotada por cola.
 */
export async function startJobWorkers(
  config: JobsConfig,
  handlers: JobHandlers,
  logger: WorkerLogger,
  options: WorkerStartOptions = {},
): Promise<WorkerRuntime> {
  const connectionName = options.connectionName ?? 'tusofertas-worker';
  let lastErrorLog = 0;
  const workers = WORKER_QUEUES.map((queue) => {
    const worker = new Worker(queue, (job: Job) => processJob(queue, job, handlers), {
      connection: workerConnection(config.redisUrl, `${connectionName}-${queue}`),
      prefix: config.prefix,
      concurrency: config.concurrency[queue as 'imports' | 'plans'],
      lockDuration: config.lockDurationMs,
      stalledInterval: config.stalledIntervalMs,
      maxStalledCount: 1,
    });
    worker.on('error', (error: Error) => {
      // Redis caído: ioredis reintenta solo; se avisa sin inundar el log ni volcar la URL.
      if (Date.now() - lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
      lastErrorLog = Date.now();
      logger.error({ event: 'worker_redis_error', queue, error: error.name });
    });
    worker.on('active', (job: Job) => {
      logger.log({ event: 'job_started', queue, jobId: job.id, name: job.name, attempt: job.attemptsMade + 1 });
    });
    worker.on('completed', (job: Job) => {
      // `attemptsMade` ya cuenta el intento que terminó (también en `failed`).
      logger.log({ event: 'job_completed', queue, jobId: job.id, name: job.name, attempts: job.attemptsMade });
    });
    worker.on('failed', (job: Job | undefined, error: Error) => {
      const final = !job || error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.warn({ event: final ? 'job_failed' : 'job_retrying', queue, jobId: job?.id, name: job?.name, attempts: job?.attemptsMade, reason: error.message });
    });
    return worker;
  });

  try {
    await withTimeout(Promise.all(workers.map((worker) => worker.waitUntilReady())), options.readyTimeoutMs ?? 10_000);
  } catch (error: unknown) {
    await Promise.allSettled(workers.map((worker) => worker.close(true)));
    throw error instanceof RedisUnavailableError ? error : new RedisUnavailableError();
  }

  return {
    workers,
    close: async () => {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}
