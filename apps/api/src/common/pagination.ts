/**
 * Paginación por cursor (keyset) sobre un orden estable `(clave, id)`.
 *
 * No usa desplazamiento: insertar una fila no saltea ni repite resultados, y la
 * consulta sigue usando el índice del campo de orden. El cursor es opaco para el
 * cliente: codifica la última fila devuelta, no un número de página.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export interface KeysetCursor {
  readonly key: string;
  readonly id: string;
}

export interface PageResult<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export class CursorError extends Error {
  constructor() {
    super('Cursor inválido.');
    this.name = 'CursorError';
  }
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.key, cursor.id]), 'utf8').toString('base64url');
}

/** Rechaza cualquier cursor que no haya generado esta API. */
export function decodeCursor(raw: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new CursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new CursorError();
  const [key, id] = parsed;
  if (typeof key !== 'string' || typeof id !== 'string' || !id) throw new CursorError();
  if (key.length > 400) throw new CursorError();
  return { key, id };
}

/**
 * Convierte las filas leídas (`limit + 1`) en una página: descarta la extra y
 * devuelve el cursor solo cuando quedan más resultados.
 */
export function toPage<T>(rows: readonly T[], limit: number, cursorOf: (row: T) => KeysetCursor): PageResult<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null,
  };
}

/** Forma pública de una página. Se refleja en `packages/shared` para la web. */
export interface PaginatedDto<T> {
  items: T[];
  page: { limit: number; nextCursor: string | null };
}

export function toPaginatedDto<T, U>(page: PageResult<T>, limit: number, map: (item: T) => U): PaginatedDto<U> {
  return { items: page.items.map(map), page: { limit, nextCursor: page.nextCursor } };
}

/** Filtro keyset para un orden ascendente por `(field, id)`. */
export function keysetFilter(field: string, cursor: KeysetCursor | null): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [
      { [field]: { gt: cursor.key } },
      { AND: [{ [field]: cursor.key }, { id: { gt: cursor.id } }] },
    ],
  };
}
