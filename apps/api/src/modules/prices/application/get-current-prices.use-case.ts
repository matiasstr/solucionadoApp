import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { DecimalValue } from '../../catalog/domain/decimal';
import { unitPricePer100g } from '../../catalog/domain/units';
import { freshnessOf } from '../domain/price-freshness';
import type { CurrentPriceRecord, CurrentPriceView } from '../domain/price-records';
import { UNIT_PRICE_SCALE } from '../domain/price-normalizer';
import { ProductPriceRepository } from '../infrastructure/product-price.repository';

export interface CurrentPricesQuery {
  readonly storeIds?: readonly string[];
  /** Momento de referencia; los tests lo fijan para que no caduquen. */
  readonly now?: Date;
  /** Sobrescribe el umbral configurado (PRICE_MAX_AGE_DAYS). */
  readonly maxAgeDays?: number;
  /** Por defecto se devuelven también los desactualizados, marcados con su fecha. */
  readonly includeStale?: boolean;
}

/**
 * Precio actual por sucursal con su frescura. Un precio viejo no se oculta ni se
 * presenta como disponibilidad garantizada: viaja con fecha, fuente y `isStale`.
 */
@Injectable()
export class GetCurrentPricesUseCase {
  constructor(
    private readonly prices: ProductPriceRepository,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(productId: string, query: CurrentPricesQuery = {}): Promise<CurrentPriceView[]> {
    const now = query.now ?? new Date();
    const maxAgeDays = query.maxAgeDays ?? this.config.prices.maxAgeDays;
    const rows = await this.prices.findCurrentByProduct(productId, {
      storeIds: query.storeIds,
      sourcePrecedence: this.config.prices.sourcePrecedence,
    });
    const views = rows
      .map((row) => this.toView(row, now, maxAgeDays))
      .filter((view) => query.includeStale === false ? !view.freshness.isStale : true);
    // Orden estable y comparable: primero el más barato por unidad base.
    return views.sort((a, b) => {
      const byUnitPrice = DecimalValue.parse(a.unitPrice).compare(DecimalValue.parse(b.unitPrice));
      if (byUnitPrice !== 0) return byUnitPrice;
      return a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0;
    });
  }

  private toView(row: CurrentPriceRecord, now: Date, maxAgeDays: number): CurrentPriceView {
    return {
      ...row,
      freshness: freshnessOf(row.observedAt, now, maxAgeDays),
      unitPricePer100g:
        row.unitPriceUnit === 'KG'
          ? unitPricePer100g(DecimalValue.parse(row.unitPrice), row.unitPriceUnit).toFixed(UNIT_PRICE_SCALE)
          : null,
    };
  }
}
