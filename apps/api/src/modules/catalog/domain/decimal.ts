/**
 * Aritmética decimal exacta para dinero y cantidades (ADR 0002 y 0008).
 * Representa el valor como un entero BigInt escalado: no usa punto flotante ni
 * depende de Prisma, Nest ni bibliotecas externas. El redondeo es HALF_UP
 * (medio alejándose de cero), el mismo criterio que aplica PostgreSQL `numeric`.
 */

/** Dígitos máximos admitidos: cubre Decimal(18,6) y Decimal(14,2) con margen. */
const MAX_DIGITS = 40;
const MAX_SCALE = 20;
const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

export class DecimalError extends Error {
  constructor(
    readonly code: 'DECIMAL_FORMAT' | 'DECIMAL_SCALE' | 'DECIMAL_DIVIDE_BY_ZERO',
    message: string,
  ) {
    super(message);
    this.name = 'DecimalError';
  }
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Cambia la escala redondeando HALF_UP cuando pierde dígitos. */
function rescale(units: bigint, from: number, to: number): bigint {
  if (to === from) return units;
  if (to > from) return units * pow10(to - from);
  const factor = pow10(from - to);
  const quotient = units / factor;
  const remainder = absolute(units % factor);
  if (remainder * 2n >= factor) return quotient + (units < 0n ? -1n : 1n);
  return quotient;
}

export class DecimalValue {
  private constructor(
    /** Valor entero: el número real es `units / 10 ** scale`. */
    readonly units: bigint,
    readonly scale: number,
  ) {}

  /** Acepta solo texto o DecimalValue: `number` perdería precisión sin avisar. */
  static parse(value: string | DecimalValue): DecimalValue {
    if (value instanceof DecimalValue) return value;
    const text = value.trim();
    if (!DECIMAL_PATTERN.test(text)) {
      throw new DecimalError('DECIMAL_FORMAT', 'El valor decimal debe tener el formato -?digitos[.digitos].');
    }
    const negative = text.startsWith('-');
    const unsigned = text.replace(/^[+-]/, '');
    const [integerPart = '', fractionPart = ''] = unsigned.split('.');
    if (fractionPart.length > MAX_SCALE || integerPart.length + fractionPart.length > MAX_DIGITS) {
      throw new DecimalError('DECIMAL_SCALE', 'El valor decimal excede los dígitos admitidos.');
    }
    const units = BigInt(`${integerPart}${fractionPart}` || '0');
    return new DecimalValue(negative ? -units : units, fractionPart.length);
  }

  static fromUnits(units: bigint, scale: number): DecimalValue {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError('DECIMAL_SCALE', 'Escala decimal fuera de rango.');
    }
    return new DecimalValue(units, scale);
  }

  static zero(scale = 0): DecimalValue {
    return DecimalValue.fromUnits(0n, scale);
  }

  private static align(a: DecimalValue, b: DecimalValue): { scale: number; left: bigint; right: bigint } {
    const scale = Math.max(a.scale, b.scale);
    return { scale, left: rescale(a.units, a.scale, scale), right: rescale(b.units, b.scale, scale) };
  }

  add(other: DecimalValue): DecimalValue {
    const { scale, left, right } = DecimalValue.align(this, other);
    return new DecimalValue(left + right, scale);
  }

  subtract(other: DecimalValue): DecimalValue {
    const { scale, left, right } = DecimalValue.align(this, other);
    return new DecimalValue(left - right, scale);
  }

  /** Producto exacto: la escala resultante es la suma de las escalas. */
  multiply(other: DecimalValue): DecimalValue {
    const scale = this.scale + other.scale;
    if (scale > MAX_SCALE) {
      throw new DecimalError('DECIMAL_SCALE', 'El producto excede la escala máxima; redondear antes de multiplicar.');
    }
    return new DecimalValue(this.units * other.units, scale);
  }

  /** División con la escala pedida y redondeo HALF_UP sobre el resto exacto. */
  divide(other: DecimalValue, scale: number): DecimalValue {
    if (other.units === 0n) throw new DecimalError('DECIMAL_DIVIDE_BY_ZERO', 'No se puede dividir por cero.');
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError('DECIMAL_SCALE', 'Escala decimal fuera de rango.');
    }
    const shift = scale + other.scale - this.scale;
    let numerator = this.units;
    let denominator = other.units;
    if (shift >= 0) numerator *= pow10(shift);
    else denominator *= pow10(-shift);
    let quotient = numerator / denominator;
    const remainder = absolute(numerator % denominator);
    if (remainder * 2n >= absolute(denominator)) {
      quotient += (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
    }
    return new DecimalValue(quotient, scale);
  }

  /** Redondeo HALF_UP a la escala indicada: se aplica a importes finales. */
  round(scale: number): DecimalValue {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError('DECIMAL_SCALE', 'Escala decimal fuera de rango.');
    }
    return new DecimalValue(rescale(this.units, this.scale, scale), scale);
  }

  /** Parte entera hacia abajo: `2.9 -> 2`, `-2.1 -> -3`. */
  floorToInteger(): DecimalValue {
    const factor = pow10(this.scale);
    const quotient = this.units / factor;
    const negativeRemainder = this.units < 0n && this.units % factor !== 0n;
    return new DecimalValue(negativeRemainder ? quotient - 1n : quotient, 0);
  }

  isInteger(): boolean {
    return this.units % pow10(this.scale) === 0n;
  }

  compare(other: DecimalValue): -1 | 0 | 1 {
    const { left, right } = DecimalValue.align(this, other);
    if (left < right) return -1;
    return left > right ? 1 : 0;
  }

  equals(other: DecimalValue): boolean {
    return this.compare(other) === 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  /**
   * Dígitos de la parte entera: sirve para validar contra Decimal(p,s) antes de
   * persistir. Trunca en lugar de redondear, así `999999999999.99` sigue entrando
   * en `numeric(14,2)`.
   */
  integerDigits(): number {
    const digits = absolute(this.units / pow10(this.scale)).toString();
    return digits.length;
  }

  toFixed(scale: number): string {
    const scaled = this.round(scale);
    const digits = absolute(scaled.units).toString().padStart(scale + 1, '0');
    const integerPart = digits.slice(0, digits.length - scale);
    const fractionPart = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
    return `${scaled.units < 0n ? '-' : ''}${integerPart}${fractionPart}`;
  }

  toString(): string {
    return this.toFixed(this.scale);
  }

  /** Texto sin ceros decimales sobrantes: `1.5000` -> `1.5`, `2.0000` -> `2`. */
  toTrimmedString(scale: number = this.scale): string {
    const text = this.toFixed(scale);
    return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  }
}

export const decimal = (value: string | DecimalValue): DecimalValue => DecimalValue.parse(value);
