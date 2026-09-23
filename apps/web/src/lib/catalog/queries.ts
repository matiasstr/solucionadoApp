'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CanonicalPricesDto,
  PaginatedDto,
  ProductDetailDto,
  SearchProductsResultDto,
  StoreDto,
} from '@tusofertas/shared';
import { apiRequest } from '../api';
import { locationQuery } from './filters';
import type { SearchFilters } from './filters';

/**
 * Consultas del catálogo público. Las claves incluyen todos los filtros, así que
 * cambiar uno trae datos nuevos en vez de mostrar los anteriores, y TanStack
 * Query cancela lo que quedó viejo con el `signal`.
 */

const withQuery = (path: string, params: Record<string, string>): string => {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
};

const searchParams = (filters: SearchFilters, limit: number): Record<string, string> => ({
  ...(filters.q.trim() ? { search: filters.q.trim() } : {}),
  ...(filters.chainId ? { chainId: filters.chainId } : {}),
  ...locationQuery(filters),
  limit: String(limit),
});

export function useProductSearch(filters: SearchFilters, limit = 20) {
  const params = searchParams(filters, limit);
  return useQuery({
    queryKey: ['products', 'search', params],
    queryFn: ({ signal }) => apiRequest<SearchProductsResultDto>(withQuery('/products', params), { signal }),
  });
}

export function useProduct(productId: string) {
  return useQuery({
    queryKey: ['products', productId],
    queryFn: ({ signal }) => apiRequest<ProductDetailDto>(`/products/${productId}`, { signal }),
  });
}

/** Comparación de las alternativas de una necesidad, con el mismo alcance. */
export function useCanonicalPrices(
  canonicalProductId: string | null,
  productId: string,
  filters: SearchFilters,
) {
  const params = {
    productId,
    sortBy: filters.sortBy,
    ...locationQuery(filters),
    limit: '50',
  };
  return useQuery({
    enabled: Boolean(canonicalProductId),
    queryKey: ['canonical-products', canonicalProductId, 'prices', params],
    queryFn: ({ signal }) =>
      apiRequest<CanonicalPricesDto>(withQuery(`/canonical-products/${canonicalProductId}/prices`, params), { signal }),
  });
}

/**
 * Sucursales: alimentan los filtros de cadena y localidad. El dataset demo tiene
 * diez, así que alcanza con una página; con datos reales habrá un endpoint propio.
 */
export function useStores() {
  return useQuery({
    queryKey: ['stores', 'options'],
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => apiRequest<PaginatedDto<StoreDto>>('/stores?limit=50', { signal }),
  });
}
