import type { ProductSearchItemDto } from '@tusofertas/shared';
import Link from 'next/link';
import {
  formatArs,
  formatDistance,
  formatMinimumQuantity,
  formatObservedAt,
  formatPromotionType,
  formatQuantity,
  formatUnitPrice,
} from '../../lib/format';
import { StaleBadge } from '../common/states';

/**
 * Tarjeta de resultado: primero el precio y el precio por unidad base (lo que
 * permite comparar presentaciones), después dónde está y cuándo se observó.
 * Sin oferta en el alcance elegido, se dice; no se muestra un precio de otra zona.
 */
export function ProductCard({ product, href }: { product: ProductSearchItemDto; href: string }) {
  const offer = product.bestOffer;
  const distance = offer ? formatDistance(offer.store.distanceMeters) : null;

  return (
    <li className="product-card">
      <Link href={href} className="product-card-link">
        <div className="product-card-head">
          <h3>{product.name}</h3>
          <p className="product-card-presentation">
            {formatQuantity(product.quantity, product.unit)}
            {product.brand ? ` · ${product.brand}` : ''}
            {product.saleMode === 'VARIABLE_WEIGHT' ? ' · por peso' : ''}
          </p>
        </div>

        {offer ? (
          <div className="product-card-offer">
            <p className="product-price">{formatArs(offer.price)}</p>
            <p className="product-unit-price">{formatUnitPrice(offer.unitPrice, offer.unitPriceUnit)}</p>
            {offer.promotion && (
              <p className="promotion-chip">
                <span>{formatPromotionType(offer.promotion.type)}</span>
                {formatMinimumQuantity(offer.promotion.minimumQuantity)}: {formatArs(offer.promotion.total)}
              </p>
            )}
            <p className="product-store">
              {offer.store.chainName} · {offer.store.name.replace(/ \(DEMO\)$/, '')}
              {distance ? ` · ${distance}` : ''}
            </p>
            <p className="product-freshness">
              <span title={offer.freshness.observedAt}>
                {formatObservedAt(offer.freshness.observedAt, offer.freshness.ageDays)}
              </span>
              {offer.freshness.isStale && <StaleBadge ageDays={offer.freshness.ageDays} />}
            </p>
          </div>
        ) : (
          <p className="product-card-empty">Sin precio observado en las sucursales de esta búsqueda.</p>
        )}
      </Link>
    </li>
  );
}
