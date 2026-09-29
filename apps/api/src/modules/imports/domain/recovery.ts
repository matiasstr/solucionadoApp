/**
 * Recuperación de importaciones (P7-02, ADR 0019). Sin dependencias.
 *
 * - `withRetries`: reintenta una escritura idempotente unas pocas veces con espera
 *   creciente. Reintentar es seguro porque un lote no se aplica dos veces.
 * - `CommitWatermark`: con lotes en paralelo pueden terminar en desorden; la marca es
 *   la última posición del flujo hasta la que **todo** quedó confirmado (sin huecos).
 *   Desde ahí se reanuda si la fuente puede repetir la misma secuencia.
 */

export interface RetryOptions {
  /** Reintentos además del primer intento. */
  readonly retries: number;
  /** Espera antes del reintento `n` = `delayMs × n`. */
  readonly delayMs: number;
  /** Errores que no mejoran reintentando (una regla inválida) cortan enseguida. */
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

export function assertRetryOptions(options: RetryOptions): void {
  if (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 5) {
    throw new RangeError('Los reintentos deben ser un entero entre 0 y 5.');
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0 || options.delayMs > 60_000) {
    throw new RangeError('La espera entre reintentos debe estar entre 0 y 60000 ms.');
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetries<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  assertRetryOptions(options);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (attempt >= options.retries || (options.shouldRetry && !options.shouldRetry(error))) throw error;
      options.onRetry?.(attempt + 1, error);
      await wait(options.delayMs * (attempt + 1));
    }
  }
}

export class CommitWatermark {
  private readonly ends: number[] = [];
  private readonly done = new Set<number>();
  private next = 0;
  private position: number;

  /** `start`: posición ya confirmada antes (reanudación) o 0. */
  constructor(start = 0) {
    this.position = start;
  }

  /** Registra un lote en orden de armado; `end` es la última posición del flujo que cubre. */
  open(end: number): number {
    this.ends.push(end);
    return this.ends.length - 1;
  }

  /** Marca un lote confirmado y avanza mientras no haya huecos. */
  complete(index: number): number {
    this.done.add(index);
    while (this.done.has(this.next)) {
      this.position = Math.max(this.position, this.ends[this.next] as number);
      this.done.delete(this.next);
      this.next += 1;
    }
    return this.position;
  }

  /** Al terminar sin errores, todo lo leído quedó resuelto (escrito o en cuarentena). */
  finish(lastPosition: number): number {
    this.position = Math.max(this.position, lastPosition);
    return this.position;
  }

  get committed(): number {
    return this.position;
  }
}
