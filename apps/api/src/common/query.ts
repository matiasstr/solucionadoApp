/** Validación de parámetros de ruta y cursores, con errores públicos consistentes. */
import { CursorError, decodeCursor } from './pagination';
import type { KeysetCursor } from './pagination';
import { PublicHttpException } from './public-http.exception';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalid = (field: string, message: string) =>
  new PublicHttpException(400, 'VALIDATION_FAILED', message, [field]);

/** Un id mal formado es un pedido inválido, no un recurso inexistente. */
export function requireUuid(value: string, field = 'id'): string {
  if (!UUID_PATTERN.test(value)) throw invalid(field, 'El identificador no es válido.');
  return value.toLowerCase();
}

export function parseCursorOrFail(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    return decodeCursor(raw);
  } catch (error: unknown) {
    if (error instanceof CursorError) throw invalid('cursor', 'El cursor de paginación no es válido.');
    throw error;
  }
}
