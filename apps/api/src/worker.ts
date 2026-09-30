/**
 * Worker de jobs (P8-01/P8-02, ADR 0020 y 0021): `npm.cmd run worker [-- --until-idle]`. Proceso
 * aparte del API HTTP, para escalarlo y apagarlo por separado.
 *
 * - Persistente (por defecto): toma jobs hasta recibir SIGINT o SIGTERM; entonces deja de tomar,
 *   espera los que están en curso y libera Redis y la base. Una segunda señal corta en el acto.
 * - `--until-idle`: procesa lo pendiente y termina cuando las colas quedan vacías (un Cloud Run
 *   Job o una tarea programada de duración finita). Los jobs diferidos a futuro quedan para después.
 *
 * Con `WORKER_HEALTH_PORT` expone `/health` y `/ready` para healthchecks.
 */
import 'reflect-metadata';
import { JsonLogger } from './common/json-logger';
import { validateEnvironment } from './config/environment';
import { WORKER_QUEUES } from './modules/jobs/domain/job-contracts';
import { JobProducer } from './modules/jobs/infrastructure/job-producer';
import { RedisUnavailableError, startJobWorkers } from './modules/jobs/infrastructure/job-workers';
import type { WorkerRuntime } from './modules/jobs/infrastructure/job-workers';
import { startHealthServer } from './modules/jobs/infrastructure/worker-health';
import type { HealthServer } from './modules/jobs/infrastructure/worker-health';
import { validateJobsEnvironment } from './modules/jobs/jobs.config';
import type { JobsConfig } from './modules/jobs/jobs.config';
import { createWorkerContext } from './modules/jobs/worker.module';

const logger = new JsonLogger();
const IDLE_CHECK_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dos controles seguidos sin jobs en espera ni en curso. */
async function waitUntilIdle(jobs: JobsConfig, isStopping: () => boolean): Promise<void> {
  const monitor = new JobProducer(jobs, 'tusofertas-worker-monitor');
  try {
    let idle = 0;
    while (idle < 2 && !isStopping()) {
      await sleep(IDLE_CHECK_MS);
      const health = await monitor.health();
      const pending = Object.values(health).reduce((sum, queue) => sum + (queue.counts.waiting ?? 0) + (queue.counts.active ?? 0) + (queue.counts.prioritized ?? 0), 0);
      idle = pending === 0 ? idle + 1 : 0;
    }
  } finally {
    await monitor.close();
  }
}

async function main(): Promise<void> {
  const untilIdle = process.argv.slice(2).includes('--until-idle');
  const config = validateEnvironment(process.env);
  const jobs = validateJobsEnvironment(process.env);
  const context = await createWorkerContext(config, jobs, process.env, logger);
  let runtime: WorkerRuntime;
  try {
    runtime = await startJobWorkers(jobs, context.handlers, logger);
  } catch (error: unknown) {
    await context.app.close();
    throw error;
  }

  let stopping = false;
  let health: HealthServer | null = null;
  if (jobs.health) {
    health = await startHealthServer({
      ...jobs.health,
      alive: () => !stopping,
      checks: async () => {
        const [redis, database] = await Promise.all([runtime.ready(), context.prisma.isReady()]);
        return { redis: redis ? 'up' : 'down', database: database ? 'up' : 'down' };
      },
    });
  }
  logger.log({
    event: 'worker_started',
    mode: untilIdle ? 'until-idle' : 'persistent',
    queues: WORKER_QUEUES,
    concurrency: jobs.concurrency,
    healthPort: health?.port ?? null,
    imports: context.importsBlockedReason ? `rechazadas: ${context.importsBlockedReason}` : 'habilitadas',
  });

  const stop = async (reason: string): Promise<void> => {
    if (stopping) {
      logger.warn({ event: 'worker_forced_exit', reason });
      process.exit(1);
    }
    stopping = true;
    logger.log({ event: 'worker_stopping', reason });
    try {
      await runtime.close();
      await context.app.close();
      await health?.close();
      logger.log({ event: 'worker_stopped' });
    } catch {
      logger.error({ event: 'worker_stop_failed' });
      process.exitCode = 1;
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  if (untilIdle) {
    let reason = 'idle';
    try {
      await waitUntilIdle(jobs, () => stopping);
    } catch {
      // Sin poder mirar las colas no se afirma que quedaron vacías: se apaga con error.
      logger.error({ event: 'worker_idle_check_failed' });
      process.exitCode = 1;
      reason = 'idle_check_failed';
    }
    if (!stopping) await stop(reason);
  }
}

main().catch((error: unknown) => {
  // Configuración y Redis tienen mensajes sin secretos; el resto se resume.
  const known = error instanceof RedisUnavailableError || (error instanceof Error && error.message.startsWith('Configuración'));
  logger.error({ event: 'worker_start_failed', message: known ? (error as Error).message : 'Revisá la configuración y la base de datos.' });
  process.exitCode = 1;
});
