/**
 * Worker de jobs (P8-01, ADR 0020): `npm.cmd run worker`. Proceso aparte del API HTTP, para
 * escalarlo y apagarlo por separado. Al recibir SIGINT o SIGTERM deja de tomar jobs, espera
 * los que están en curso y libera Redis y la base; una segunda señal corta en el acto.
 */
import 'reflect-metadata';
import { JsonLogger } from './common/json-logger';
import { validateEnvironment } from './config/environment';
import { WORKER_QUEUES } from './modules/jobs/domain/job-contracts';
import { RedisUnavailableError, startJobWorkers } from './modules/jobs/infrastructure/job-workers';
import type { WorkerRuntime } from './modules/jobs/infrastructure/job-workers';
import { validateJobsEnvironment } from './modules/jobs/jobs.config';
import { createWorkerContext } from './modules/jobs/worker.module';

const logger = new JsonLogger();

async function main(): Promise<void> {
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
  logger.log({
    event: 'worker_started',
    queues: WORKER_QUEUES,
    concurrency: jobs.concurrency,
    imports: context.importsBlockedReason ? `rechazadas: ${context.importsBlockedReason}` : 'habilitadas',
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) {
      logger.warn({ event: 'worker_forced_exit', signal });
      process.exit(1);
    }
    stopping = true;
    logger.log({ event: 'worker_stopping', signal });
    runtime
      .close()
      .then(() => context.app.close())
      .then(
        () => logger.log({ event: 'worker_stopped' }),
        () => {
          logger.error({ event: 'worker_stop_failed' });
          process.exitCode = 1;
        },
      );
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((error: unknown) => {
  // Configuración y Redis tienen mensajes sin secretos; el resto se resume.
  const known = error instanceof RedisUnavailableError || (error instanceof Error && error.message.startsWith('Configuración'));
  logger.error({ event: 'worker_start_failed', message: known ? (error as Error).message : 'Revisá la configuración y la base de datos.' });
  process.exitCode = 1;
});
