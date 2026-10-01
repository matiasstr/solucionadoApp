'use client';

import type { CanonicalOfferDto } from '@tusofertas/shared';
import { Brand } from '@tusofertas/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '../../lib/api';
import { conditionParts } from '../../lib/benefits/format';
import { parseFilters, toSearchHref, toSearchParams } from '../../lib/catalog/filters';
import type { SearchFilters } from '../../lib/catalog/filters';
import { useCanonicalPrices, useProduct, useStores } from '../../lib/catalog/queries';
import {
  formatArs,
  formatDistance,
  formatMinimumQuantity,
  formatObservedAt,
  formatPromotionType,
  formatQuantity,
  formatUnitPrice,
} from '../../lib/format';
import { AlertCreator } from '../alerts/alert-creator';
import { HeaderAuthLinks } from '../auth/header-auth-links';
import { DemoNotice, EmptyState, ErrorState, LoadingState, StaleBadge } from '../common/states';
import { SearchFiltersBar } from '../search/search-filters';
import { HISTORY_PERIODS, PriceHistorySection } from './price-history';
import type { HistoryPeriod } from './price-history';

/** Parámetros propios de la ficha que los filtros de búsqueda no conocen. */
const HISTORY_PARAMS = ['periodo', 'sucursal'] as const;

/**
 * Ficha del producto con la comparación por sucursal, las alternativas de la
 * misma necesidad y el historial de precios (P6-02). Filtros, período y sucursal
 * del historial viven en la URL.
 */
export function ProductView({ productId }: { productId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const filters = parseFilters(params);

  const product = useProduct(productId);
  const stores = useStores();
  const canonicalId = product.data?.canonicalProduct?.id ?? null;
  const comparison = useCanonicalPrices(canonicalId, productId, filters);

  const periodParam = Number(params.get('periodo'));
  const period: HistoryPeriod = (HISTORY_PERIODS as readonly number[]).includes(periodParam) ? (periodParam as HistoryPeriod) : 30;
  const historyStoreId = params.get('sucursal');

  // Cambiar un filtro entra en el historial: "atrás" deshace el cambio.
  const applyFilters = (next: SearchFilters) => {
    const nextParams = toSearchParams(next);
    for (const key of HISTORY_PARAMS) {
      const value = params.get(key);
      if (value) nextParams.set(key, value);
    }
    router.push(`/producto/${productId}?${nextParams.toString()}`, { scroll: false });
  };
  const applyHistory = ({ period: nextPeriod, storeId }: { period: HistoryPeriod; storeId: string | null }) => {
    const nextParams = toSearchParams(filters);
    if (nextPeriod !== 30) nextParams.set('periodo', String(nextPeriod));
    if (storeId) nextParams.set('sucursal', storeId);
    router.push(`/producto/${productId}?${nextParams.toString()}`, { scroll: false });
  };

  const offers = comparison.data?.offers ?? [];
  const exact = offers.filter((offer) => offer.matchType === 'EXACT');
  const alternatives = offers.filter((offer) => offer.matchType === 'ALTERNATIVE');

  return (
    <>
      <a className="skip-link" href="#comparacion">Ir a la comparación</a>
      <header className="site-header mx-auto flex max-w-6xl items-center justify-between px-6">
        <Link href="/" className="brand-link"><Brand /></Link>
        <HeaderAuthLinks />
      </header>

      <main className="product-main mx-auto max-w-6xl px-6">
        <p className="breadcrumb">
          <Link className="text-link" href={toSearchHref(filters)}>
            ← Volver a la búsqueda
          </Link>
        </p>

        {product.isPending && <LoadingState label="Cargando el producto…" />}

        {product.isError && (
          <ErrorState
            message={
              product.error instanceof ApiError && product.error.status === 404
                ? 'Ese producto no existe o ya no está en el catálogo.'
                : 'Probá de nuevo en unos minutos.'
            }
            onRetry={() => void product.refetch()}
          />
        )}

        {product.isSuccess && (
          <>
            <h1 className="product-title">{product.data.name}</h1>
            <p className="product-subtitle">
              {formatQuantity(product.data.quantity, product.data.unit)}
              {product.data.brand ? ` · ${product.data.brand}` : ''}
              {product.data.saleMode === 'VARIABLE_WEIGHT' ? ' · se vende por peso' : ''}
              {product.data.ean ? ` · EAN ${product.data.ean}` : ''}
            </p>
            <DemoNotice />

            <SearchFiltersBar filters={filters} stores={stores.data?.items ?? []} onChange={applyFilters} />

            <section id="comparacion" aria-live="polite" aria-busy={comparison.isFetching}>
              {!canonicalId && (
                <EmptyState title="Este producto todavía no tiene equivalentes cargados">
                  <p>No podemos compararlo con otras presentaciones.</p>
                </EmptyState>
              )}

              {canonicalId && comparison.isPending && <LoadingState />}

              {canonicalId && comparison.isError && (
                <ErrorState
                  message={
                    comparison.error instanceof ApiError ? comparison.error.message : 'Probá de nuevo en unos minutos.'
                  }
                  onRetry={() => void comparison.refetch()}
                />
              )}

              {canonicalId && comparison.isSuccess && offers.length === 0 && (
                <EmptyState title="Sin precios en las sucursales elegidas">
                  <p>Probá sacando el filtro de cadena o de localidad.</p>
                </EmptyState>
              )}

              {canonicalId && comparison.isSuccess && offers.length > 0 && (
                <>
                  <OfferGroup
                    title="Este producto, por sucursal"
                    description="El mismo producto exacto en cada sucursal que lo tiene."
                    offers={exact}
                    emptyMessage="No hay precio de este producto en las sucursales elegidas."
                  />
                  <OfferGroup
                    title="Alternativas equivalentes"
                    description={`Otras presentaciones de ${comparison.data.canonicalProduct.name}. Son alternativas, no el mismo producto.`}
                    offers={alternatives}
                    emptyMessage="No hay otras presentaciones con precio en esta búsqueda."
                  />
                  <p className="results-note">
                    Ordenado por {comparison.data.sortBy === 'PRICE' ? 'precio del envase' : comparison.data.sortBy === 'DISTANCE' ? 'distancia' : 'precio por kilo o litro'}.
                    {!comparison.data.scope.distancesAvailable && ' Sin tu ubicación no podemos calcular distancias.'}
                  </p>
                </>
              )}
            </section>

            <PriceHistorySection
              productId={productId}
              filters={filters}
              period={period}
              storeId={historyStoreId}
              onChange={applyHistory}
            />

            <AlertCreator product={product.data} />
          </>
        )}
      </main>
    </>
  );
}

function OfferGroup({
  title,
  description,
  offers,
  emptyMessage,
}: {
  title: string;
  description: string;
  offers: readonly CanonicalOfferDto[];
  emptyMessage: string;
}) {
  return (
    <section className="offer-group">
      <h2>{title}</h2>
      <p className="offer-group-note">{description}</p>
      {offers.some((offer) => offer.paymentBenefits.length > 0) && (
        <p className="offer-group-note">
          Los beneficios de banco, billetera o socios no están incluidos en el precio: dependen de cómo pagás. Tu plan
          semanal los calcula por compra con lo que declaraste en Preferencias.
        </p>
      )}
      {offers.length === 0 ? (
        <p className="product-card-empty">{emptyMessage}</p>
      ) : (
        <ul className="offer-list">
          {offers.map((offer) => (
            <OfferRow key={`${offer.product.id}-${offer.store.id}`} offer={offer} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OfferRow({ offer }: { offer: CanonicalOfferDto }) {
  const distance = formatDistance(offer.store.distanceMeters);
  return (
    <li className="offer-row">
      <div className="offer-main">
        <p className="offer-store">
          {offer.store.chainName} · {offer.store.name.replace(/ \(DEMO\)$/, '')}
        </p>
        <p className="offer-product">
          {offer.product.name}
          <span className={offer.matchType === 'EXACT' ? 'match-badge match-exact' : 'match-badge'}>
            {offer.matchType === 'EXACT' ? 'Producto exacto' : 'Alternativa'}
          </span>
        </p>
        <p className="offer-meta">
          {offer.store.city}
          {distance ? ` · ${distance}` : ''} ·{' '}
          <span title={`Observado el ${offer.freshness.observedAt} (fuente: ${offer.source})`}>
            {formatObservedAt(offer.freshness.observedAt, offer.freshness.ageDays)}
          </span>
          {offer.freshness.isStale && <StaleBadge ageDays={offer.freshness.ageDays} />}
        </p>
      </div>
      <div className="offer-prices">
        <p className="offer-price">{formatArs(offer.price)}</p>
        <p className="offer-unit-price">{formatUnitPrice(offer.unitPrice, offer.unitPriceUnit)}</p>
        {offer.promotion && (
          <p className="promotion-chip">
            <span>{formatPromotionType(offer.promotion.type)}</span>
            {formatMinimumQuantity(offer.promotion.minimumQuantity)}: {formatArs(offer.promotion.total)} (
            {formatUnitPrice(offer.promotion.promotionalUnitPrice, offer.unitPriceUnit)})
          </p>
        )}
      </div>
      {offer.paymentBenefits.length > 0 && (
        <ul className="offer-benefits" aria-label="Beneficios según cómo pagás, no incluidos en el precio">
          {offer.paymentBenefits.map((benefit) => {
            const [headline, ...rest] = conditionParts(benefit.conditions);
            return (
              <li key={benefit.id} title={benefit.name}>
                <span className="benefit-badge">{benefit.conditions.membershipProgram && !benefit.conditions.bank ? 'SOCIOS' : 'PAGO'}</span>
                <strong>{headline}</strong>
                {rest.length > 0 && <> · {rest.join(' · ')}</>}
                {!benefit.availableToday && <em> · hoy no aplica</em>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
