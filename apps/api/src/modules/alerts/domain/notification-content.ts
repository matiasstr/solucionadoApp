/**
 * Contenido de un aviso de precio (P9-01): título, mensaje, enlace y snapshot. El snapshot
 * guarda motivo, producto, sucursal, precio, fuente y fecha tal como estaban: un precio nuevo
 * no cambia un aviso ya emitido.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { BaseUnit } from '../../catalog/domain/units';
import { argentineDate } from '../../prices/domain/price-analysis';
import type { AlertMatch } from './alert-evaluation';
import type { AlertCondition } from './alert-rules';

const UNIT_LABEL: Readonly<Record<BaseUnit, string>> = { KG: 'kg', L: 'l', UNIT: 'unidad' };

/** `$ 1.234,50`: pesos con separador de miles y coma decimal. */
export function formatArs(amount: string): string {
  const [integer, decimals] = DecimalValue.parse(amount).round(2).toFixed(2).split('.') as [string, string];
  const negative = integer.startsWith('-');
  const digits = negative ? integer.slice(1) : integer;
  return `${negative ? '-' : ''}$ ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

const dayMonth = (instant: Date): string => {
  const [, month, day] = argentineDate(instant).split('-');
  return `${day}/${month}`;
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export interface NotificationContext {
  readonly condition: AlertCondition;
  readonly match: AlertMatch;
  readonly canonical: { readonly id: string; readonly name: string };
  readonly product: { readonly id: string; readonly name: string; readonly brand: string | null };
  readonly preferredProduct: { readonly id: string; readonly name: string } | null;
  readonly store: { readonly id: string; readonly name: string; readonly chainName: string; readonly distanceMeters: number | null };
  readonly target: { readonly unitPrice: string; readonly unit: BaseUnit } | null;
}

export interface NotificationContent {
  readonly title: string;
  readonly message: string;
  readonly link: string;
  readonly snapshot: Record<string, unknown>;
}

export function buildNotificationContent(context: NotificationContext): NotificationContent {
  const { condition, match, canonical, product, preferredProduct, store, target } = context;
  const unit = UNIT_LABEL[match.unitPriceUnit];
  const title =
    condition === 'TARGET_PRICE'
      ? `${canonical.name} llegó a tu precio objetivo`
      : condition === 'HISTORIC_LOW'
        ? `${canonical.name}: el precio más bajo del último mes`
        : `${canonical.name}: buena oferta`;
  const parts = [
    `${product.name} a ${formatArs(match.price)} (${formatArs(match.unitPrice)} por ${unit}) en ${store.name}, precio visto el ${dayMonth(match.observedAt)} (fuente ${match.source}).`,
  ];
  if (target) parts.push(`Tu objetivo: ${formatArs(target.unitPrice)} por ${UNIT_LABEL[target.unit]}.`);
  if (condition !== 'TARGET_PRICE' && match.analysis.average) parts.push(`Promedio del último mes: ${formatArs(match.analysis.average)} por ${unit}.`);
  if (match.isAlternative && preferredProduct) parts.push(`Es una alternativa a ${preferredProduct.name}.`);
  return {
    title: clip(title, 160),
    message: clip(parts.join(' '), 400),
    link: `/producto/${product.id}`,
    snapshot: {
      reason: condition,
      canonicalProduct: canonical,
      product,
      isAlternative: match.isAlternative,
      preferredProduct,
      store,
      price: match.price,
      unitPrice: match.unitPrice,
      unitPriceUnit: match.unitPriceUnit,
      currency: match.currency,
      source: match.source,
      observedAt: match.observedAt.toISOString(),
      target: target ? { unitPrice: target.unitPrice, unit: target.unit, currency: 'ARS' } : null,
      analysis: {
        classification: match.analysis.classification,
        average: match.analysis.average,
        lowest: match.analysis.lowest,
        ratioToAverage: match.analysis.ratioToAverage,
      },
    },
  };
}
