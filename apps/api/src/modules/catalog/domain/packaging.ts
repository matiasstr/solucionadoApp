/**
 * Envases enteros y excedente (ADR 0002). Si se necesitan 3 L y el envase trae
 * 2 L, se compran dos envases y sobra 1 L: el excedente se muestra, no se oculta.
 * La venta por peso admite fracciones porque la presentación lo permite.
 */
import { DecimalValue } from './decimal';
import type { SaleMode } from './units';

/** Escala de cantidades: la misma de `Product.quantity` (Decimal(14,4)). */
const QUANTITY_SCALE = 4;

export interface PurchaseNeed {
  /** Necesidad en unidad base (KG, L o UNIT). */
  readonly neededQuantity: string;
  /** Contenido de un envase o base de cotización, en la misma unidad base. */
  readonly packageQuantity: string;
  readonly saleMode: SaleMode;
}

export interface PurchasePlan {
  /** Envases a comprar (entero para envasados) o cantidad de bases para granel. */
  readonly units: string;
  /** Lo que realmente se compra en unidad base. */
  readonly purchasedQuantity: string;
  /** Lo que sobra respecto de la necesidad; cero para venta por peso. */
  readonly surplus: string;
}

/** Entero hacia arriba: `ceil(x) = -floor(-x)`. */
function ceilToInteger(value: DecimalValue): DecimalValue {
  return DecimalValue.zero().subtract(DecimalValue.zero().subtract(value).floorToInteger());
}

export function planPurchase(need: PurchaseNeed): PurchasePlan {
  const needed = DecimalValue.parse(need.neededQuantity);
  const packageQuantity = DecimalValue.parse(need.packageQuantity);
  if (!needed.isPositive()) throw new RangeError('La necesidad debe ser mayor que cero.');
  if (!packageQuantity.isPositive()) throw new RangeError('El contenido del envase debe ser mayor que cero.');

  if (need.saleMode === 'VARIABLE_WEIGHT') {
    // Se compra exactamente lo necesario: no hay envase que redondear.
    return {
      units: needed.divide(packageQuantity, QUANTITY_SCALE).toTrimmedString(),
      purchasedQuantity: needed.toTrimmedString(),
      surplus: '0',
    };
  }

  const units = ceilToInteger(needed.divide(packageQuantity, QUANTITY_SCALE));
  const purchased = units.multiply(packageQuantity);
  return {
    units: units.toTrimmedString(),
    purchasedQuantity: purchased.toTrimmedString(),
    surplus: purchased.subtract(needed).toTrimmedString(QUANTITY_SCALE),
  };
}
