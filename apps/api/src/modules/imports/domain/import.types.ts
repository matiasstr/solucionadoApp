/**
 * Contratos de importación (P7-01, ADR 0018). Independientes de SEPA, de cualquier
 * proveedor concreto y de Prisma: un proveedor entrega registros **crudos** (texto
 * tal como viene) y el normalizador los convierte o los rechaza con motivo.
 */
import type { MeasurementUnit, SaleMode } from '../../catalog/domain/units';
import type { DiscountCapPeriod, PaymentMethod, PromotionType } from '../../promotions/domain/promotion.types';

/** Separador decimal del proveedor. Con `,` el punto solo puede separar miles (`1.234,56`). */
export type DecimalSeparator = ',' | '.';

export interface RawStore {
  /** Identificador de la sucursal en la fuente; junto con la fuente es su identidad. */
  readonly externalId: string;
  readonly chain: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly province: string;
  /** Coordenadas con punto decimal, juntas o ninguna. */
  readonly latitude?: string | null;
  readonly longitude?: string | null;
}

export interface RawProduct {
  readonly externalId: string;
  readonly ean?: string | null;
  readonly name: string;
  readonly brand?: string | null;
  /** Contenido del envase o base de cotización, con el separador del proveedor. */
  readonly quantity: string;
  readonly unit: string;
  readonly saleMode?: string | null;
  readonly packageCount?: number | null;
  /** Categoría del catálogo por slug; si no existe, queda "sin clasificar". */
  readonly categorySlug?: string | null;
  /** Nombre del producto genérico; se vincula solo con coincidencia exacta normalizada. */
  readonly canonicalName?: string | null;
}

export interface RawPriceRecord {
  readonly kind: 'price';
  /** Identificador de la observación en la fuente, si existe: define la clave idempotente. */
  readonly recordId?: string | null;
  readonly store: RawStore;
  readonly product: RawProduct;
  /** Importe con el separador del proveedor (`1.234,56`). */
  readonly price: string;
  /** Instante ISO 8601 o día `AAAA-MM-DD` (se toma el mediodía argentino). */
  readonly observedAt: string;
}

/** Una línea que el proveedor no pudo leer: se cuenta y el lote sigue. */
export interface UnparsableRecord {
  readonly kind: 'unparsable';
  readonly detail: string;
}

export type ProviderPriceItem = RawPriceRecord | UnparsableRecord;

export interface RawPromotionRecord {
  readonly kind: 'promotion';
  readonly externalId: string;
  readonly name: string;
  readonly type: string;
  /** Alcance comercial: una sucursal de esta fuente **o** una cadena por nombre. */
  readonly storeExternalId?: string | null;
  readonly chain?: string | null;
  /** Alcance de producto: uno de esta fuente, un EAN o un genérico; ninguno = todo el comercio. */
  readonly productExternalId?: string | null;
  readonly productEan?: string | null;
  readonly canonicalName?: string | null;
  readonly discountPercentage?: string | null;
  readonly fixedPrice?: string | null;
  readonly requiredQuantity?: number | null;
  readonly paymentMethod?: string | null;
  readonly bank?: string | null;
  readonly membershipProgram?: string | null;
  readonly minimumSpend?: string | null;
  readonly discountCap?: string | null;
  readonly capPeriod?: string | null;
  readonly eligibleWeekdays?: readonly number[] | null;
  readonly terms?: string | null;
  readonly validFrom: string;
  readonly validUntil: string;
}

export type ProviderPromotionItem = RawPromotionRecord | UnparsableRecord;

// --------------------------------------------------------------- normalizados

export interface NormalizedStore {
  readonly externalId: string;
  readonly chain: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly province: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
}

export interface NormalizedProduct {
  readonly externalId: string;
  /** EAN con dígito de control válido; uno inválido se descarta y se informa. */
  readonly ean: string | null;
  readonly eanDiscarded: boolean;
  readonly name: string;
  readonly brand: string | null;
  readonly quantity: string;
  readonly unit: MeasurementUnit;
  readonly saleMode: SaleMode;
  readonly packageCount: number;
  readonly categorySlug: string | null;
  readonly canonicalName: string | null;
}

export interface NormalizedPriceRecord {
  readonly position: number;
  readonly recordId: string | null;
  readonly store: NormalizedStore;
  readonly product: NormalizedProduct;
  /** Importe con punto decimal, sin redondear: `normalizePrice` decide si es válido. */
  readonly price: string;
  readonly observedAt: Date;
}

export interface NormalizedPromotion {
  readonly position: number;
  readonly externalId: string;
  readonly name: string;
  readonly type: PromotionType;
  readonly storeExternalId: string | null;
  readonly chain: string | null;
  readonly productExternalId: string | null;
  readonly productEan: string | null;
  readonly canonicalName: string | null;
  readonly discountPercentage: string | null;
  readonly fixedPrice: string | null;
  readonly requiredQuantity: number | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly bank: string | null;
  readonly membershipProgram: string | null;
  readonly minimumSpend: string | null;
  readonly discountCap: string | null;
  readonly capPeriod: DiscountCapPeriod | null;
  readonly eligibleWeekdays: readonly number[];
  readonly terms: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date;
}

export type RejectionReason =
  | 'UNPARSABLE'
  | 'STORE_INVALID'
  | 'PRODUCT_INVALID'
  | 'UNIT_UNKNOWN'
  | 'SALE_MODE_UNKNOWN'
  | 'PRICE_INVALID'
  | 'QUANTITY_INVALID'
  | 'OBSERVED_AT_INVALID'
  | 'OBSERVED_IN_FUTURE'
  | 'PRICE_NORMALIZATION'
  | 'EAN_CONTENT_MISMATCH'
  | 'CONTENT_CHANGED'
  | 'PROMOTION_INVALID'
  | 'STORE_UNKNOWN'
  | 'CHAIN_UNKNOWN'
  | 'PRODUCT_UNKNOWN'
  | 'CANONICAL_UNKNOWN';

/** Un registro descartado: posición en el flujo, motivo y referencia (ids externos, nunca el contenido). */
export interface Rejection {
  readonly position: number;
  readonly reason: RejectionReason;
  readonly detail: string;
  readonly ref: string | null;
}

export type Normalized<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly rejection: Rejection };

export type ImportRunStatus = 'COMPLETED' | 'COMPLETED_WITH_REJECTIONS' | 'FAILED';

/** Resumen de una ejecución: lo que entró, lo repetido, lo rechazado y por qué. */
export interface ImportRunSummary {
  readonly runId: string;
  readonly kind: 'prices' | 'promotions';
  readonly source: string;
  readonly status: ImportRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Registros leídos del proveedor, válidos o no. */
  readonly read: number;
  readonly created: number;
  /** Reingresos idénticos: no se escribe nada. */
  readonly duplicates: number;
  /** Misma clave con contenido distinto: no se sobrescribe. */
  readonly conflicts: number;
  readonly updated: number;
  readonly rejected: number;
  readonly rejectedByReason: Readonly<Partial<Record<RejectionReason, number>>>;
  /** Primeros rechazos, para diagnosticar sin volcar el archivo. */
  readonly rejectionSamples: readonly Rejection[];
  readonly storesCreated: number;
  readonly productsCreated: number;
  /** Productos nuevos sin genérico: quedan pendientes de revisión, no se adivinan. */
  readonly productsPendingCanonical: number;
  readonly eansDiscarded: number;
  readonly batches: number;
  /** Mensaje saneado si la ejecución falló; nunca credenciales ni el contenido de registros. */
  readonly error: string | null;
}
