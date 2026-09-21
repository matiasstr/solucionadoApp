/**
 * Criterio de precio actual y frescura (ADR 0008).
 *
 * El precio actual de un producto en una sucursal es la observación con
 * `observedAt` más reciente. Los empates se resuelven de forma determinista:
 * precedencia de fuente (si la hay), `ingestedAt` más reciente, nombre de fuente
 * y, por último, id. No se mezclan sucursales ni se sobrescribe historia.
 */

export const DEFAULT_PRICE_MAX_AGE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export interface PriceObservationRef {
  readonly id: string;
  readonly source: string;
  readonly observedAt: Date;
  readonly ingestedAt: Date;
}

export interface CurrentPriceOptions {
  /** Fuentes preferidas ante igual `observedAt`; las no listadas van al final. */
  readonly sourcePrecedence?: readonly string[];
}

export interface Freshness {
  readonly observedAt: Date;
  /** Días completos transcurridos desde la observación. */
  readonly ageDays: number;
  readonly maxAgeDays: number;
  /** Precio desactualizado: se muestra con su fecha, nunca como disponibilidad garantizada. */
  readonly isStale: boolean;
}

function precedenceOf(source: string, precedence: readonly string[] | undefined): number {
  if (!precedence?.length) return 0;
  const index = precedence.indexOf(source);
  return index === -1 ? precedence.length : index;
}

/** Orden determinista: la primera observación es el precio actual. */
export function compareObservations(
  a: PriceObservationRef,
  b: PriceObservationRef,
  options: CurrentPriceOptions = {},
): number {
  const byObservedAt = b.observedAt.getTime() - a.observedAt.getTime();
  if (byObservedAt !== 0) return byObservedAt;
  const bySource = precedenceOf(a.source, options.sourcePrecedence) - precedenceOf(b.source, options.sourcePrecedence);
  if (bySource !== 0) return bySource;
  const byIngestedAt = b.ingestedAt.getTime() - a.ingestedAt.getTime();
  if (byIngestedAt !== 0) return byIngestedAt;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function selectCurrentObservation<T extends PriceObservationRef>(
  observations: readonly T[],
  options: CurrentPriceOptions = {},
): T | null {
  let current: T | null = null;
  for (const observation of observations) {
    if (!current || compareObservations(observation, current, options) < 0) current = observation;
  }
  return current;
}

export function ageInDays(observedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - observedAt.getTime()) / MS_PER_DAY);
}

export function freshnessOf(
  observedAt: Date,
  now: Date,
  maxAgeDays: number = DEFAULT_PRICE_MAX_AGE_DAYS,
): Freshness {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays <= 0) {
    throw new RangeError('El umbral de antigüedad debe ser un entero positivo de días.');
  }
  const ageDays = ageInDays(observedAt, now);
  return { observedAt, ageDays, maxAgeDays, isStale: ageDays > maxAgeDays };
}
