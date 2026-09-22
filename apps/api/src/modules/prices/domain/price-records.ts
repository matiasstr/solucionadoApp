/** Observaciones de precio expuestas por los repositorios: importes como texto decimal. */
import type { BaseUnit } from '../../catalog/domain/units';
import type { Freshness } from './price-freshness';

export interface PriceObservationRecord {
  readonly id: string;
  readonly productId: string;
  readonly storeId: string;
  /** Precio del paquete completo o de la base de cotización, con dos decimales. */
  readonly price: string;
  readonly unitPrice: string;
  readonly unitPriceUnit: BaseUnit;
  readonly currency: string;
  readonly source: string;
  readonly idempotencyKey: string;
  readonly importBatchId: string | null;
  readonly observedAt: Date;
  readonly ingestedAt: Date;
}

/** Última observación válida de un producto en una sucursal. */
export interface CurrentPriceRecord {
  readonly id: string;
  readonly productId: string;
  readonly storeId: string;
  readonly price: string;
  readonly unitPrice: string;
  readonly unitPriceUnit: BaseUnit;
  readonly currency: string;
  readonly source: string;
  readonly observedAt: Date;
  readonly ingestedAt: Date;
}

/** Precio actual con su frescura y la presentación por 100 g cuando aplica. */
export interface CurrentPriceView extends CurrentPriceRecord {
  readonly freshness: Freshness;
  readonly unitPricePer100g: string | null;
}
