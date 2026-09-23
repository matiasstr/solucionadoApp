import type { BaseUnit, DecimalString, MeasurementUnit } from '@tusofertas/shared';

/**
 * Formato argentino para lo que se muestra. Los importes llegan como texto
 * decimal (ADR 0002) y solo se convierten a número para presentarlos: ninguna
 * cuenta de dinero ocurre en el navegador.
 */

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimals = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const longDate = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const formatArs = (amount: DecimalString): string => money.format(Number(amount));

const BASE_UNIT_LABEL: Record<BaseUnit, string> = { KG: 'kg', L: 'litro', UNIT: 'unidad' };
const UNIT_LABEL: Record<MeasurementUnit, string> = { KG: 'kg', G: 'g', L: 'L', ML: 'ml', UNIT: 'u.' };

/** "$ 1.314,51 por kg": lo que hace comparables dos presentaciones distintas. */
export const formatUnitPrice = (unitPrice: DecimalString, unit: BaseUnit): string =>
  `${money.format(Number(unitPrice))} por ${BASE_UNIT_LABEL[unit]}`;

/** Contenido de la presentación: "1 kg", "500 g", "6 x 2,25 L" no se infiere acá. */
export const formatQuantity = (quantity: DecimalString, unit: MeasurementUnit): string =>
  `${decimals.format(Number(quantity))} ${UNIT_LABEL[unit]}`;

export function formatDistance(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `a ${Math.round(meters)} m`;
  return `a ${decimals.format(Math.round(meters / 100) / 10)} km`;
}

/** Antigüedad en palabras; el dato exacto siempre queda en el `title`. */
export function formatObservedAt(isoDate: string, ageDays: number): string {
  if (ageDays <= 0) return 'precio de hoy';
  if (ageDays === 1) return 'precio de ayer';
  if (ageDays < 30) return `precio de hace ${ageDays} días`;
  return `precio del ${longDate.format(new Date(isoDate))}`;
}

export const formatDate = (isoDate: string): string => longDate.format(new Date(isoDate));

const PROMOTION_LABEL: Record<string, string> = {
  PERCENTAGE: 'Descuento',
  SECOND_UNIT: 'Segunda unidad',
  TWO_FOR_ONE: '2x1',
  FIXED_PRICE: 'Precio fijo',
  BANK_DISCOUNT: 'Descuento bancario',
};

export const formatPromotionType = (type: string): string => PROMOTION_LABEL[type] ?? 'Promoción';

/** "llevando 2 unidades": la condición viaja siempre con el beneficio. */
export const formatMinimumQuantity = (minimumQuantity: number): string =>
  minimumQuantity > 1 ? `llevando ${minimumQuantity} unidades` : 'en una unidad';
