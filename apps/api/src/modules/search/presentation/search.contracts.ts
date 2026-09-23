/**
 * Contrato público de búsqueda y comparación (P3-01/P3-02). Se refleja en
 * `packages/shared/src/index.ts`.
 *
 * Una tarjeta de resultado necesita precio, unidad comparable, sucursal, distancia
 * si se puede calcular y la condición de la oferta: todo eso viaja en `bestOffer`.
 */
import type { BaseUnit } from '../../catalog/domain/units';
import type { CanonicalProductDto, DecimalString, ProductDto } from '../../catalog/presentation/catalog.contracts';
import type { PriceFreshnessDto, PriceScopeDto, PriceSortBy } from '../../prices/presentation/price.contracts';
import type { PromotionType } from '../../promotions/domain/promotion.types';
import type { StoreScopeOrigin } from '../../stores/application/resolve-store-scope.use-case';
import type { StoreDto } from '../../stores/presentation/store.contracts';

export interface OfferPromotionDto {
  id: string;
  name: string;
  type: PromotionType;
  /** Unidades que hay que llevar para obtener el beneficio. */
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

/** Precio de un producto en una sucursal, con su procedencia y su promoción. */
export interface OfferDto {
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

export interface ProductSearchItemDto extends ProductDto {
  /** Oferta más barata por unidad base dentro del alcance; null si no hay precio. */
  bestOffer: OfferDto | null;
}

export interface SearchScopeDto {
  origin: StoreScopeOrigin;
  radiusKm: number | null;
  /** Sucursales consideradas; null cuando la búsqueda no se acotó por ubicación. */
  storesConsidered: number | null;
}

export interface SearchProductsResultDto {
  items: ProductSearchItemDto[];
  page: { limit: number; nextCursor: string | null };
  scope: SearchScopeDto;
}

/** Coincidencia exacta con lo buscado, o alternativa del mismo canónico. */
export type OfferMatchType = 'EXACT' | 'ALTERNATIVE';

export interface CanonicalOfferDto extends OfferDto {
  product: ProductDto;
  matchType: OfferMatchType;
}

export interface CanonicalPricesDto {
  canonicalProduct: CanonicalProductDto;
  scope: PriceScopeDto;
  sortBy: PriceSortBy;
  /** Una oferta por presentación y sucursal, comparables por unidad base. */
  offers: CanonicalOfferDto[];
}
