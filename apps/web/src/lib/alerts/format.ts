import type { AlertCondition, AlertOutcome, BaseUnit, MeasurementUnit, PriceAlertDto } from '@tusofertas/shared';
import { formatArs } from '../format';

const PER_UNIT: Record<BaseUnit, string> = { KG: 'kilo', L: 'litro', UNIT: 'unidad' };

export const perUnitLabel = (unit: BaseUnit): string => PER_UNIT[unit];

export const CONDITION_LABEL: Record<AlertCondition, string> = {
  TARGET_PRICE: 'Cuando llegue a un precio',
  HISTORIC_LOW: 'Cuando esté en su precio más bajo del mes',
  GOOD_DEAL: 'Cuando esté en buena oferta',
};

/** Qué vigila una alerta, en una frase. */
export function describeAlert(alert: PriceAlertDto): string {
  const what = alert.product && !alert.allowSubstitutes ? alert.product.name : alert.canonicalProduct.name;
  if (alert.condition === 'TARGET_PRICE' && alert.target) {
    return `${what} a ${formatArs(alert.target.unitPrice)} por ${perUnitLabel(alert.target.unit)} o menos`;
  }
  return alert.condition === 'HISTORIC_LOW'
    ? `${what} en su precio más bajo de los últimos 30 días`
    : `${what} en buena oferta (bastante por debajo de su promedio)`;
}

/** Alcance de la alerta: qué presentaciones cuentan. */
export function describeScope(alert: PriceAlertDto): string {
  if (!alert.product) return 'Cualquier presentación';
  if (!alert.allowSubstitutes) return 'Solo esta presentación';
  return `${alert.product.name} o una alternativa equivalente`;
}

/**
 * Última revisión en palabras. `null` = todavía no se revisó: no se promete cuándo,
 * porque depende de cuándo se procesan precios nuevos.
 */
export const OUTCOME_LABEL: Record<AlertOutcome, string> = {
  NOTIFIED: 'Te avisamos',
  ALREADY_NOTIFIED: 'Ya te avisamos por este precio',
  COOLDOWN: 'Hay un precio mejor: te avisamos pronto para no llenarte de avisos',
  NO_MATCH: 'Todavía no se cumple',
  NO_FRESH_PRICES: 'Sin precios recientes en tu zona',
  INSUFFICIENT_DATA: 'Todavía no hay historial suficiente para compararlo',
  NO_ELIGIBLE_PRODUCTS: 'Ninguna presentación cumple tus condiciones',
  NO_LOCATION: 'Falta tu zona en Preferencias',
  NO_STORES_IN_SCOPE: 'No hay sucursales dentro de tu distancia',
  PAUSED: 'Pausada',
  RULE_CHANGED: 'La cambiaste: se revisa de nuevo',
  RULE_DELETED: 'Borrada',
};

const G_OR_ML: Partial<Record<MeasurementUnit, number>> = { G: 1000, ML: 1000 };

/**
 * Cuánto sería un precio por unidad base en esta presentación ("$ 750 por este envase de
 * 500 g"). Solo para mostrar: la alerta compara precios por unidad, que calcula la API.
 */
export function packageEquivalent(unitPrice: number, quantity: string, unit: MeasurementUnit): number | null {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(unitPrice)) return null;
  return (unitPrice * amount) / (G_OR_ML[unit] ?? 1);
}

/**
 * "1500", "1500,5" o "1500.50" → "1500.50". Sin separadores de miles ("1.500" es ambiguo:
 * mil quinientos o uno y medio) ni más de dos decimales. null si no es un precio válido.
 */
export function parsePriceInput(text: string): string | null {
  const value = text.trim().replace(/\s|\$/g, '');
  if (!/^\d{1,12}([.,]\d{1,2})?$/.test(value)) return null;
  const normalized = value.replace(',', '.');
  if (Number(normalized) <= 0) return null;
  return Number(normalized).toFixed(2);
}

const DAY_MS = 86_400_000;

/** Días desde que se observó el precio de un aviso: pasado un tiempo puede haber cambiado. */
export const daysSince = (isoDate: string, now = Date.now()): number => Math.max(0, Math.floor((now - new Date(isoDate).getTime()) / DAY_MS));
