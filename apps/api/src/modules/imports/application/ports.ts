/**
 * Puertos de importación (P7-01, ADR 0018). Un proveedor nuevo implementa
 * `PriceProvider` o `PromotionProvider`; el importador y el dominio no cambian.
 * El gateway es la única pieza que conoce la base.
 */
import type { BaseUnit, MeasurementUnit, SaleMode } from '../../catalog/domain/units';
import type { PriceObservationInput } from '../../prices/infrastructure/product-price.repository';
import type { PromotionInput } from '../../promotions/infrastructure/promotion.repository';
import type {
  DecimalSeparator,
  NormalizedProduct,
  NormalizedStore,
  ProviderPriceItem,
  ProviderPromotionItem,
  RejectionReason,
} from '../domain/import.types';

export interface PriceProvider {
  /** Nombre estable de la fuente: forma parte de la identidad de todo lo que importa. */
  readonly source: string;
  readonly decimalSeparator: DecimalSeparator;
  /** Registros en orden de lectura. Se consumen de a uno: el proveedor no debe cargar todo en memoria. */
  records(): AsyncIterable<ProviderPriceItem>;
}

export interface PromotionProvider {
  readonly source: string;
  readonly decimalSeparator: DecimalSeparator;
  records(): AsyncIterable<ProviderPromotionItem>;
}

export type Resolution<T> =
  | { readonly ok: true; readonly value: T; readonly created: boolean }
  | { readonly ok: false; readonly reason: RejectionReason; readonly detail: string };

export interface ResolvedProduct {
  readonly id: string;
  readonly quantity: string;
  readonly unit: MeasurementUnit;
  readonly saleMode: SaleMode;
  readonly canonicalUnit: BaseUnit | null;
  /** Producto nuevo sin genérico vinculado: queda para revisión. */
  readonly pendingCanonical: boolean;
}

export interface PersistResult {
  readonly created: number;
  readonly duplicates: number;
  readonly conflicts: number;
}

/** Acceso a la base del importador de precios. Resuelve en serie: puede crear filas. */
export interface PriceImportGateway {
  resolveStores(source: string, stores: readonly NormalizedStore[]): Promise<Map<string, Resolution<string>>>;
  resolveProducts(source: string, products: readonly NormalizedProduct[]): Promise<Map<string, Resolution<ResolvedProduct>>>;
  persistPrices(inputs: readonly PriceObservationInput[]): Promise<PersistResult>;
}

export interface PromotionScopeQuery {
  readonly storeExternalIds: readonly string[];
  readonly chains: readonly string[];
  readonly productExternalIds: readonly string[];
  readonly productEans: readonly string[];
  readonly canonicalNames: readonly string[];
}

export interface PromotionScope {
  readonly stores: ReadonlyMap<string, string>;
  readonly chains: ReadonlyMap<string, string>;
  readonly productsByExternalId: ReadonlyMap<string, string>;
  readonly productsByEan: ReadonlyMap<string, string>;
  readonly canonicals: ReadonlyMap<string, string>;
}

export interface PromotionImportGateway {
  /** Solo busca: una promoción nunca crea sucursales ni productos. */
  resolvePromotionScope(source: string, query: PromotionScopeQuery): Promise<PromotionScope>;
  /** `created` o `updated`; la regla se valida antes de escribir. */
  upsertPromotion(input: PromotionInput): Promise<'created' | 'updated'>;
}
