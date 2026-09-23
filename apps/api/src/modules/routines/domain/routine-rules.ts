/**
 * Reglas de rutinas de compra (docs/DOMAIN.md "Rutinas e inventario", ADR 0002
 * y 0011). Puras: no conocen Prisma ni Nest. El cálculo de ocurrencias y de
 * necesidad neta llega con el planificador (P5-01).
 */
import { normalizeName } from '../../catalog/domain/naming';

/** Límite técnico de intervalo: un año. El mes calendario no se aproxima a 30 días. */
export const MAX_FREQUENCY_DAYS = 365;
export const MAX_BRANDS_PER_LIST = 20;
export const MAX_ROUTINES_PER_USER = 20;
export const MAX_ITEMS_PER_ROUTINE = 100;
export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export type RoutineRuleErrorCode =
  | 'FREQUENCY_INVALID'
  | 'ANCHOR_DATE_INVALID'
  | 'SCHEDULE_OVERRIDE_INCOMPLETE'
  | 'BRANDS_OVERLAP'
  | 'PREFERRED_PRODUCT_REQUIRED';

export class RoutineRuleError extends Error {
  constructor(
    readonly code: RoutineRuleErrorCode,
    message: string,
    readonly fields: readonly string[],
  ) {
    super(message);
    this.name = 'RoutineRuleError';
  }
}

/** Fecha de calendario sin hora, `AAAA-MM-DD`. */
export type CalendarDate = string;

export interface Schedule {
  readonly frequencyDays: number;
  readonly anchorDate: CalendarDate;
}

export interface EffectiveSchedule extends Schedule {
  /** `true` si el ítem usa la frecuencia y el ancla de su rutina. */
  readonly inherited: boolean;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Rechaza fechas imposibles (`2026-02-30`) en lugar de desplazarlas al mes siguiente. */
export function parseCalendarDate(value: string, field = 'anchorDate'): CalendarDate {
  const match = CALENDAR_DATE.exec(value);
  const [, year, month, day] = match ?? [];
  const date = match ? new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))) : null;
  if (!date || date.toISOString().slice(0, 10) !== value || Number(year) < 2000 || Number(year) > 2100) {
    throw new RoutineRuleError('ANCHOR_DATE_INVALID', 'La fecha debe ser un día real con formato AAAA-MM-DD.', [field]);
  }
  return value;
}

/** Día de hoy en el calendario argentino: el ancla por defecto de una rutina nueva. */
export function argentineToday(instant: Date): CalendarDate {
  // `en-CA` formatea como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function validateFrequencyDays(value: number, field = 'frequencyDays'): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_FREQUENCY_DAYS) {
    throw new RoutineRuleError(
      'FREQUENCY_INVALID',
      `La frecuencia es un intervalo de 1 a ${MAX_FREQUENCY_DAYS} días.`,
      [field],
    );
  }
  return value;
}

/**
 * Frecuencia propia de un ítem: ambos valores o ninguno (hereda de la rutina).
 * Recibir solo uno sería ambiguo: ¿cada cuánto, desde cuándo?
 */
export function resolveScheduleOverride(
  frequencyDays: number | null,
  anchorDate: string | null,
): Schedule | null {
  if ((frequencyDays === null) !== (anchorDate === null)) {
    throw new RoutineRuleError(
      'SCHEDULE_OVERRIDE_INCOMPLETE',
      'La frecuencia propia del producto necesita intervalo y fecha de inicio juntos.',
      ['frequencyDays', 'anchorDate'],
    );
  }
  if (frequencyDays === null || anchorDate === null) return null;
  return { frequencyDays: validateFrequencyDays(frequencyDays), anchorDate: parseCalendarDate(anchorDate) };
}

export function effectiveSchedule(routine: Schedule, override: Schedule | null): EffectiveSchedule {
  return override ? { ...override, inherited: false } : { ...routine, inherited: true };
}

/** Recorta, colapsa espacios y quita duplicados sin distinguir mayúsculas ni tildes. */
export function normalizeBrandList(brands: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of brands) {
    const brand = raw.trim().replace(/\s+/g, ' ');
    const key = normalizeName(brand);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(brand);
  }
  return result;
}

/** Una marca no puede ser preferida y excluida a la vez (`Arcor` y `ARCOR` son la misma). */
export function assertBrandsDisjoint(preferred: readonly string[], excluded: readonly string[]): void {
  const excludedKeys = new Set(excluded.map((brand) => normalizeName(brand)));
  if (preferred.some((brand) => excludedKeys.has(normalizeName(brand)))) {
    throw new RoutineRuleError(
      'BRANDS_OVERLAP',
      'Una marca no puede estar a la vez entre las preferidas y las excluidas.',
      ['preferredBrands', 'excludedBrands'],
    );
  }
}

/** Sin sustitutos, el plan necesita saber exactamente qué presentación comprar. */
export function assertSubstitutionRule(allowSubstitutes: boolean, preferredProductId: string | null): void {
  if (!allowSubstitutes && preferredProductId === null) {
    throw new RoutineRuleError(
      'PREFERRED_PRODUCT_REQUIRED',
      'Si no aceptás reemplazos, elegí el producto que querés.',
      ['preferredProductId'],
    );
  }
}
