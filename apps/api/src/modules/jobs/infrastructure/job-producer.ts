import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { PermanentJobError } from '../application/job-context';
import { isImplementedJob, JOB_QUEUE, parseJobPayload, samePayload, WORKER_QUEUES } from '../domain/job-contracts';
import type { JobName, JobPayloads, QueueName } from '../domain/job-contracts';
import type { JobsConfig } from '../jobs.config';
import { producerConnection } from './redis-connection';

const DAY_SECONDS = 24 * 60 * 60;

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
    const job = await queue.add(name, data, {
      jobId,
      attempts: this.config.attempts,
      backoff: { type: 'exponential', delay: this.config.backoffMs },
      // Terminados quedan un tiempo para consultarlos; después el mismo id se puede volver a usar.
      removeOnComplete: { age: 7 * DAY_SECONDS, count: 1000 },
      removeOnFail: { age: 30 * DAY_SECONDS },
    });
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

  async close(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
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
