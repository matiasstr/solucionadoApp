/**
 * Interpretación del texto de búsqueda (P3-01).
 *
 * Un término que es solo dígitos con largo de código de barras se busca como EAN
 * exacto; el resto se normaliza (sin tildes, sin puntuación) para comparar contra
 * nombre y marca. Un término vacío o demasiado corto no es una búsqueda: quien
 * llama decide si eso es un error o "sin filtro", pero acá nunca devuelve todo.
 */
import { normalizeName } from './naming';

export const MIN_SEARCH_LENGTH = 2;
export const MAX_SEARCH_LENGTH = 120;
const EAN_PATTERN = /^[0-9]{8,14}$/;

export type SearchTerm =
  | { readonly kind: 'EAN'; readonly ean: string }
  | { readonly kind: 'TEXT'; readonly normalized: string; readonly raw: string }
  | { readonly kind: 'EMPTY' };

export function parseSearchTerm(term: string | undefined): SearchTerm {
  const raw = (term ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  if (!raw) return { kind: 'EMPTY' };
  // Los ceros a la izquierda importan en un EAN: se compara como texto.
  if (EAN_PATTERN.test(raw)) return { kind: 'EAN', ean: raw };
  const normalized = normalizeName(raw);
  if (normalized.length < MIN_SEARCH_LENGTH) return { kind: 'EMPTY' };
  return { kind: 'TEXT', normalized, raw };
}
