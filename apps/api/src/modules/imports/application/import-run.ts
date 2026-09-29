/**
 * Contabilidad y registro de una ejecución de importación (P7-01, P7-02): lo leído,
 * lo creado, lo repetido, lo rechazado (a cuarentena), los reintentos, la posición
 * confirmada sin huecos y un error saneado si algo falló.
 */
import { uuidV5 } from '../../../common/uuid-v5';
import { BatchRunError } from '../domain/batching';
import { CommitWatermark } from '../domain/recovery';
import type { ImportRunStatus, ImportRunSummary, Rejection, RejectionReason } from '../domain/import.types';
import type { ImportKind, ImportRunRecorder } from './ports';

/** Namespace de los ids que crea un importador: fuente + id externo dan siempre el mismo id. */
const IMPORT_NAMESPACE = '8d0f3c2a-5b7e-4c91-a6d4-1e2f9b7c3a58';
const MAX_SAMPLES = 20;
const MAX_BATCH_ID = 120;
/** Rechazos que se juntan antes de escribirlos en la cuarentena. */
export const QUARANTINE_FLUSH_SIZE = 500;

export const importId = (kind: string, source: string, externalId: string): string =>
  uuidV5(`${kind}:${source}:${externalId}`, IMPORT_NAMESPACE);

/** Error de un proveedor con un mensaje apto para mostrar (sin credenciales ni contenido). */
export class ImportProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportProviderError';
  }
}

/** Nunca se vuelca el error crudo: puede traer la URL de la base o datos del archivo. */
export function sanitizeError(error: unknown): string {
  const cause = error instanceof BatchRunError ? error.cause : error;
  if (cause instanceof ImportProviderError || cause instanceof RangeError) return cause.message.slice(0, 300);
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : null;
  if (code && /^P\d{4}$/.test(code)) return `Error de base de datos (${code}).`;
  return `Error inesperado${cause instanceof Error ? ` (${cause.name})` : ''}.`;
}

/** Sin base: ids legibles y nada persistido. Lo usan los tests de dominio y el importador por defecto. */
export const MEMORY_RECORDER: ImportRunRecorder = {
  start: async ({ kind, source, startedAt }) => `${source}:${kind}:${startedAt.toISOString()}`.slice(0, MAX_BATCH_ID),
  quarantine: async () => undefined,
  progress: async () => undefined,
  finish: async () => undefined,
};

export interface ResumePoint {
  readonly runId: string;
  /** Posición confirmada de la ejecución anterior: lo anterior no se vuelve a procesar. */
  readonly position: number;
}

export class ImportRun {
  read = 0;
  created = 0;
  duplicates = 0;
  conflicts = 0;
  updated = 0;
  storesCreated = 0;
  productsCreated = 0;
  productsPendingCanonical = 0;
  batches = 0;
  retries = 0;
  /** Última posición vista del flujo (incluye las salteadas al reanudar). */
  lastPosition = 0;
  readonly watermark: CommitWatermark;
  private readonly discardedEans = new Set<string>();
  private readonly byReason: Partial<Record<RejectionReason, number>> = {};
  private readonly samples: Rejection[] = [];
  private pending: Rejection[] = [];
  private rejectedCount = 0;
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    readonly runId: string,
    readonly kind: ImportKind,
    readonly source: string,
    readonly startedAt: Date,
    private readonly recorder: ImportRunRecorder,
    readonly resume: ResumePoint | null,
  ) {
    this.watermark = new CommitWatermark(resume?.position ?? 0);
  }

  static async begin(input: {
    kind: ImportKind;
    source: string;
    now: Date;
    recorder: ImportRunRecorder;
    resume: ResumePoint | null;
  }): Promise<ImportRun> {
    const runId = await input.recorder.start({
      kind: input.kind,
      source: input.source,
      startedAt: input.now,
      resumedFromId: input.resume?.runId ?? null,
    });
    return new ImportRun(runId.slice(0, MAX_BATCH_ID), input.kind, input.source, input.now, input.recorder, input.resume);
  }

  /** `true` si la posición ya se había confirmado en la ejecución que se reanuda. */
  skips(position: number): boolean {
    return this.resume !== null && position <= this.resume.position;
  }

  reject(rejection: Rejection): void {
    this.rejectedCount += 1;
    this.byReason[rejection.reason] = (this.byReason[rejection.reason] ?? 0) + 1;
    if (this.samples.length < MAX_SAMPLES) this.samples.push(rejection);
    this.pending.push(rejection);
  }

  get pendingRejections(): number {
    return this.pending.length;
  }

  discardEan(productExternalId: string): void {
    this.discardedEans.add(productExternalId);
  }

  async flushQuarantine(): Promise<void> {
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    await this.recorder.quarantine(this.runId, batch);
  }

  /** Después de cada lote confirmado: cuarentena y contadores, en orden. */
  checkpoint(): Promise<void> {
    this.saving = this.saving.then(async () => {
      await this.flushQuarantine();
      await this.recorder.progress(this.runId, { summary: this.summary(null, null) });
    });
    return this.saving;
  }

  async end(error: unknown | null): Promise<ImportRunSummary> {
    if (!error) this.watermark.finish(this.lastPosition);
    await this.saving.catch(() => undefined);
    let failure = error;
    try {
      await this.flushQuarantine();
    } catch (flushError: unknown) {
      failure ??= flushError;
    }
    const summary = this.summary(failure, new Date());
    await this.recorder.finish(this.runId, summary);
    return summary;
  }

  summary(error: unknown | null, finishedAt: Date | null): ImportRunSummary {
    const status: ImportRunStatus = error
      ? 'FAILED'
      : this.rejectedCount > 0 || this.conflicts > 0
        ? 'COMPLETED_WITH_REJECTIONS'
        : 'COMPLETED';
    return {
      runId: this.runId,
      kind: this.kind,
      source: this.source,
      status,
      startedAt: this.startedAt.toISOString(),
      finishedAt: (finishedAt ?? new Date()).toISOString(),
      read: this.read,
      created: this.created,
      duplicates: this.duplicates,
      conflicts: this.conflicts,
      updated: this.updated,
      rejected: this.rejectedCount,
      rejectedByReason: { ...this.byReason },
      rejectionSamples: [...this.samples],
      storesCreated: this.storesCreated,
      productsCreated: this.productsCreated,
      productsPendingCanonical: this.productsPendingCanonical,
      eansDiscarded: this.discardedEans.size,
      batches: this.batches,
      retries: this.retries,
      committedPosition: this.watermark.committed,
      resumedFromId: this.resume?.runId ?? null,
      resumedAfterPosition: this.resume?.position ?? null,
      error: error ? sanitizeError(error) : null,
    };
  }
}
