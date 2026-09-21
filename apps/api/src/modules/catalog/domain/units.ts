/**
 * Conversión dimensional del catálogo (ADR 0002). Tipos propios del dominio:
 * los enums de Prisma tienen los mismos valores, pero el dominio no importa
 * el cliente generado. `1000 G = 1 KG`, `1000 ML = 1 L`; no existe conversión
 * entre masa, volumen y unidades.
 */
import { DecimalValue } from './decimal';

export type MeasurementUnit = 'KG' | 'G' | 'L' | 'ML' | 'UNIT';
export type BaseUnit = 'KG' | 'L' | 'UNIT';
export type SaleMode = 'PACKAGED' | 'VARIABLE_WEIGHT';
export type Dimension = 'MASS' | 'VOLUME' | 'COUNT';

export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = ['KG', 'G', 'L', 'ML', 'UNIT'];
export const BASE_UNITS: readonly BaseUnit[] = ['KG', 'L', 'UNIT'];

export class UnitConversionError extends Error {
  constructor(
    readonly code: 'UNIT_UNKNOWN' | 'UNIT_DIMENSION_MISMATCH' | 'UNIT_QUANTITY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'UnitConversionError';
  }
}

const DIMENSIONS: Readonly<Record<MeasurementUnit, Dimension>> = {
  KG: 'MASS',
  G: 'MASS',
  L: 'VOLUME',
  ML: 'VOLUME',
  UNIT: 'COUNT',
};

/** Cuántas unidades base entra una unidad de presentación. */
const BASE_FACTOR: Readonly<Record<MeasurementUnit, string>> = {
  KG: '1',
  G: '0.001',
  L: '1',
  ML: '0.001',
  UNIT: '1',
};

const BASE_OF: Readonly<Record<MeasurementUnit, BaseUnit>> = {
  KG: 'KG',
  G: 'KG',
  L: 'L',
  ML: 'L',
  UNIT: 'UNIT',
};

export function isMeasurementUnit(value: string): value is MeasurementUnit {
  return (MEASUREMENT_UNITS as readonly string[]).includes(value);
}

export function dimensionOf(unit: MeasurementUnit | BaseUnit): Dimension {
  const dimension = DIMENSIONS[unit as MeasurementUnit];
  if (!dimension) throw new UnitConversionError('UNIT_UNKNOWN', `Unidad desconocida: ${String(unit)}.`);
  return dimension;
}

export function baseUnitOf(unit: MeasurementUnit): BaseUnit {
  const base = BASE_OF[unit];
  if (!base) throw new UnitConversionError('UNIT_UNKNOWN', `Unidad desconocida: ${String(unit)}.`);
  return base;
}

export function areCompatible(a: MeasurementUnit | BaseUnit, b: MeasurementUnit | BaseUnit): boolean {
  return dimensionOf(a) === dimensionOf(b);
}

/** Contenido expresado en la unidad base de su dimensión (KG, L o UNIT). */
export function toBaseQuantity(quantity: DecimalValue, unit: MeasurementUnit): DecimalValue {
  const factor = DecimalValue.parse(BASE_FACTOR[unit] ?? '');
  return quantity.multiply(factor);
}

/** Convierte dentro de la misma dimensión; nunca entre masa, volumen y unidades. */
export function convertQuantity(
  quantity: DecimalValue,
  from: MeasurementUnit,
  to: MeasurementUnit,
  scale = 6,
): DecimalValue {
  if (!areCompatible(from, to)) {
    throw new UnitConversionError(
      'UNIT_DIMENSION_MISMATCH',
      `No se puede convertir ${from} a ${to}: son dimensiones distintas.`,
    );
  }
  if (from === to) return quantity;
  const target = DecimalValue.parse(BASE_FACTOR[to] ?? '');
  return toBaseQuantity(quantity, from).divide(target, scale);
}

/**
 * Presentación por 100 g de un precio por KG (ADR 0002): es la misma dimensión,
 * no una unidad nueva. Solo aplica a masa.
 */
export function unitPricePer100g(unitPrice: DecimalValue, unitPriceUnit: BaseUnit, scale = 6): DecimalValue {
  if (unitPriceUnit !== 'KG') {
    throw new UnitConversionError('UNIT_DIMENSION_MISMATCH', 'El precio por 100 g solo aplica a precios por KG.');
  }
  return unitPrice.divide(DecimalValue.parse('10'), scale);
}
