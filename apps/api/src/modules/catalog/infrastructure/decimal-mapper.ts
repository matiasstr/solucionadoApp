/**
 * Prisma devuelve decimales como objetos Decimal; los repositorios los exponen
 * como texto con la escala de su columna para no perder precisión ni ceros.
 */
export interface DecimalLike {
  toFixed(digits: number): string;
  toString(): string;
}

export const toAmountString = (value: DecimalLike, scale: number): string => value.toFixed(scale);

/** Cantidades: sin ceros decimales sobrantes (`1.5000` se expone como `1.5`). */
export const toQuantityString = (value: DecimalLike): string => value.toString();

export const toOptionalQuantityString = (value: DecimalLike | null): string | null =>
  value === null ? null : toQuantityString(value);
