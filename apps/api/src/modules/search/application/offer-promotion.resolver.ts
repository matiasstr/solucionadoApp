import { Injectable } from '@nestjs/common';
import { DecimalValue } from '../../catalog/domain/decimal';
import { toBaseQuantity } from '../../catalog/domain/units';
import type { ProductRecord } from '../../catalog/domain/catalog-records';
import { UNIT_PRICE_SCALE } from '../../prices/domain/price-normalizer';
import { minimumQuantityFor, priceLine } from '../../promotions/domain/promotion-calculator';
import type { PromotionRule } from '../../promotions/domain/promotion.types';
import type { StoreSummaryRecord } from '../../stores/domain/store-records';
import type { OfferPromotionDto } from '../presentation/search.contracts';

/**
 * Traduce las reglas promocionales vigentes en el beneficio concreto de una oferta.
 *
 * Evalúa cada promoción sobre la cantidad mínima que la habilita (dos unidades en
 * un 2×1) y devuelve la que más ahorro da. El precio regular no se toca: el
 * beneficio se muestra al lado, con la condición que exige (ADR 0009).
 */
@Injectable()
export class OfferPromotionResolver {
  resolve(
    product: ProductRecord,
    unitPrice: string,
    store: StoreSummaryRecord,
    rules: readonly PromotionRule[],
    instant: Date,
  ): OfferPromotionDto | null {
    if (!rules.length) return null;
    const target = {
      storeId: store.id,
      chainId: store.chainId,
      productId: product.id,
      canonicalProductId: product.canonicalProductId,
    };
    let best: OfferPromotionDto | null = null;
    for (const rule of rules) {
      const minimumQuantity = minimumQuantityFor(rule);
      // La venta por peso se compara sobre su base de cotización (1 KG, 1 L).
      const quantity = product.saleMode === 'VARIABLE_WEIGHT' ? '1' : String(minimumQuantity);
      const charge = priceLine({ unitPrice, quantity, saleMode: product.saleMode }, [rule], { target, instant });
      if (charge.appliedPromotionId !== rule.id) continue;

      const baseQuantity = toBaseQuantity(DecimalValue.parse(product.quantity), product.unit).multiply(
        DecimalValue.parse(quantity),
      );
      const candidate: OfferPromotionDto = {
        id: rule.id,
        name: rule.name,
        type: rule.type,
        minimumQuantity: product.saleMode === 'VARIABLE_WEIGHT' ? 1 : minimumQuantity,
        regularTotal: charge.regularTotal,
        total: charge.total,
        discount: charge.discount,
        promotionalUnitPrice: DecimalValue.parse(charge.total)
          .divide(baseQuantity, UNIT_PRICE_SCALE)
          .toFixed(UNIT_PRICE_SCALE),
        eligibleWeekdays: [...rule.eligibleWeekdays],
        terms: rule.terms,
      };
      if (!best || DecimalValue.parse(candidate.discount).compare(DecimalValue.parse(best.discount)) > 0) {
        best = candidate;
      }
    }
    return best;
  }
}
