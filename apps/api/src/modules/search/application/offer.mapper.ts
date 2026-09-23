import { DecimalValue } from '../../catalog/domain/decimal';
import { unitPricePer100g } from '../../catalog/domain/units';
import { freshnessOf } from '../../prices/domain/price-freshness';
import { UNIT_PRICE_SCALE } from '../../prices/domain/price-normalizer';
import type { CurrentPriceRecord } from '../../prices/domain/price-records';
import type { StoreSummaryRecord } from '../../stores/domain/store-records';
import { toStoreDto } from '../../stores/presentation/store.contracts';
import type { OfferDto, OfferPromotionDto } from '../presentation/search.contracts';

export interface OfferContext {
  readonly distanceMeters: number | null;
  readonly freshness: { readonly now: Date; readonly maxAgeDays: number };
  readonly promotion: OfferPromotionDto | null;
}

/** Una oferta siempre viaja con su procedencia, su frescura y su unidad comparable. */
export function buildOffer(
  price: CurrentPriceRecord,
  store: StoreSummaryRecord,
  context: OfferContext,
): OfferDto {
  const freshness = freshnessOf(price.observedAt, context.freshness.now, context.freshness.maxAgeDays);
  return {
    store: toStoreDto(store, context.distanceMeters),
    price: price.price,
    currency: price.currency,
    unitPrice: price.unitPrice,
    unitPriceUnit: price.unitPriceUnit,
    // El precio por 100 g solo tiene sentido para masa.
    unitPricePer100g:
      price.unitPriceUnit === 'KG'
        ? unitPricePer100g(DecimalValue.parse(price.unitPrice), price.unitPriceUnit).toFixed(UNIT_PRICE_SCALE)
        : null,
    source: price.source,
    freshness: {
      observedAt: freshness.observedAt.toISOString(),
      ageDays: freshness.ageDays,
      maxAgeDays: freshness.maxAgeDays,
      isStale: freshness.isStale,
    },
    promotion: context.promotion,
  };
}
