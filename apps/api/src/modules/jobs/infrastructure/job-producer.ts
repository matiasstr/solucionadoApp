import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { PermanentJobError } from '../application/job-context';
import {
  importRunIdOf,
  isImplementedJob,
  isPermanentFailure,
  JOB_QUEUE,
  JobPayloadError,
  parseJobPayload,
  samePayload,
  WORKER_QUEUES,
} from '../domain/job-contracts';
import type { JobName, JobPayloads, QueueName } from '../domain/job-contracts';
import type { JobsConfig } from '../jobs.config';
import { producerConnection } from './redis-connection';

const DAY_SECONDS = 24 * 60 * 60;
/** Las programaciones siguen el reloj argentino (la zona no tiene horario de verano). */
export const SCHEDULE_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const SCHEDULE_ID = /^[a-z0-9-]{3,80}$/;
/** Cron de 5 campos (minuto a día de semana): sin segundos, una programación no corre más de una vez por minuto. */
const CRON = /^(\S+\s+){4}\S+$/;

export interface ScheduleView {
  readonly id: string;
  readonly name: string;
  readonly queue: QueueName;
  readonly pattern: string | null;
  readonly timeZone: string | null;
  readonly next: string | null;
  readonly data: unknown;
}

export interface FailedJobView {
  readonly id: string;
  readonly name: string;
  readonly queue: QueueName;
  readonly attemptsMade: number;
  /** Falló por datos, configuración o destino no permitido: reintentarlo tal cual no sirve. */
  readonly permanent: boolean;
  readonly importRunId: string | null;
  readonly failedReason: string | null;
  readonly finishedAt: string | null;
}

export interface QueueHealth {
  readonly counts: Record<string, number>;
  /** Antigüedad del job más viejo en espera: el retraso de la cola. */
  readonly oldestWaitingSeconds: number | null;
}

/** El reintento manual no aplica: el job no falló, no existe o falló por datos. */
export class JobRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobRetryError';
  }
}

export interface EnqueueResult {
  readonly jobId: string;
  readonly name: JobName;
  readonly queue: QueueName;
  /** `false`: ya existía un job con ese id y los mismos datos; no se agrega otro. */
  readonly created: boolean;
  readonly state: string;
}

export interface JobStatusView {
  readonly id: string;
  readonly name: string;
  readonly queue: QueueName;
  readonly state: string;
  readonly attemptsMade: number;
  readonly maxAttempts: number;
  readonly progress: unknown;
  readonly result: unknown;
  readonly failedReason: string | null;
  readonly createdAt: string;
  readonly processedAt: string | null;
  readonly finishedAt: string | null;
}

/** El mismo id con otros datos es otra ejecución: se pide otra clave en vez de ignorarla. */
export class JobConflictError extends Error {
  constructor(jobId: string) {
    super(`Ya existe el job ${jobId} con otros datos: usá otra clave (--key).`);
    this.name = 'JobConflictError';
  }
}

const iso = (millis: number | undefined): string | null => (millis ? new Date(millis).toISOString() : null);

/**
 * Encola y consulta jobs (P8-01, ADR 0020). Lo usa el comando manual; ningún endpoint lo
 * expone. Valida los datos otra vez antes de escribirlos en Redis.
 */
export class JobProducer {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly config: JobsConfig,
    private readonly connectionName = 'tusofertas-jobs-cli',
  ) {}

  async enqueue<K extends JobName>(name: K, payload: JobPayloads[K], jobId: string): Promise<EnqueueResult> {
    if (!isImplementedJob(name)) throw new PermanentJobError(`${name} es solo un contrato: se implementa en la fase 9.`);
    const data = parseJobPayload(name, payload);
    const queueName = JOB_QUEUE[name];
    const queue = this.queue(queueName);
    const existing = await queue.getJob(jobId);
    if (existing) {
      if (existing.name !== name || !samePayload(existing.data as object, data)) throw new JobConflictError(jobId);
      return { jobId, name, queue: queueName, created: false, state: await existing.getState() };
    }
    const job = await queue.add(name, data, { jobId, ...this.jobOptions() });
    return { jobId: job.id ?? jobId, name, queue: queueName, created: true, state: await job.getState() };
  }

  async status(jobId: string): Promise<JobStatusView | null> {
    for (const queueName of WORKER_QUEUES) {
      const job = await this.queue(queueName).getJob(jobId);
      if (job) return this.view(job, queueName);
    }
    return null;
  }

  async counts(): Promise<Record<string, Record<string, number>>> {
    const entries = await Promise.all(
      WORKER_QUEUES.map(async (queueName) => [
        queueName,
        await this.queue(queueName).getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'completed', 'failed', 'waiting-children'),
      ] as const),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Crea o actualiza una programación (P8-02). `upsertJobScheduler` es idempotente por id:
   * correrlo en varias réplicas o dos veces deja una sola programación y un solo job por turno.
   */
  async schedule<K extends JobName>(id: string, name: K, payload: JobPayloads[K], pattern: string): Promise<ScheduleView> {
    if (!SCHEDULE_ID.test(id)) throw new JobPayloadError('El id de la programación debe ser [a-z0-9-], de 3 a 80.', ['id']);
    if (!CRON.test(pattern.trim())) throw new JobPayloadError('El patrón debe ser un cron de 5 campos (minuto hora día mes día-de-semana).', ['cron']);
    if (!isImplementedJob(name)) throw new PermanentJobError(`${name} es solo un contrato: se implementa en la fase 9.`);
    const data = parseJobPayload(name, payload);
    const queueName = JOB_QUEUE[name];
    const queue = this.queue(queueName);
    try {
      await queue.upsertJobScheduler(id, { pattern: pattern.trim(), tz: SCHEDULE_TIME_ZONE }, { name, data, opts: this.jobOptions() });
    } catch (error: unknown) {
      // cron-parser rechaza el patrón con un mensaje propio; se informa sin volcarlo.
      if (error instanceof Error && /cron|pattern|Invalid|Constraint error|Validation error/i.test(error.message)) {
        throw new JobPayloadError('El patrón cron no es válido (valores fuera de rango o caracteres inválidos).', ['cron']);
      }
      throw error;
    }
    const scheduler = await queue.getJobScheduler(id);
    return this.scheduleView(queueName, scheduler ?? { key: id, name });
  }

  async schedules(): Promise<ScheduleView[]> {
    const views: ScheduleView[] = [];
    for (const queueName of WORKER_QUEUES) {
      for (const scheduler of await this.queue(queueName).getJobSchedulers(0, -1, true)) views.push(this.scheduleView(queueName, scheduler));
    }
    return views;
  }

  /** `true` si existía. Los jobs ya creados por la programación siguen su curso. */
  async unschedule(id: string): Promise<boolean> {
    let removed = false;
    for (const queueName of WORKER_QUEUES) removed = (await this.queue(queueName).removeJobScheduler(id)) || removed;
    return removed;
  }

  /** Fallos agotados (P8-02): quedan en el conjunto `failed` de cada cola durante 30 días. */
  async failed(limit = 20): Promise<FailedJobView[]> {
    const views: FailedJobView[] = [];
    for (const queueName of WORKER_QUEUES) {
      for (const job of await this.queue(queueName).getFailed(0, limit - 1)) {
        views.push({
          id: job.id ?? '',
          name: job.name,
          queue: queueName,
          attemptsMade: job.attemptsMade,
          permanent: isPermanentFailure(job.progress),
          importRunId: importRunIdOf(job.progress),
          failedReason: job.failedReason || null,
          finishedAt: iso(job.finishedOn),
        });
      }
    }
    return views.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '')).slice(0, limit);
  }

  /**
   * Reintento manual de un job fallido: vuelve a la cola con los intentos en cero y conserva su
   * progreso (una importación se reanuda desde lo confirmado; los planes no se duplican). Una
   * falla permanente solo con `force`, después de corregir datos o configuración.
   */
  async retry(jobId: string, options: { force?: boolean } = {}): Promise<{ jobId: string; queue: QueueName; state: string }> {
    for (const queueName of WORKER_QUEUES) {
      const job = await this.queue(queueName).getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      if (state !== 'failed') throw new JobRetryError(`El job está ${state}: solo se reintenta uno fallido.`);
      if (isPermanentFailure(job.progress) && !options.force) {
        throw new JobRetryError('Falló por datos o configuración: corregilo y reintentá con --force (o encolá uno nuevo con otra clave).');
      }
      await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
      return { jobId, queue: queueName, state: await job.getState() };
    }
    throw new JobRetryError('No existe ese job (o ya se borró por antigüedad).');
  }

  /** Estado de cada cola: cantidades y retraso del job más viejo en espera. */
  async health(now = Date.now()): Promise<Record<string, QueueHealth>> {
    const entries = await Promise.all(
      WORKER_QUEUES.map(async (queueName) => {
        const queue = this.queue(queueName);
        const [counts, [oldest]] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'completed', 'failed', 'waiting-children'),
          queue.getJobs(['waiting', 'prioritized'], 0, 0, true),
        ]);
        const oldestWaitingSeconds = oldest ? Math.max(0, Math.round((now - oldest.timestamp) / 1000)) : null;
        return [queueName, { counts, oldestWaitingSeconds }] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
  }

  private jobOptions() {
    return {
      attempts: this.config.attempts,
      backoff: { type: 'exponential', delay: this.config.backoffMs },
      // Terminados quedan un tiempo para consultarlos; después el mismo id se puede volver a usar.
      removeOnComplete: { age: 7 * DAY_SECONDS, count: 1000 },
      removeOnFail: { age: 30 * DAY_SECONDS },
    };
  }

  private scheduleView(queue: QueueName, scheduler: { key: string; id?: string | null; name: string; pattern?: string; tz?: string; next?: number; template?: { data?: unknown } }): ScheduleView {
    return {
      id: scheduler.id ?? scheduler.key,
      name: scheduler.name,
      queue,
      pattern: scheduler.pattern ?? null,
      timeZone: scheduler.tz ?? null,
      next: scheduler.next ? new Date(scheduler.next).toISOString() : null,
      data: scheduler.template?.data ?? null,
    };
  }

  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: producerConnection(this.config.redisUrl, this.connectionName), prefix: this.config.prefix });
      // Los errores de conexión llegan como promesas rechazadas; sin oyente, el evento cortaría el proceso.
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  private async view(job: Job, queue: QueueName): Promise<JobStatusView> {
    return {
      id: job.id ?? '',
      name: job.name,
      queue,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      progress: job.progress,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason || null,
      createdAt: new Date(job.timestamp).toISOString(),
      processedAt: iso(job.processedOn),
      finishedAt: iso(job.finishedOn),
    };
  }
}
