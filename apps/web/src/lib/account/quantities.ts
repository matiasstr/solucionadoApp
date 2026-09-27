import type { BaseUnit, MeasurementUnit } from '@tusofertas/shared';
import { ApiError } from '../api';

/**
 * Entradas de cantidad, unidad y frecuencia. La conversión a la unidad del canónico
 * y el redondeo los hace la API: acá solo se lee lo que escribió la persona.
 */

/** Unidades que admite cada dimensión, empezando por la del canónico. */
export function unitsFor(baseUnit: BaseUnit): MeasurementUnit[] {
  if (baseUnit === 'KG') return ['KG', 'G'];
  if (baseUnit === 'L') return ['L', 'ML'];
  return ['UNIT'];
}

export const UNIT_OPTION_LABEL: Record<MeasurementUnit, string> = {
  KG: 'kg',
  G: 'g',
  L: 'litros',
  ML: 'ml',
  UNIT: 'unidades',
};

/**
 * "1,5", "1.5" o "500" → "1.5" / "500". Acepta coma o punto decimal (el teclado del
 * celular puede dar cualquiera de los dos) pero no separadores de miles: "1.500,5" es
 * ambiguo y se rechaza. Devuelve null si no es un número válido.
 */
export function parseQuantityInput(text: string, { allowZero = false } = {}): string | null {
  const value = text.trim().replace(/\s/g, '');
  if (!/^\d+([.,]\d{1,4})?$/.test(value)) return null;
  const normalized = value.replace(',', '.').replace(/^0+(?=\d)/, '');
  if (!allowZero && Number(normalized) === 0) return null;
  return normalized;
}

/** "0.5" → "0,5" para volver a mostrarlo en un campo editable. */
export const toInputQuantity = (quantity: string): string => quantity.replace('.', ',');

export const FREQUENCY_PRESETS = [
  { days: 7, label: 'Cada semana' },
  { days: 14, label: 'Cada 2 semanas' },
  { days: 15, label: 'Cada 15 días' },
  { days: 30, label: 'Cada 30 días' },
] as const;

export function formatFrequency(days: number): string {
  const preset = FREQUENCY_PRESETS.find((entry) => entry.days === days);
  if (preset) return preset.label;
  return days === 1 ? 'Todos los días' : `Cada ${days} días`;
}

/** Hoy en el calendario argentino (AAAA-MM-DD), como el ancla por defecto de la API. */
export function argentineToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const calendarDate = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "2026-09-21" → "21 de septiembre". Es una fecha de calendario, sin zona horaria. */
export const formatCalendarDate = (value: string): string => calendarDate.format(new Date(`${value}T00:00:00Z`));

export type FieldErrors = Partial<Record<string, string>>;

/**
 * Traduce un error de la API a mensajes por campo. La API nombra los campos (`fields`)
 * pero da un único mensaje: se muestra junto a cada campo implicado y, si no hay
 * ninguno que se vea en el formulario, como error general.
 */
export function apiFieldErrors(error: unknown, visibleFields: readonly string[]): { fields: FieldErrors; general: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, general: 'Algo salió mal. Probá de nuevo.' };
  const fields: FieldErrors = {};
  for (const field of error.fields) if (visibleFields.includes(field)) fields[field] = error.message;
  return { fields, general: Object.keys(fields).length > 0 ? null : error.message };
}

/** Lista de marcas escrita a mano: "Pampa, Gallo" → ["Pampa", "Gallo"]. La API deduplica. */
export const parseBrandList = (text: string): string[] =>
  text.split(',').map((entry) => entry.trim()).filter(Boolean);
