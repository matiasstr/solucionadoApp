/**
 * Contabilidad de una ejecución de importación (P7-01): lo leído, lo creado, lo
 * repetido, lo rechazado con su motivo y un error saneado si algo falló.
 */
import { uuidV5 } from '../../../common/uuid-v5';
import { BatchRunError } from '../domain/batching';
import type { ImportRunStatus, ImportRunSummary, Rejection, RejectionReason } from '../domain/import.types';

/** Namespace de los ids que crea un importador: fuente + id externo dan siempre el mismo id. */
const IMPORT_NAMESPACE = '8d0f3c2a-5b7e-4c91-a6d4-1e2f9b7c3a58';
const MAX_SAMPLES = 20;
const MAX_BATCH_ID = 120;

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
  if (cause instanceof ImportProviderError || cause instanceof RangeError) return cause.message;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : null;
  if (code && /^P\d{4}$/.test(code)) return `Error de base de datos (${code}).`;
  return `Error inesperado${cause instanceof Error ? ` (${cause.name})` : ''}.`;
}

export class ImportRun {
  readonly startedAt: Date;
  readonly runId: string;
  read = 0;
  created = 0;
  duplicates = 0;
  conflicts = 0;
  updated = 0;
  storesCreated = 0;
  productsCreated = 0;
  productsPendingCanonical = 0;
  batches = 0;
  private readonly discardedEans = new Set<string>();
  private readonly byReason: Partial<Record<RejectionReason, number>> = {};
  private readonly samples: Rejection[] = [];
  private rejectedCount = 0;

  constructor(
    readonly kind: 'prices' | 'promotions',
    readonly source: string,
    now: Date,
    runId?: string,
  ) {
    this.startedAt = now;
    this.runId = (runId ?? `${source}:${kind}:${now.toISOString()}`).slice(0, MAX_BATCH_ID);
  }

  reject(rejection: Rejection): void {
    this.rejectedCount += 1;
    this.byReason[rejection.reason] = (this.byReason[rejection.reason] ?? 0) + 1;
    if (this.samples.length < MAX_SAMPLES) this.samples.push(rejection);
  }

  discardEan(productExternalId: string): void {
    this.discardedEans.add(productExternalId);
  }

  summary(error: unknown | null, finishedAt: Date): ImportRunSummary {
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
      finishedAt: finishedAt.toISOString(),
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
      error: error ? sanitizeError(error) : null,
    };
  }
}
