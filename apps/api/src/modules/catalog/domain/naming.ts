/**
 * Normalización de nombres para búsqueda y agrupación. No deduplica por sí sola:
 * dos presentaciones distintas pueden compartir nombre normalizado (docs/DOMAIN.md).
 */

const MAX_LENGTH = 240;

export function normalizeName(value: string, maxLength = MAX_LENGTH): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Slug estable para categorías y claves de datos demo. */
export function slugify(value: string, maxLength = 140): string {
  return normalizeName(value, maxLength).replace(/%/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}
