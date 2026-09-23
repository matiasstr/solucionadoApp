'use client';

import { Brand } from '@tusofertas/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '../../lib/api';
import { MIN_QUERY_LENGTH, parseFilters, toSearchHref, toSearchParams } from '../../lib/catalog/filters';
import type { SearchFilters } from '../../lib/catalog/filters';
import { useProductSearch, useStores } from '../../lib/catalog/queries';
import { HeaderAuthLinks } from '../auth/header-auth-links';
import { DemoNotice, EmptyState, ErrorState, LoadingState } from '../common/states';
import { ProductCard } from './product-card';
import { SearchFiltersBar } from './search-filters';

/** Tiempo de espera antes de buscar mientras se escribe. */
const TYPING_DELAY_MS = 400;

/**
 * Pantalla de búsqueda. Todo el estado vive en la URL: un enlace compartido
 * reproduce la misma búsqueda y "atrás" vuelve a la anterior. Mientras se
 * escribe, la URL se reemplaza (no se apila) para no llenar el historial.
 */
export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = parseFilters(params);
  const inputId = useId();
  const [term, setTerm] = useState(filters.q);
  const [urlTerm, setUrlTerm] = useState(filters.q);

  // La URL manda: si cambia desde afuera (atrás, enlace compartido), el campo la
  // sigue. Se ajusta durante el render, no en un efecto, para no encadenar renders.
  if (filters.q !== urlTerm) {
    setUrlTerm(filters.q);
    setTerm(filters.q);
  }

  useEffect(() => {
    if (term === filters.q) return;
    const timer = setTimeout(() => {
      router.replace(toSearchHref({ ...filters, q: term }), { scroll: false });
    }, TYPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term, filters, router]);

  // Escribir reemplaza la URL (una entrada por tecla sería inusable); cambiar un
  // filtro es una acción deliberada y sí entra en el historial, así "atrás" la deshace.
  const applyFilters = (next: SearchFilters) => router.push(toSearchHref(next), { scroll: false });

  const stores = useStores();
  const search = useProductSearch(filters);
  const enoughTerm = filters.q.trim().length >= MIN_QUERY_LENGTH;
  const items = search.data?.items ?? [];

  return (
    <>
      <a className="skip-link" href="#resultados">Ir a los resultados</a>
      <header className="site-header mx-auto flex max-w-6xl items-center justify-between px-6">
        <Link href="/" className="brand-link"><Brand /></Link>
        <HeaderAuthLinks />
      </header>

      <main className="search-main mx-auto max-w-6xl px-6">
        <h1 className="search-title">Comparar precios</h1>
        <DemoNotice />

        <div className="field search-field">
          <label htmlFor={inputId}>Buscá un producto</label>
          <input
            id={inputId}
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Arroz, leche, yerba o un código de barras"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <p className="field-hint">
            Buscamos por nombre, marca o código de barras. Los precios por kilo o litro hacen comparables las
            presentaciones distintas.
          </p>
        </div>

        <SearchFiltersBar filters={filters} stores={stores.data?.items ?? []} onChange={applyFilters} showSort={false} />

        <section id="resultados" aria-live="polite" aria-busy={search.isFetching}>
          {!enoughTerm && (
            <EmptyState title="Escribí qué estás buscando">
              <p>Con dos letras alcanza. También podés pegar un código de barras.</p>
            </EmptyState>
          )}

          {enoughTerm && search.isPending && <LoadingState />}

          {enoughTerm && search.isError && (
            <ErrorState
              message={search.error instanceof ApiError ? search.error.message : 'Probá de nuevo en unos minutos.'}
              onRetry={() => void search.refetch()}
            />
          )}

          {enoughTerm && search.isSuccess && items.length === 0 && (
            <EmptyState title={`No encontramos productos para "${filters.q}"`}>
              <p>
                Probá con otro nombre o sacá algún filtro.
                {search.data.scope.origin !== 'ALL' && ' Quizá no se venda en las sucursales que elegiste.'}
              </p>
            </EmptyState>
          )}

          {enoughTerm && search.isSuccess && items.length > 0 && (
            <>
              <p className="results-count">
                {items.length} {items.length === 1 ? 'producto' : 'productos'}
                {search.data.scope.storesConsidered !== null
                  ? ` en ${search.data.scope.storesConsidered} ${search.data.scope.storesConsidered === 1 ? 'sucursal' : 'sucursales'}`
                  : ''}
                {' · '}
                <span>ordenados por nombre; con el precio más barato de cada uno</span>
              </p>
              <ul className="product-grid">
                {items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    href={`/producto/${product.id}?${toSearchParams(filters).toString()}`}
                  />
                ))}
              </ul>
              {search.data.page.nextCursor && (
                <p className="results-note">
                  Mostramos los primeros {items.length} resultados. Afiná la búsqueda para ver otros.
                </p>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
