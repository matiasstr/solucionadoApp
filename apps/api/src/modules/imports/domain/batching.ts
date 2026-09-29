/**
 * Lotes con backpressure (P7-01). Genérico y sin dependencias.
 *
 * - `prepare` corre **en serie**: resuelve identidades (crear una sucursal o un
 *   producto) sin carreras entre lotes.
 * - `persist` corre con hasta `concurrency` lotes en vuelo.
 * - El próximo registro se pide al proveedor solo cuando hay lugar: en memoria
 *   nunca hay más que `batchSize × (concurrency + 1)` registros.
 *
 * Un error (del proveedor o de un lote) deja de pedir registros, espera a que
 * terminen los lotes en vuelo y se propaga: lo confirmado queda confirmado y el
 * lote incompleto no se escribe a medias.
 */

export interface BatchOptions {
  readonly batchSize: number;
  readonly concurrency: number;
}

export interface BatchStages<T, P> {
  prepare(batch: readonly T[]): Promise<P>;
  persist(prepared: P): Promise<void>;
}

export interface BatchStats {
  readonly batches: number;
  /** Máximo de registros retenidos a la vez (en armado más en vuelo). */
  readonly maxHeldItems: number;
}

export class BatchRunError extends Error {
  constructor(
    readonly cause: unknown,
    readonly stats: BatchStats,
  ) {
    super('La importación se detuvo por un error.');
    this.name = 'BatchRunError';
  }
}

export function assertBatchOptions(options: BatchOptions): void {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10_000) {
    throw new RangeError('El tamaño de lote debe ser un entero entre 1 y 10000.');
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16) {
    throw new RangeError('La concurrencia debe ser un entero entre 1 y 16.');
  }
}

export async function runBatches<T, P>(
  source: AsyncIterable<T>,
  options: BatchOptions,
  stages: BatchStages<T, P>,
): Promise<BatchStats> {
  assertBatchOptions(options);
  const inFlight = new Map<Promise<void>, number>();
  let buffer: T[] = [];
  let batches = 0;
  let maxHeldItems = 0;
  let failure: { error: unknown } | null = null;

  const held = () => buffer.length + [...inFlight.values()].reduce((total, size) => total + size, 0);
  const launch = async (batch: T[]) => {
    batches += 1;
    const prepared = await stages.prepare(batch);
    const task: Promise<void> = stages
      .persist(prepared)
      .catch((error: unknown) => {
        failure ??= { error };
      })
      .finally(() => inFlight.delete(task));
    inFlight.set(task, batch.length);
    while (inFlight.size >= options.concurrency) await Promise.race(inFlight.keys());
  };

  try {
    for await (const item of source) {
      buffer.push(item);
      maxHeldItems = Math.max(maxHeldItems, held());
      if (buffer.length >= options.batchSize) {
        const batch = buffer;
        buffer = [];
        await launch(batch);
      }
      if (failure) break;
    }
    if (!failure && buffer.length) await launch(buffer);
  } catch (error: unknown) {
    failure ??= { error };
  } finally {
    await Promise.all(inFlight.keys());
  }
  const stats = { batches, maxHeldItems };
  if (failure) throw new BatchRunError((failure as { error: unknown }).error, stats);
  return stats;
}
