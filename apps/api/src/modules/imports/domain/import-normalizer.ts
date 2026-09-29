/**
 * Normalización de registros crudos (P7-01, ADR 0018). Funciones puras: sin base,
 * sin reloj propio y sin proveedor concreto. Lo que no se puede interpretar con
 * certeza se rechaza con motivo en vez de adivinarse; las reglas de dinero y
 * unidades siguen siendo las del catálogo (`normalizePrice` decide el precio final).
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import type { MeasurementUnit, SaleMode } from '../../catalog/domain/units';
import { PROMOTION_TYPES } from '../../promotions/domain/promotion.types';
import type { DiscountCapPeriod, PaymentMethod, PromotionType } from '../../promotions/domain/promotion.types';
import type {
  DecimalSeparator,
  Normalized,
  NormalizedPriceRecord,
  NormalizedProduct,
  NormalizedPromotion,
  NormalizedStore,
  RawPriceRecord,
  RawProduct,
  RawPromotionRecord,
  RawStore,
  Rejection,
  RejectionReason,
} from './import.types';

const MAX_TEXT = 240;
const MAX_EXTERNAL_ID = 200;
/** Tolerancia de reloj con la fuente: más adelante que esto es un dato mal fechado. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Argentina usa UTC−3: un día sin hora se toma a las 12:00 de Buenos Aires. */
const ARGENTINE_NOON_UTC = 'T15:00:00.000Z';

const UNIT_ALIASES: Readonly<Record<string, MeasurementUnit>> = {
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogramo: 'KG', kilogramos: 'KG',
  g: 'G', gr: 'G', grs: 'G', gramo: 'G', gramos: 'G',
  l: 'L', lt: 'L', lts: 'L', litro: 'L', litros: 'L',
  ml: 'ML', cc: 'ML', mililitro: 'ML', mililitros: 'ML',
  u: 'UNIT', un: 'UNIT', unid: 'UNIT', unidad: 'UNIT', unidades: 'UNIT', unit: 'UNIT',
};
const SALE_MODE_ALIASES: Readonly<Record<string, SaleMode>> = {
  packaged: 'PACKAGED', envasado: 'PACKAGED',
  variable_weight: 'VARIABLE_WEIGHT', pesable: 'VARIABLE_WEIGHT', granel: 'VARIABLE_WEIGHT', 'por peso': 'VARIABLE_WEIGHT',
};
const PAYMENT_METHODS: readonly PaymentMethod[] = ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'WALLET'];
const CAP_PERIODS: readonly DiscountCapPeriod[] = ['PURCHASE', 'WEEK', 'MONTH', 'CAMPAIGN'];

/**
 * Decimal positivo con el separador del proveedor. Con `,`: `1.234,56`, `1234,56` o
 * `1234` (el punto solo agrupa miles de a tres). Con `.`: `1234.56`, sin miles.
 * Devuelve texto con punto decimal, o null si es ambiguo o inválido.
 */
export function parseLocalizedDecimal(text: string, separator: DecimalSeparator): string | null {
  const value = text.trim();
  if (separator === ',') {
    if (!/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value) && !/^\d+(,\d+)?$/.test(value)) return null;
    return value.replace(/\./g, '').replace(',', '.');
  }
  return /^\d+(\.\d+)?$/.test(value) ? value : null;
}

/** GTIN-8, 12, 13 o 14 con dígito de control válido. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop() as number;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function parseUnit(text: string): MeasurementUnit | null {
  const value = text.trim();
  if (['KG', 'G', 'L', 'ML', 'UNIT'].includes(value)) return value as MeasurementUnit;
  return UNIT_ALIASES[value.toLowerCase()] ?? null;
}

export function parseSaleMode(text: string | null | undefined): SaleMode | null {
  if (text === null || text === undefined || !text.trim()) return 'PACKAGED';
  const value = text.trim();
  if (value === 'PACKAGED' || value === 'VARIABLE_WEIGHT') return value;
  return SALE_MODE_ALIASES[value.toLowerCase()] ?? null;
}

/** Día de calendario real: `2026-02-30` no se corre al 2 de marzo. */
function isRealDay(day: string): boolean {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1)).toISOString().slice(0, 10) === day;
}

/** Instante ISO con zona, o día `AAAA-MM-DD` tomado al mediodía argentino. */
export function parseObservedAt(text: string): Date | null {
  const value = text.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}${ARGENTINE_NOON_UTC}` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  if (!isRealDay(iso.slice(0, 10))) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const text = (value: string | null | undefined, max = MAX_TEXT): string | null => {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
  return trimmed && trimmed.length <= max ? trimmed : null;
};

const reject = (position: number, reason: RejectionReason, detail: string, ref: string | null = null): { ok: false; rejection: Rejection } => ({
  ok: false,
  rejection: { position, reason, detail, ref },
});

function coordinate(value: string | null | undefined, limit: number): string | null | undefined {
  if (value === null || value === undefined || !value.trim()) return null;
  if (!/^-?\d{1,3}(\.\d{1,6})?$/.test(value.trim())) return undefined;
  const parsed = DecimalValue.parse(value.trim());
  return parsed.compare(DecimalValue.parse(String(-limit))) < 0 || parsed.compare(DecimalValue.parse(String(limit))) > 0
    ? undefined
    : parsed.toTrimmedString();
}

export function normalizeStore(raw: RawStore, position: number): Normalized<NormalizedStore> {
  const externalId = text(raw.externalId, MAX_EXTERNAL_ID);
  const chain = text(raw.chain, 120);
  const name = text(raw.name, 180);
  const address = text(raw.address);
  const city = text(raw.city, 120);
  const province = text(raw.province, 120);
  if (!externalId) return reject(position, 'STORE_INVALID', 'La sucursal no tiene identificador.');
  if (!chain || !name || !address || !city || !province) {
    return reject(position, 'STORE_INVALID', 'A la sucursal le falta cadena, nombre, dirección o localidad.', externalId);
  }
  const latitude = coordinate(raw.latitude, 90);
  const longitude = coordinate(raw.longitude, 180);
  if (latitude === undefined || longitude === undefined || (latitude === null) !== (longitude === null)) {
    return reject(position, 'STORE_INVALID', 'Coordenadas inválidas o incompletas.', externalId);
  }
  return { ok: true, value: { externalId, chain, name, address, city, province, latitude, longitude } };
}

/** El normalizador de productos del contrato: identidad, EAN validado, contenido y modalidad. */
export function normalizeProduct(raw: RawProduct, position: number, separator: DecimalSeparator): Normalized<NormalizedProduct> {
  const externalId = text(raw.externalId, MAX_EXTERNAL_ID);
  const name = text(raw.name);
  if (!externalId) return reject(position, 'PRODUCT_INVALID', 'El producto no tiene identificador.');
  if (!name) return reject(position, 'PRODUCT_INVALID', 'El producto no tiene nombre.', externalId);
  const unit = parseUnit(raw.unit ?? '');
  if (!unit) return reject(position, 'UNIT_UNKNOWN', 'Unidad desconocida.', externalId);
  const saleMode = parseSaleMode(raw.saleMode);
  if (!saleMode) return reject(position, 'SALE_MODE_UNKNOWN', 'Modalidad de venta desconocida.', externalId);
  const quantity = parseLocalizedDecimal(raw.quantity ?? '', separator);
  if (!quantity || !DecimalValue.parse(quantity).isPositive()) {
    return reject(position, 'QUANTITY_INVALID', 'El contenido no es un número positivo.', externalId);
  }
  const packageCount = raw.packageCount ?? 1;
  if (!Number.isInteger(packageCount) || packageCount < 1) {
    return reject(position, 'PRODUCT_INVALID', 'La cantidad de envases debe ser un entero positivo.', externalId);
  }
  const eanText = raw.ean?.replace(/\s+/g, '') ?? '';
  const ean = eanText && isValidGtin(eanText) ? eanText : null;
  return {
    ok: true,
    value: {
      externalId,
      ean,
      eanDiscarded: Boolean(eanText) && ean === null,
      name,
      brand: text(raw.brand, 120),
      quantity,
      unit,
      saleMode,
      packageCount,
      categorySlug: text(raw.categorySlug, 140),
      canonicalName: text(raw.canonicalName, 200),
    },
  };
}

export function normalizePriceRecord(
  raw: RawPriceRecord,
  position: number,
  options: { readonly separator: DecimalSeparator; readonly now: Date },
): Normalized<NormalizedPriceRecord> {
  const store = normalizeStore(raw.store ?? ({} as RawStore), position);
  if (!store.ok) return store;
  const product = normalizeProduct(raw.product ?? ({} as RawProduct), position, options.separator);
  if (!product.ok) return product;
  const price = parseLocalizedDecimal(raw.price ?? '', options.separator);
  if (!price || !DecimalValue.parse(price).isPositive()) {
    return reject(position, 'PRICE_INVALID', 'El precio no es un número positivo.', product.value.externalId);
  }
  const observedAt = parseObservedAt(raw.observedAt ?? '');
  if (!observedAt) return reject(position, 'OBSERVED_AT_INVALID', 'La fecha observada no es válida.', product.value.externalId);
  if (observedAt.getTime() > options.now.getTime() + FUTURE_TOLERANCE_MS) {
    return reject(position, 'OBSERVED_IN_FUTURE', 'La fecha observada es posterior a la importación.', product.value.externalId);
  }
  const recordId = raw.recordId === null || raw.recordId === undefined ? null : text(raw.recordId, MAX_EXTERNAL_ID);
  if (raw.recordId && !recordId) return reject(position, 'PRICE_INVALID', 'El identificador del registro es inválido.', product.value.externalId);
  return { ok: true, value: { position, recordId, store: store.value, product: product.value, price, observedAt } };
}

const optionalDecimal = (value: string | null | undefined, separator: DecimalSeparator): string | null | undefined => {
  if (value === null || value === undefined || !value.trim()) return null;
  return parseLocalizedDecimal(value, separator) ?? undefined;
};

export function normalizePromotionRecord(
  raw: RawPromotionRecord,
  position: number,
  options: { readonly separator: DecimalSeparator },
): Normalized<NormalizedPromotion> {
  const externalId = text(raw.externalId, MAX_EXTERNAL_ID);
  const name = text(raw.name, 200);
  if (!externalId || !name) return reject(position, 'PROMOTION_INVALID', 'La promoción no tiene identificador o nombre.', externalId);
  const type = raw.type?.trim() as PromotionType;
  if (!PROMOTION_TYPES.includes(type)) return reject(position, 'PROMOTION_INVALID', 'Tipo de promoción desconocido.', externalId);
  const decimals = {
    discountPercentage: optionalDecimal(raw.discountPercentage, options.separator),
    fixedPrice: optionalDecimal(raw.fixedPrice, options.separator),
    minimumSpend: optionalDecimal(raw.minimumSpend, options.separator),
    discountCap: optionalDecimal(raw.discountCap, options.separator),
  };
  if (Object.values(decimals).some((value) => value === undefined)) {
    return reject(position, 'PROMOTION_INVALID', 'Un importe o porcentaje no es un número válido.', externalId);
  }
  const paymentMethod = raw.paymentMethod?.trim() ? (raw.paymentMethod.trim() as PaymentMethod) : null;
  if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) return reject(position, 'PROMOTION_INVALID', 'Medio de pago desconocido.', externalId);
  const capPeriod = raw.capPeriod?.trim() ? (raw.capPeriod.trim() as DiscountCapPeriod) : null;
  if (capPeriod && !CAP_PERIODS.includes(capPeriod)) return reject(position, 'PROMOTION_INVALID', 'Período de tope desconocido.', externalId);
  const validFrom = parseObservedAt(raw.validFrom ?? '');
  const validUntil = parseObservedAt(raw.validUntil ?? '');
  if (!validFrom || !validUntil) return reject(position, 'PROMOTION_INVALID', 'Vigencia inválida.', externalId);
  const weekdays = raw.eligibleWeekdays ?? [];
  if (!weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
    return reject(position, 'PROMOTION_INVALID', 'Días de la semana inválidos.', externalId);
  }
  return {
    ok: true,
    value: {
      position,
      externalId,
      name,
      type,
      storeExternalId: text(raw.storeExternalId, MAX_EXTERNAL_ID),
      chain: text(raw.chain, 120),
      productExternalId: text(raw.productExternalId, MAX_EXTERNAL_ID),
      productEan: raw.productEan?.trim() ? raw.productEan.trim() : null,
      canonicalName: text(raw.canonicalName, 200),
      discountPercentage: decimals.discountPercentage ?? null,
      fixedPrice: decimals.fixedPrice ?? null,
      requiredQuantity: raw.requiredQuantity ?? null,
      paymentMethod,
      bank: text(raw.bank, 120),
      membershipProgram: text(raw.membershipProgram, 120),
      minimumSpend: decimals.minimumSpend ?? null,
      discountCap: decimals.discountCap ?? null,
      capPeriod,
      eligibleWeekdays: [...new Set(weekdays)].sort(),
      terms: raw.terms?.trim() || null,
      validFrom,
      validUntil,
    },
  };
}
