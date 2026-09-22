/**
 * Promociones simples (P2-03). Tipos propios del dominio: los enums de Prisma
 * tienen los mismos valores, pero el dominio no importa el cliente generado.
 * Importes como texto decimal; instantes en UTC, calendario en Argentina.
 */

export type PromotionType = 'PERCENTAGE' | 'SECOND_UNIT' | 'TWO_FOR_ONE' | 'FIXED_PRICE' | 'BANK_DISCOUNT';
export type DiscountCapPeriod = 'PURCHASE' | 'WEEK' | 'MONTH' | 'CAMPAIGN';
export type PaymentMethod = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'TRANSFER' | 'WALLET';

export const PROMOTION_TYPES: readonly PromotionType[] = [
  'PERCENTAGE',
  'SECOND_UNIT',
  'TWO_FOR_ONE',
  'FIXED_PRICE',
  'BANK_DISCOUNT',
];

/** Zona del calendario comercial: los días elegibles se leen acá, no en UTC. */
export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Una promoción vigente y comprobable. `validUntil` es exclusivo: la vigencia es
 * `[validFrom, validUntil)`. `eligibleWeekdays` usa ISO 1=lunes … 7=domingo y
 * vacío significa todos los días.
 */
export interface PromotionRule {
  readonly id: string;
  readonly name: string;
  readonly type: PromotionType;
  /** Alcance comercial: exactamente una sucursal **o** una cadena. */
  readonly storeId: string | null;
  readonly chainId: string | null;
  /** Alcance de producto: como máximo uno; ninguno alcanza a todo el comercio. */
  readonly productId: string | null;
  readonly canonicalProductId: string | null;
  readonly discountPercentage: string | null;
  /** Precio final por unidad de venta, no el total del lote. */
  readonly fixedPrice: string | null;
  readonly requiredQuantity: number | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly bank: string | null;
  readonly membershipProgram: string | null;
  readonly minimumSpend: string | null;
  readonly discountCap: string | null;
  readonly capPeriod: DiscountCapPeriod | null;
  readonly eligibleWeekdays: readonly number[];
  readonly isStackable: boolean;
  readonly terms: string | null;
  readonly source: string;
  readonly externalId: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date;
}

/** Dónde y sobre qué se está comprando. */
export interface PromotionTarget {
  readonly storeId: string;
  readonly chainId: string;
  readonly productId: string;
  readonly canonicalProductId: string | null;
}

/**
 * Por qué una promoción no se aplica. Se devuelve junto al cálculo: el usuario
 * tiene que poder ver que existe y por qué no le corresponde.
 */
export type PromotionSkipReason =
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'WEEKDAY_NOT_ELIGIBLE'
  | 'SCOPE_STORE'
  | 'SCOPE_PRODUCT'
  | 'PAYMENT_CONDITIONED'
  | 'MEMBERSHIP_CONDITIONED'
  | 'MINIMUM_SPEND_UNKNOWN'
  | 'MINIMUM_SPEND_NOT_REACHED'
  | 'CAP_PERIOD_UNSUPPORTED'
  | 'SALE_MODE_UNSUPPORTED'
  | 'QUANTITY_NOT_INTEGER'
  | 'QUANTITY_BELOW_MINIMUM'
  | 'NO_SAVINGS';
