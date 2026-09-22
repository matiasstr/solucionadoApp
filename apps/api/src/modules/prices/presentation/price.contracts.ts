/**
 * Contrato público de precios (P2-02). Se refleja en `packages/shared/src/index.ts`.
 *
 * Todo precio viaja con `source` y `freshness`: la API no devuelve un importe sin
 * decir de dónde salió, cuándo se observó y si está desactualizado (ADR 0008).
 */
import type {
  CanonicalProductDto,
  DecimalString,
  ProductDto,
} from '../../catalog/presentation/catalog.contracts';
import type { PromotionType } from '../../promotions/domain/promotion.types';
import type { BaseUnit } from '../../catalog/domain/units';
import type { StoreDto } from '../../stores/presentation/store.contracts';

export interface PriceFreshnessDto {
  /** Instante observado, ISO 8601 en UTC. */
  observedAt: string;
  ageDays: number;
  maxAgeDays: number;
  isStale: boolean;
}

export interface StorePriceDto {
  store: StoreDto;
  /** Precio del paquete completo o de la base de cotización. */
  price: DecimalString;
  currency: string;
  unitPrice: DecimalString;
  unitPriceUnit: BaseUnit;
  /** Solo para productos por peso en KG; null en el resto. */
  unitPricePer100g: DecimalString | null;
  source: string;
  freshness: PriceFreshnessDto;
}

/** Cómo se eligieron las sucursales: sin coordenadas no se afirma distancia. */
export type PriceScopeOrigin = 'COORDINATES' | 'LOCALITY' | 'ALL';

export interface PriceScopeDto {
  origin: PriceScopeOrigin;
  radiusKm: number | null;
  distancesAvailable: boolean;
  storesConsidered: number;
  maxAgeDays: number;
  includeStale: boolean;
}

export interface ProductPricesDto {
  product: ProductDto;
  scope: PriceScopeDto;
  sortBy: PriceSortBy;
  /** Un precio actual por sucursal, del más barato por unidad base al más caro. */
  prices: StorePriceDto[];
}

/** Criterio de orden de una comparación de precios. */
export type PriceSortBy = 'UNIT_PRICE' | 'PRICE' | 'DISTANCE';

/** Coincidencia exacta con lo buscado, o alternativa del mismo canónico. */
export type OfferMatchType = 'EXACT' | 'ALTERNATIVE';

/**
 * Promoción que cambia el precio de una oferta. El precio regular se conserva
 * aparte: el beneficio se muestra junto a la cantidad que hay que llevar.
 */
export interface OfferPromotionDto {
  id: string;
  name: string;
  type: PromotionType;
  /** Unidades necesarias para obtener el beneficio. */
  minimumQuantity: number;
  /** Totales para esa cantidad. */
  regularTotal: DecimalString;
  total: DecimalString;
  discount: DecimalString;
  /** Precio por unidad base con la promoción, comparable con `unitPrice`. */
  promotionalUnitPrice: DecimalString;
  /** ISO 1 = lunes … 7 = domingo; vacío significa todos los días. */
  eligibleWeekdays: number[];
  terms: string | null;
}

export interface CanonicalOfferDto {
  product: ProductDto;
  matchType: OfferMatchType;
  store: StoreDto;
  price: DecimalString;
  currency: string;
  unitPrice: DecimalString;
  unitPriceUnit: BaseUnit;
  unitPricePer100g: DecimalString | null;
  source: string;
  freshness: PriceFreshnessDto;
  /** Null cuando ninguna promoción automática alcanza a esta oferta. */
  promotion: OfferPromotionDto | null;
}

export interface CanonicalPricesDto {
  canonicalProduct: CanonicalProductDto;
  scope: PriceScopeDto;
  sortBy: PriceSortBy;
  /** Ofertas de todas las presentaciones del canónico, una por producto y sucursal. */
  offers: CanonicalOfferDto[];
}
