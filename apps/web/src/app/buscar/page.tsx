import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchView } from '../../components/search/search-view';

export const metadata: Metadata = {
  title: 'Comparar precios · Tus Ofertas',
  description: 'Buscá un producto y compará su precio por kilo o litro entre sucursales.',
};

export default function BuscarPage() {
  // useSearchParams (los filtros viven en la URL) necesita un límite Suspense.
  return (
    <Suspense fallback={<p className="data-state" role="status">Cargando el buscador…</p>}>
      <SearchView />
    </Suspense>
  );
}
