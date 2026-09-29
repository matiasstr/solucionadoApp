/**
 * Importador de precios (P7-01, P7-02; ADR 0018 y 0019): proveedor → normalización →
 * lote → identidad → base. Reingresar lo mismo no duplica (`duplicate`) y un contenido
 * distinto con la misma clave no sobrescribe (`conflict`): la historia no se reescribe.
 * Cada ejecución queda registrada con su cuarentena; un lote que falla se reintenta
 * unas pocas veces y, si la fuente se puede repetir, la ejecución se puede reanudar.
 */
import { buildIdempotencyKey } from '../../prices/domain/price-identity';
import { normalizePrice, PriceNormalizationError } from '../../prices/domain/price-normalizer';
import type { PriceObservationInput } from '../../prices/infrastructure/product-price.repository';
import { runBatches } from '../domain/batching';
import type { BatchOptions } from '../domain/batching';
import { normalizePriceRecord } from '../domain/import-normalizer';
import type { ImportRunSummary, NormalizedPriceRecord, NormalizedProduct, NormalizedStore } from '../domain/import.types';
import { assertRetryOptions, withRetries } from '../domain/recovery';
import type { RetryOptions } from '../domain/recovery';
import { ImportProviderError, ImportRun, MEMORY_RECORDER, QUARANTINE_FLUSH_SIZE } from './import-run';
import type { ResumePoint } from './import-run';
import type { ImportRunRecorder, PriceImportGateway, PriceProvider } from './ports';

export const DEFAULT_BATCH_OPTIONS: BatchOptions = { batchSize: 500, concurrency: 2 };
export const DEFAULT_RETRY: Omit<RetryOptions, 'onRetry' | 'shouldRetry'> = { retries: 2, delayMs: 500 };

export interface ImportOptions extends Partial<BatchOptions> {
  /** Momento de la importación: separa la fecha de ingesta de la fecha del precio. */
  readonly now?: Date;
  /** Dónde queda registrada la ejecución; sin él no se persiste nada. */
  readonly recorder?: ImportRunRecorder;
  readonly retry?: Omit<RetryOptions, 'onRetry' | 'shouldRetry'>;
  /** Reanudar después de la posición confirmada de una ejecución anterior de la misma fuente. */
  readonly resume?: ResumePoint | null;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const value of values) if (!seen.has(key(value))) seen.set(key(value), value);
  return [...seen.values()];
}

/** Reanudar por posición solo tiene sentido si la fuente entrega otra vez la misma secuencia. */
export function assertResumable(provider: { replayable: boolean }, resume: ResumePoint | null | undefined): void {
  if (resume && !provider.replayable) {
    throw new ImportProviderError(
      'Esta fuente no puede repetir la misma secuencia: no se puede reanudar. Importala completa de nuevo (es idempotente).',
    );
  }
}

interface PreparedBatch {
  readonly index: number;
  readonly inputs: PriceObservationInput[];
}

export class PriceImporter {
  constructor(private readonly gateway: PriceImportGateway) {}

  async run(provider: PriceProvider, options: ImportOptions = {}): Promise<ImportRunSummary> {
    assertResumable(provider, options.resume);
    const retry = options.retry ?? DEFAULT_RETRY;
    assertRetryOptions(retry);
    const run = await ImportRun.begin({
      kind: 'prices',
      source: provider.source,
      now: options.now ?? new Date(),
      recorder: options.recorder ?? MEMORY_RECORDER,
      resume: options.resume ?? null,
    });
    const batchOptions = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_OPTIONS.batchSize,
      concurrency: options.concurrency ?? DEFAULT_BATCH_OPTIONS.concurrency,
    };

    let failure: unknown = null;
    try {
      const stats = await runBatches(this.normalized(provider, run), batchOptions, {
        prepare: (batch) => this.prepare(provider.source, batch, run),
        persist: async ({ index, inputs }) => {
          const result = await withRetries(() => this.gateway.persistPrices(inputs), {
            ...retry,
            onRetry: () => {
              run.retries += 1;
            },
          });
          run.created += result.created;
          run.duplicates += result.duplicates;
          run.conflicts += result.conflicts;
          run.watermark.complete(index);
          await run.checkpoint();
        },
      });
      run.batches = stats.batches;
    } catch (error: unknown) {
      failure = error;
    }
    return run.end(failure);
  }

  /** Numera, saltea lo ya confirmado, normaliza y descarta con motivo; solo lo válido llega a los lotes. */
  private async *normalized(provider: PriceProvider, run: ImportRun): AsyncGenerator<NormalizedPriceRecord> {
    const now = run.startedAt;
    let position = 0;
    for await (const item of provider.records()) {
      position += 1;
      run.lastPosition = position;
      if (run.skips(position)) continue;
      run.read += 1;
      if (item.kind === 'unparsable') {
        run.reject({ position, reason: 'UNPARSABLE', detail: item.detail, ref: null });
      } else {
        const result = normalizePriceRecord(item, position, { separator: provider.decimalSeparator, now });
        if (result.ok) {
          if (result.value.product.eanDiscarded) run.discardEan(result.value.product.externalId);
          yield result.value;
        } else {
          run.reject(result.rejection);
        }
      }
      // Una racha de rechazos no se acumula en memoria.
      if (run.pendingRejections >= QUARANTINE_FLUSH_SIZE) await run.flushQuarantine();
    }
  }

  private async prepare(source: string, batch: readonly NormalizedPriceRecord[], run: ImportRun): Promise<PreparedBatch> {
    const index = run.watermark.open((batch[batch.length - 1] as NormalizedPriceRecord).position);
    const stores = await this.gateway.resolveStores(
      source,
      uniqueBy<NormalizedStore>(batch.map((record) => record.store), (store) => store.externalId),
    );
    const products = await this.gateway.resolveProducts(
      source,
      uniqueBy<NormalizedProduct>(batch.map((record) => record.product), (product) => product.externalId),
    );
    for (const resolution of stores.values()) if (resolution.ok && resolution.created) run.storesCreated += 1;
    for (const resolution of products.values()) {
      if (!resolution.ok || !resolution.created) continue;
      run.productsCreated += 1;
      if (resolution.value.pendingCanonical) run.productsPendingCanonical += 1;
    }

    const inputs: PriceObservationInput[] = [];
    for (const record of batch) {
      const store = stores.get(record.store.externalId);
      const product = products.get(record.product.externalId);
      if (!store || !store.ok) {
        run.reject({ position: record.position, reason: store?.ok === false ? store.reason : 'STORE_INVALID', detail: store?.ok === false ? store.detail : 'Sucursal sin resolver.', ref: record.store.externalId });
        continue;
      }
      if (!product || !product.ok) {
        run.reject({ position: record.position, reason: product?.ok === false ? product.reason : 'PRODUCT_INVALID', detail: product?.ok === false ? product.detail : 'Producto sin resolver.', ref: record.product.externalId });
        continue;
      }
      try {
        const normalized = normalizePrice({
          price: record.price,
          quantity: product.value.quantity,
          unit: product.value.unit,
          saleMode: product.value.saleMode,
          canonicalUnit: product.value.canonicalUnit,
        });
        inputs.push({
          productId: product.value.id,
          storeId: store.value,
          price: normalized.price,
          unitPrice: normalized.unitPrice,
          unitPriceUnit: normalized.unitPriceUnit,
          source,
          idempotencyKey: buildIdempotencyKey({
            productKey: product.value.id,
            storeKey: store.value,
            observedAt: record.observedAt,
            externalId: record.recordId,
          }),
          importBatchId: run.runId,
          observedAt: record.observedAt,
        });
      } catch (error: unknown) {
        if (!(error instanceof PriceNormalizationError)) throw error;
        run.reject({ position: record.position, reason: 'PRICE_NORMALIZATION', detail: `${error.code}: ${error.message}`, ref: record.product.externalId });
      }
    }
    return { index, inputs };
  }
}
