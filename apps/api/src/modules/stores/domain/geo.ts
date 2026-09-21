/**
 * Parámetros de las consultas por cercanía. El radio se pide en kilómetros
 * (lo que entiende una persona) y PostGIS lo recibe en metros sobre `geography`.
 */

export const DEFAULT_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 100;
/** Tope de sucursales evaluadas por consulta: acota el trabajo y el tamaño de la respuesta. */
export const MAX_NEARBY_STORES = 200;
const METERS_PER_KM = 1_000;

export function radiusToMeters(radiusKm: number): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) {
    throw new RangeError('Radio fuera de rango.');
  }
  return radiusKm * METERS_PER_KM;
}
