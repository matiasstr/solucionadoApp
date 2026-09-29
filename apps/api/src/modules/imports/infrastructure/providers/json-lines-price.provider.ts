/**
 * Proveedor JSON Lines (P7-01, P7-02): una observación por línea, opcionalmente
 * comprimido con gzip, desde un archivo local o una URL de un host **permitido** por
 * configuración (nunca una URL enviada por un usuario). Se lee por trozos con backpressure (el stream se pide a medida
 * que el importador avanza) y nunca se carga el archivo entero. Una línea ilegible
 * se informa y la importación sigue; un archivo que supera el máximo se corta.
 *
 * Importes y cantidades vienen como **texto** (`"1.234,56"`): un número JSON ya
 * perdió el formato original y podría cambiar centavos.
 */
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';
import { ImportProviderError } from '../../application/import-run';
import type { PriceProvider } from '../../application/ports';
import type { DecimalSeparator, ProviderPriceItem, RawPriceRecord } from '../../domain/import.types';

export interface JsonLinesOptions {
  /** Archivo local: se puede volver a leer igual, así que la ejecución se puede reanudar. */
  readonly path?: string;
  /** Descarga de un host de `allowedHosts`: no se asume que se repita igual. */
  readonly url?: string;
  readonly allowedHosts?: readonly string[];
  readonly timeoutMs?: number;
  readonly source: string;
  readonly decimalSeparator: DecimalSeparator;
  /** Máximo por línea; una más larga se descarta como ilegible. */
  readonly maxLineBytes?: number;
  /** Máximo del contenido (descomprimido): protege contra archivos o bombas de compresión enormes. */
  readonly maxBytes?: number;
}

const DEFAULT_MAX_LINE = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Solo hosts de la lista, por HTTPS (HTTP solo en la máquina local), sin credenciales en
 * la URL. La lista sale de la configuración del servidor (`IMPORT_ALLOWED_HOSTS`).
 */
export function assertAllowedUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportProviderError('La URL de la fuente no es válida.');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(host))) {
    throw new ImportProviderError('La fuente debe usar HTTPS (HTTP solo en la máquina local).');
  }
  if (url.username || url.password) throw new ImportProviderError('La URL de la fuente no puede llevar credenciales.');
  if (!allowedHosts.map((allowed) => allowed.trim().toLowerCase()).includes(host)) {
    throw new ImportProviderError(`El host ${host} no está entre los permitidos (IMPORT_ALLOWED_HOSTS).`);
  }
  return url;
}

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

const isText = (value: unknown): value is string => typeof value === 'string';
const optionalText = (value: unknown) => value === undefined || value === null || typeof value === 'string';

/** Líneas de un stream, sin acumular más que la línea en curso. */
export async function* readLines(stream: Readable, options: { maxLineBytes: number; maxBytes: number }): AsyncGenerator<string | null> {
  let pending = '';
  let total = 0;
  let oversized = false;
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
    total += Buffer.byteLength(text);
    if (total > options.maxBytes) {
      stream.destroy();
      throw new ImportProviderError('El archivo supera el tamaño máximo permitido para una importación.');
    }
    const parts = (pending + text).split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) {
      if (oversized) {
        // El resto de una línea demasiado larga: se descarta hasta el próximo salto.
        oversized = false;
        continue;
      }
      yield Buffer.byteLength(line) > options.maxLineBytes ? null : line.replace(/\r$/, '');
    }
    if (Buffer.byteLength(pending) > options.maxLineBytes) {
      if (!oversized) yield null;
      oversized = true;
      pending = '';
    }
  }
  if (pending && !oversized) yield Buffer.byteLength(pending) > options.maxLineBytes ? null : pending.replace(/\r$/, '');
}

function toRecord(value: unknown): RawPriceRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const store = row.store as Record<string, unknown> | undefined;
  const product = row.product as Record<string, unknown> | undefined;
  if (!store || typeof store !== 'object' || !product || typeof product !== 'object') return null;
  const storeFields = ['externalId', 'chain', 'name', 'address', 'city', 'province'];
  const productFields = ['externalId', 'name', 'quantity', 'unit'];
  if (!storeFields.every((field) => isText(store[field])) || !productFields.every((field) => isText(product[field]))) return null;
  if (!isText(row.price) || !isText(row.observedAt) || !optionalText(row.recordId)) return null;
  if (![store.latitude, store.longitude, product.ean, product.brand, product.saleMode, product.categorySlug, product.canonicalName].every(optionalText)) return null;
  if (product.packageCount !== undefined && product.packageCount !== null && typeof product.packageCount !== 'number') return null;
  return {
    kind: 'price',
    recordId: (row.recordId as string | null | undefined) ?? null,
    store: store as unknown as RawPriceRecord['store'],
    product: product as unknown as RawPriceRecord['product'],
    price: row.price,
    observedAt: row.observedAt,
  };
}

export class JsonLinesPriceProvider implements PriceProvider {
  readonly source: string;
  readonly decimalSeparator: DecimalSeparator;

  readonly replayable: boolean;

  constructor(private readonly options: JsonLinesOptions) {
    if (!/^[a-z0-9._-]{1,80}$/.test(options.source)) {
      throw new ImportProviderError('La fuente debe tener entre 1 y 80 caracteres: minúsculas, números, punto, guion o guion bajo.');
    }
    if (Boolean(options.path) === Boolean(options.url)) {
      throw new ImportProviderError('Indicá un archivo o una URL, no los dos.');
    }
    // Se valida al crear el proveedor: antes de cualquier pedido de red.
    if (options.url) assertAllowedUrl(options.url, options.allowedHosts ?? []);
    this.source = options.source;
    this.decimalSeparator = options.decimalSeparator;
    this.replayable = Boolean(options.path);
  }

  private async open(): Promise<Readable> {
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    let raw: Readable;
    let compressed: boolean;
    if (this.options.path) {
      raw = createReadStream(this.options.path);
      compressed = this.options.path.endsWith('.gz');
    } else {
      const url = assertAllowedUrl(this.options.url as string, this.options.allowedHosts ?? []);
      let response: Response;
      try {
        // Sin redirecciones: podrían llevar a un host no permitido.
        response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
      } catch {
        throw new ImportProviderError('No se pudo descargar la fuente (sin conexión, redirección o tiempo agotado).');
      }
      if (!response.ok || !response.body) throw new ImportProviderError(`La fuente respondió ${response.status}.`);
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > maxBytes) throw new ImportProviderError('El archivo supera el tamaño máximo permitido para una importación.');
      raw = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
      compressed = url.pathname.endsWith('.gz');
    }
    if (!compressed) return raw;
    const gunzip = createGunzip();
    raw.on('error', (error) => gunzip.destroy(error));
    return raw.pipe(gunzip);
  }

  async *records(): AsyncGenerator<ProviderPriceItem> {
    const input = await this.open();
    const lines = readLines(input, {
      maxLineBytes: this.options.maxLineBytes ?? DEFAULT_MAX_LINE,
      maxBytes: this.options.maxBytes ?? DEFAULT_MAX_BYTES,
    });
    try {
      for await (const line of lines) {
        if (line === null) {
          yield { kind: 'unparsable', detail: 'Línea demasiado larga.' };
          continue;
        }
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          yield { kind: 'unparsable', detail: 'La línea no es JSON válido.' };
          continue;
        }
        yield toRecord(parsed) ?? { kind: 'unparsable', detail: 'Faltan campos obligatorios o no son texto.' };
      }
    } catch (error: unknown) {
      if (error instanceof ImportProviderError) throw error;
      throw new ImportProviderError('No se pudo leer el archivo (inexistente, sin permisos o comprimido de forma inválida).');
    } finally {
      input.destroy();
    }
  }
}
