import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { PrismaService } from '../../../database/prisma.service';
import { ImportProviderError } from '../../imports/application/import-run';
import type { ResumePoint } from '../../imports/application/import-run';
import type { ImportKind, PriceImportGateway, PriceProvider, PromotionImportGateway, PromotionProvider } from '../../imports/application/ports';
import { PriceImporter } from '../../imports/application/price-importer';
import { PromotionImporter } from '../../imports/application/promotion-importer';
import type { ImportRunSummary } from '../../imports/domain/import.types';
import { PrismaImportRunRecorder } from '../../imports/infrastructure/prisma-import-run.recorder';
import { PrismaImportGateway } from '../../imports/infrastructure/prisma-import.gateway';
import { JsonLinesPriceProvider } from '../../imports/infrastructure/providers/json-lines-price.provider';
import { MockPriceProvider, MockPromotionProvider } from '../../imports/infrastructure/providers/mock-price.provider';
import { resolveAnchorDate } from '../domain/job-contracts';
import type { ImportPricesPayload, ImportPromotionsPayload } from '../domain/job-contracts';
import { JobFailedError, PermanentJobError } from './job-context';
import type { JobContext } from './job-context';

const BATCH_RETRY_DELAY_MS = 500;

export interface ImportJobDependencies {
  readonly prisma: PrismaService;
  /** Único directorio desde el que se leen archivos; null = no se aceptan. */
  readonly importFilesDir: string | null;
  readonly allowedHosts: readonly string[];
  /** Motivo por el que no se importa en esta base (producción, base remota); null = permitido. */
  readonly blockedReason: string | null;
  /** Solo tests: escritura con fallas inyectadas. */
  readonly gateway?: PriceImportGateway & PromotionImportGateway;
}

/** Resultado que queda en Redis: contadores e id de la ejecución; el detalle está en `ImportRun`. */
export type ImportJobResult = Pick<
  ImportRunSummary,
  | 'runId' | 'kind' | 'source' | 'status' | 'read' | 'created' | 'duplicates' | 'conflicts' | 'rejected'
  | 'rejectedByReason' | 'retries' | 'committedPosition' | 'resumedFromId'
>;

const toResult = (summary: ImportRunSummary): ImportJobResult => ({
  runId: summary.runId,
  kind: summary.kind,
  source: summary.source,
  status: summary.status,
  read: summary.read,
  created: summary.created,
  duplicates: summary.duplicates,
  conflicts: summary.conflicts,
  rejected: summary.rejected,
  rejectedByReason: summary.rejectedByReason,
  retries: summary.retries,
  committedPosition: summary.committedPosition,
  resumedFromId: summary.resumedFromId,
});

/**
 * Jobs `IMPORT_PRICES` e `IMPORT_PROMOTIONS` (P8-01): llaman a los mismos importadores que
 * el comando manual (ADR 0018/0019), con cada ejecución registrada y anotada en el job al
 * empezar. Una ejecución que termina `FAILED` hace fallar el intento (BullMQ reintenta); el
 * reintento la **reanuda** desde su posición confirmada si la fuente se puede repetir y, si
 * no, importa todo de nuevo (es idempotente: lo ya escrito cuenta como repetido). Si el
 * intento anterior murió con la ejecución abierta, primero la cierra como interrumpida (P8-02).
 */
export class ImportJobRunner {
  private readonly recorder: PrismaImportRunRecorder;
  private readonly gateway: PriceImportGateway & PromotionImportGateway;

  constructor(private readonly deps: ImportJobDependencies) {
    this.recorder = new PrismaImportRunRecorder(deps.prisma);
    this.gateway = deps.gateway ?? new PrismaImportGateway(deps.prisma);
  }

  async importPrices(payload: ImportPricesPayload, context: JobContext): Promise<ImportJobResult> {
    this.assertAllowed();
    const provider = this.priceProvider(payload, context.scheduledFor);
    const summary = await new PriceImporter(this.gateway).run(provider, {
      recorder: this.recorder,
      batchSize: payload.batchSize,
      concurrency: payload.concurrency,
      retry: { retries: payload.maxRetries, delayMs: BATCH_RETRY_DELAY_MS },
      resume: await this.resumePoint(context, 'prices', provider),
      onRunStarted: (runId) => context.saveCheckpoint({ importRunId: runId }),
    });
    return this.settle(summary, context);
  }

  async importPromotions(payload: ImportPromotionsPayload, context: JobContext): Promise<ImportJobResult> {
    this.assertAllowed();
    const provider = new MockPromotionProvider(resolveAnchorDate(payload.anchorDate, context.scheduledFor));
    const summary = await new PromotionImporter(this.gateway).run(provider, {
      recorder: this.recorder,
      batchSize: payload.batchSize,
      retry: { retries: payload.maxRetries, delayMs: BATCH_RETRY_DELAY_MS },
      resume: await this.resumePoint(context, 'promotions', provider),
      onRunStarted: (runId) => context.saveCheckpoint({ importRunId: runId }),
    });
    return this.settle(summary, context);
  }

  private assertAllowed(): void {
    if (this.deps.blockedReason) throw new PermanentJobError(`No se importa: ${this.deps.blockedReason}`);
  }

  private async settle(summary: ImportRunSummary, context: JobContext): Promise<ImportJobResult> {
    if (summary.status !== 'FAILED') return toResult(summary);
    await context.saveCheckpoint({ importRunId: summary.runId });
    throw new JobFailedError(`La importación ${summary.runId} falló: ${summary.error ?? 'sin detalle'}`);
  }

  /**
   * Solo se reanuda una ejecución anterior de este mismo job y de la misma fuente, que falló o
   * quedó abierta. Si quedó abierta, este intento tiene el bloqueo del job: el anterior murió.
   */
  private async resumePoint(context: JobContext, kind: ImportKind, provider: PriceProvider | PromotionProvider): Promise<ResumePoint | null> {
    const runId = context.checkpoint?.importRunId;
    if (!runId) return null;
    const previous = await this.recorder.find(runId);
    if (!previous || previous.kind !== kind || previous.source !== provider.source) return null;
    if (previous.status === 'RUNNING') await this.recorder.markInterrupted(previous.id, new Date());
    else if (previous.status !== 'FAILED') return null;
    return provider.replayable ? { runId: previous.id, position: previous.committedPosition } : null;
  }

  private priceProvider(payload: ImportPricesPayload, scheduledFor: Date): PriceProvider {
    if (payload.provider === 'mock') {
      return new MockPriceProvider({
        seed: payload.seed,
        stores: payload.stores,
        products: payload.products,
        days: payload.days,
        anchorDate: resolveAnchorDate(payload.anchorDate, scheduledFor),
        corruptEvery: payload.corruptEvery,
        withoutEanEvery: payload.withoutEanEvery,
      });
    }
    try {
      return new JsonLinesPriceProvider({
        path: payload.file === null ? undefined : this.resolveFile(payload.file),
        url: payload.url ?? undefined,
        allowedHosts: this.deps.allowedHosts,
        source: payload.source,
        decimalSeparator: payload.decimalSeparator,
      });
    } catch (error: unknown) {
      // Host no permitido o URL inválida: reintentar no cambia nada.
      if (error instanceof ImportProviderError) throw new PermanentJobError(error.message);
      throw error;
    }
  }

  /** La ruta llega de la cola: se vuelve a comprobar que no salga del directorio permitido. */
  private resolveFile(file: string): string {
    const root = this.deps.importFilesDir;
    if (!root) throw new PermanentJobError('IMPORT_FILES_DIR no está configurado: el worker no lee archivos.');
    const path = resolve(root, file);
    const inside = relative(root, path);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new PermanentJobError('El archivo está fuera de IMPORT_FILES_DIR.');
    if (!existsSync(path)) throw new PermanentJobError('El archivo no existe en IMPORT_FILES_DIR.');
    return path;
  }
}
