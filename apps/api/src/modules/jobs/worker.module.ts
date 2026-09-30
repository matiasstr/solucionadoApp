import { Module } from '@nestjs/common';
import type { DynamicModule, INestApplicationContext, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '../../config/config.module';
import type { ApiConfig } from '../../config/environment';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';
import { importTargetProblem } from '../imports/infrastructure/import-target';
import { ShoppingPlansService } from '../shopping-plans/application/shopping-plans.service';
import { ShoppingPlansModule } from '../shopping-plans/shopping-plans.module';
import { ImportJobRunner } from './application/import-jobs';
import { WeeklyPlansJobRunner } from './application/weekly-plans.job';
import type { JobHandlers } from './infrastructure/job-workers';
import type { JobsConfig } from './jobs.config';

/** Contexto Nest del worker: base y casos de uso, sin servidor HTTP. */
@Module({})
export class WorkerModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ConfigModule.forRoot(config), DatabaseModule.forRoot(config.databaseUrl), ShoppingPlansModule],
    };
  }
}

export interface WorkerContext {
  readonly app: INestApplicationContext;
  readonly handlers: JobHandlers;
  /** Motivo por el que las importaciones se rechazan en este entorno; null = permitidas. */
  readonly importsBlockedReason: string | null;
}

/**
 * Arma los handlers con los mismos servicios que usa el API (P8-01). `app.close()` libera
 * Prisma; las conexiones con Redis las cierra el runtime de los workers.
 */
export async function createWorkerContext(
  config: ApiConfig,
  jobs: JobsConfig,
  env: Readonly<Record<string, string | undefined>>,
  logger: LoggerService,
): Promise<WorkerContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), { logger, abortOnError: false });
  const prisma = app.get(PrismaService);
  const importsBlockedReason = importTargetProblem(env);
  const imports = new ImportJobRunner({
    prisma,
    importFilesDir: jobs.importFilesDir,
    allowedHosts: jobs.allowedHosts,
    blockedReason: importsBlockedReason,
  });
  const plans = new WeeklyPlansJobRunner(prisma, app.get(ShoppingPlansService));
  return {
    app,
    importsBlockedReason,
    handlers: {
      IMPORT_PRICES: (payload, context) => imports.importPrices(payload, context),
      IMPORT_PROMOTIONS: (payload, context) => imports.importPromotions(payload, context),
      GENERATE_WEEKLY_PLANS: (payload) => plans.run(payload),
    },
  };
}
