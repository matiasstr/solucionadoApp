/**
 * Cantidades de necesidad e inventario expresadas en la unidad del canónico
 * (docs/DOMAIN.md, ADR 0002). Se aceptan unidades de presentación de la misma
 * dimensión (`500 G` para un canónico en KG) y se guardan en la unidad base,
 * sin redondear: una cantidad que no entra en `numeric(14,4)` se rechaza.
 */
import { DecimalError, DecimalValue } from './decimal';
import { dimensionOf, isMeasurementUnit, toBaseQuantity } from './units';
import type { BaseUnit, MeasurementUnit } from './units';

const QUANTITY_SCALE = 4;
const MAX_INTEGER_DIGITS = 10;

export type NeedQuantityErrorCode = 'UNIT_DIMENSION_MISMATCH' | 'QUANTITY_INVALID';

export class NeedQuantityError extends Error {
  constructor(
    readonly code: NeedQuantityErrorCode,
    message: string,
    readonly fields: readonly string[],
  ) {
    super(message);
    this.name = 'NeedQuantityError';
  }
}

export interface NeedQuantityInput {
  readonly quantity: string;
  readonly unit: string;
}

export interface CanonicalQuantity {
  /** Texto decimal sin ceros sobrantes, en `unit`. */
  readonly quantity: string;
  readonly unit: BaseUnit;
}

/**
 * Convierte a la unidad del canónico. `allowZero` distingue inventario (saldo
 * no negativo) de necesidad (estrictamente positiva).
 */
export function toCanonicalQuantity(
  input: NeedQuantityInput,
  canonicalUnit: BaseUnit,
  options: { allowZero: boolean },
): CanonicalQuantity {
  if (!isMeasurementUnit(input.unit)) {
    throw new NeedQuantityError('UNIT_DIMENSION_MISMATCH', 'La unidad no es válida.', ['unit']);
  }
  const unit: MeasurementUnit = input.unit;
  if (dimensionOf(unit) !== dimensionOf(canonicalUnit)) {
    throw new NeedQuantityError(
      'UNIT_DIMENSION_MISMATCH',
      `Este producto se mide en ${canonicalUnit}; ${unit} no es compatible.`,
      ['unit'],
    );
  }

  let parsed: DecimalValue;
  try {
    parsed = DecimalValue.parse(input.quantity);
  } catch (error: unknown) {
    if (error instanceof DecimalError) throw invalidQuantity('La cantidad no es un número válido.');
    throw error;
  }
  if (parsed.isNegative() || (!options.allowZero && parsed.isZero())) {
    throw invalidQuantity(options.allowZero ? 'La cantidad no puede ser negativa.' : 'La cantidad debe ser mayor que cero.');
  }

  // Misma dimensión implica misma unidad base. Exacta: G y ML multiplican por 0,001 sin redondeo.
  const base = toBaseQuantity(parsed, unit);
  if (!base.equals(base.round(QUANTITY_SCALE))) {
    throw invalidQuantity(`La cantidad admite como máximo ${QUANTITY_SCALE} decimales en ${canonicalUnit}.`);
  }
  if (base.integerDigits() > MAX_INTEGER_DIGITS) throw invalidQuantity('La cantidad es demasiado grande.');
  return { quantity: base.toTrimmedString(), unit: canonicalUnit };
}

const invalidQuantity = (message: string) => new NeedQuantityError('QUANTITY_INVALID', message, ['quantity']);
