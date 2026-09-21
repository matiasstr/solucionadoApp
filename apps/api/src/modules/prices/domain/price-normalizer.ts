/**
 * Normalizador de observaciones de precio (ADR 0002 y 0008).
 *
 * Calcula `unitPrice = price / contenidoEnUnidadBase` con aritmética decimal y
 * rechaza lo que no se puede comparar: importes o cantidades no positivos,
 * escalas que la base truncaría en silencio y dimensiones incompatibles.
 * `PACKAGED`: `price` es el precio del paquete completo y `quantity` su contenido total.
 * `VARIABLE_WEIGHT`: `quantity/unit` es la base de cotización (por ejemplo 1 KG).
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import { baseUnitOf, dimensionOf, toBaseQuantity } from '../../catalog/domain/units';
import type { BaseUnit, MeasurementUnit, SaleMode } from '../../catalog/domain/units';

/** Escalas de las columnas: ProductPrice.price (14,2), unitPrice (18,6), Product.quantity (14,4). */
export const PRICE_SCALE = 2;
export const UNIT_PRICE_SCALE = 6;
export const QUANTITY_SCALE = 4;
const MAX_PRICE_INTEGER_DIGITS = 12;

export type PriceNormalizationCode =
  | 'PRICE_FORMAT'
  | 'QUANTITY_FORMAT'
  | 'PRICE_NOT_POSITIVE'
  | 'PRICE_SCALE'
  | 'PRICE_OVERFLOW'
  | 'QUANTITY_NOT_POSITIVE'
  | 'QUANTITY_SCALE'
  | 'UNIT_PRICE_UNDERFLOW'
  | 'UNIT_PRICE_OVERFLOW'
  | 'SALE_MODE_UNIT'
  | 'DIMENSION_MISMATCH';

export class PriceNormalizationError extends Error {
  constructor(
    readonly code: PriceNormalizationCode,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = 'PriceNormalizationError';
  }
}

export interface PriceNormalizationInput {
  /** Importe observado en ARS, como texto decimal. */
  readonly price: string | DecimalValue;
  /** `Product.quantity`: contenido total del paquete o base de cotización. */
  readonly quantity: string | DecimalValue;
  readonly unit: MeasurementUnit;
  readonly saleMode: SaleMode;
  /** Unidad base del canónico, cuando el producto está agrupado. */
  readonly canonicalUnit?: BaseUnit | null;
}

export interface NormalizedPrice {
  /** Importe final con dos decimales (ARS). */
  readonly price: string;
  /** Precio por unidad base con seis decimales. */
  readonly unitPrice: string;
  readonly unitPriceUnit: BaseUnit;
  /** Contenido en unidad base usado como divisor; queda visible para explicar el cálculo. */
  readonly baseQuantity: string;
}

function parseAmount(value: string | DecimalValue, code: PriceNormalizationCode, field: string): DecimalValue {
  try {
    return DecimalValue.parse(value);
  } catch {
    throw new PriceNormalizationError(code, `El valor de ${field} no es un decimal válido.`, [field]);
  }
}

export function normalizePrice(input: PriceNormalizationInput): NormalizedPrice {
  const price = parseAmount(input.price, 'PRICE_FORMAT', 'price');
  if (!price.isPositive()) {
    throw new PriceNormalizationError('PRICE_NOT_POSITIVE', 'El precio debe ser mayor que cero.', ['price']);
  }
  // Redondear en silencio cambiaría dinero: numeric(14,2) lo haría sin avisar.
  if (!price.equals(price.round(PRICE_SCALE))) {
    throw new PriceNormalizationError('PRICE_SCALE', 'El precio admite como máximo dos decimales.', ['price']);
  }
  if (price.integerDigits() > MAX_PRICE_INTEGER_DIGITS) {
    throw new PriceNormalizationError('PRICE_OVERFLOW', 'El precio excede el máximo admitido.', ['price']);
  }

  const quantity = parseAmount(input.quantity, 'QUANTITY_FORMAT', 'quantity');
  if (!quantity.isPositive()) {
    throw new PriceNormalizationError('QUANTITY_NOT_POSITIVE', 'La cantidad debe ser mayor que cero.', ['quantity']);
  }
  if (!quantity.equals(quantity.round(QUANTITY_SCALE))) {
    throw new PriceNormalizationError('QUANTITY_SCALE', 'La cantidad admite como máximo cuatro decimales.', ['quantity']);
  }

  const unitPriceUnit = baseUnitOf(input.unit);
  if (input.saleMode === 'VARIABLE_WEIGHT' && dimensionOf(input.unit) === 'COUNT') {
    throw new PriceNormalizationError(
      'SALE_MODE_UNIT',
      'La venta por peso necesita una unidad de masa o volumen, no UNIT.',
      ['unit'],
    );
  }
  if (input.canonicalUnit && input.canonicalUnit !== unitPriceUnit) {
    throw new PriceNormalizationError(
      'DIMENSION_MISMATCH',
      `El producto se mide en ${unitPriceUnit} y su canónico en ${input.canonicalUnit}.`,
      ['unit'],
    );
  }

  const baseQuantity = toBaseQuantity(quantity, input.unit);
  const unitPrice = price.divide(baseQuantity, UNIT_PRICE_SCALE);
  if (!unitPrice.isPositive()) {
    throw new PriceNormalizationError(
      'UNIT_PRICE_UNDERFLOW',
      'El precio por unidad base se redondea a cero: revisar precio y contenido.',
      ['price', 'quantity'],
    );
  }
  if (unitPrice.integerDigits() > MAX_PRICE_INTEGER_DIGITS) {
    throw new PriceNormalizationError('UNIT_PRICE_OVERFLOW', 'El precio por unidad base excede el máximo admitido.', [
      'price',
      'quantity',
    ]);
  }

  return {
    price: price.toFixed(PRICE_SCALE),
    unitPrice: unitPrice.toFixed(UNIT_PRICE_SCALE),
    unitPriceUnit,
    baseQuantity: baseQuantity.toString(),
  };
}
