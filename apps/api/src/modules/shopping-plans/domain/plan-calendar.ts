/**
 * Calendario del plan (P5-01, ADR 0002 y 0013). Fechas de calendario `AAAA-MM-DD`
 * en `America/Argentina/Buenos_Aires`, sin hora: la aritmética usa números de día
 * enteros, así un intervalo de 15 días es exactamente 15 días y no "dos semanas".
 */
import { parseCalendarDate, RoutineRuleError } from '../../routines/domain/routine-rules';
import type { CalendarDate, Schedule } from '../../routines/domain/routine-rules';
import { PlanningRuleError } from './planning-errors';

export const PLAN_TIME_ZONE = 'America/Argentina/Buenos_Aires';
/** Ventana por defecto: una semana desde hoy, ambos extremos incluidos. */
export const DEFAULT_PLAN_DAYS = 7;
/**
 * Hora UTC del mediodía argentino. Argentina usa UTC−3 todo el año (sin horario
 * de verano desde 2009): las promociones de una fecha se evalúan a esa hora.
 */
const ARGENTINE_NOON_UTC_HOUR = 15;
const MS_PER_DAY = 86_400_000;

export interface PlanWindow {
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  /** Cantidad de días, ambos extremos incluidos. */
  readonly days: number;
  /** Todas las fechas de la ventana, en orden. */
  readonly dates: readonly CalendarDate[];
  readonly timeZone: typeof PLAN_TIME_ZONE;
}

/** Día número N desde 1970-01-01: la resta de dos fechas da días exactos. */
export function toDayNumber(date: CalendarDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / MS_PER_DAY;
}

export function fromDayNumber(day: number): CalendarDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Instante con el que se evalúan vigencia y día de una promoción en esa fecha. */
export function argentineNoon(date: CalendarDate): Date {
  return new Date((toDayNumber(date) * 24 + ARGENTINE_NOON_UTC_HOUR) * 3_600_000);
}

function parsePlanDate(value: string, field: 'startDate' | 'endDate'): CalendarDate {
  try {
    return parseCalendarDate(value, field);
  } catch (error: unknown) {
    if (error instanceof RoutineRuleError) {
      throw new PlanningRuleError('PLAN_WINDOW_INVALID', 'La fecha debe ser un día real con formato AAAA-MM-DD.', [field]);
    }
    throw error;
  }
}

/**
 * Ventana del plan con fechas inclusivas. Sin fin, dura `DEFAULT_PLAN_DAYS`.
 * Un horizonte mayor que `maxHorizonDays` se rechaza en vez de recortarse: el
 * usuario pidió un período y no se le devuelve otro sin avisar.
 */
export function resolvePlanWindow(
  input: { readonly startDate: string; readonly endDate?: string },
  maxHorizonDays: number,
): PlanWindow {
  const startDate = parsePlanDate(input.startDate, 'startDate');
  const endDate = input.endDate === undefined
    ? addDays(startDate, DEFAULT_PLAN_DAYS - 1)
    : parsePlanDate(input.endDate, 'endDate');
  const days = toDayNumber(endDate) - toDayNumber(startDate) + 1;
  if (days < 1) {
    throw new PlanningRuleError('PLAN_WINDOW_INVALID', 'La fecha de fin no puede ser anterior a la de inicio.', ['endDate']);
  }
  if (days > maxHorizonDays) {
    throw new PlanningRuleError(
      'PLAN_WINDOW_TOO_LONG',
      `El plan puede abarcar como máximo ${maxHorizonDays} días.`,
      ['startDate', 'endDate'],
    );
  }
  const first = toDayNumber(startDate);
  return {
    startDate,
    endDate,
    days,
    dates: Array.from({ length: days }, (_, offset) => fromDayNumber(first + offset)),
    timeZone: PLAN_TIME_ZONE,
  };
}

/**
 * Ocurrencias de una frecuencia dentro de la ventana: `anchorDate + k × frequencyDays`
 * con `k ≥ 0`. Antes del ancla la rutina todavía no empezó, así que no hay ocurrencias.
 */
export function occurrencesInWindow(schedule: Schedule, window: PlanWindow): CalendarDate[] {
  const anchor = toDayNumber(schedule.anchorDate);
  const start = toDayNumber(window.startDate);
  const end = toDayNumber(window.endDate);
  const step = schedule.frequencyDays;
  if (!Number.isInteger(step) || step < 1) throw new RangeError('La frecuencia debe ser un entero positivo de días.');
  const first = anchor >= start ? anchor : anchor + Math.ceil((start - anchor) / step) * step;
  const result: CalendarDate[] = [];
  for (let day = first; day <= end; day += step) result.push(fromDayNumber(day));
  return result;
}
