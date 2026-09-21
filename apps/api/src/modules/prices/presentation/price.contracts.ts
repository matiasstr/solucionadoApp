/**
 * Contrato público de precios (P2-02). Se refleja en `packages/shared/src/index.ts`.
 *
 * Todo precio viaja con `source` y `freshness`: la API no devuelve un importe sin
 * decir de dónde salió, cuándo se observó y si está desactualizado (ADR 0008).
 */
import type { DecimalString, ProductDto } from '../../catalog/presentation/catalog.contracts';
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
  /** Un precio actual por sucursal, del más barato por unidad base al más caro. */
  prices: StorePriceDto[];
}
