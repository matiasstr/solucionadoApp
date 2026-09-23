import type { PriceSortBy } from '@tusofertas/shared';

/**
 * Filtros de búsqueda en la URL: son el estado de la pantalla, así que un
 * enlace compartido o el botón "atrás" reproducen exactamente lo mismo.
 * Los nombres son cortos y en español porque los ve la persona.
 */
export interface SearchFilters {
  readonly q: string;
  readonly chainId: string | null;
  readonly city: string | null;
  readonly province: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly sortBy: PriceSortBy;
}

export const EMPTY_FILTERS: SearchFilters = {
  q: '',
  chainId: null,
  city: null,
  province: null,
  latitude: null,
  longitude: null,
  sortBy: 'UNIT_PRICE',
};

/** Radio fijo cuando la persona comparte su ubicación; se puede ajustar en P4-02. */
export const NEARBY_RADIUS_KM = 10;

/** La API rechaza términos de una sola letra: se avisa antes de consultar. */
export const MIN_QUERY_LENGTH = 2;

const SORT_VALUES: Record<string, PriceSortBy> = {
  unidad: 'UNIT_PRICE',
  envase: 'PRICE',
  distancia: 'DISTANCE',
};
const SORT_PARAM: Record<PriceSortBy, string> = {
  UNIT_PRICE: 'unidad',
  PRICE: 'envase',
  DISTANCE: 'distancia',
};

const coordinate = (value: string | null, max: number): number | null => {
  if (!value || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Math.abs(parsed) <= max ? parsed : null;
};

export function parseFilters(params: URLSearchParams | null): SearchFilters {
  if (!params) return EMPTY_FILTERS;
  const latitude = coordinate(params.get('lat'), 90);
  const longitude = coordinate(params.get('lon'), 180);
  const city = params.get('ciudad');
  const province = params.get('provincia');
  const hasCoordinates = latitude !== null && longitude !== null;
  return {
    q: (params.get('q') ?? '').slice(0, 120),
    chainId: params.get('cadena'),
    // Localidad y coordenadas son excluyentes: la API rechaza las dos juntas.
    city: hasCoordinates ? null : city,
    province: hasCoordinates ? null : province,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    sortBy: SORT_VALUES[params.get('orden') ?? ''] ?? 'UNIT_PRICE',
  };
}

/** Solo escribe en la URL lo que difiere de lo predeterminado. */
export function toSearchParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.chainId) params.set('cadena', filters.chainId);
  if (filters.latitude !== null && filters.longitude !== null) {
    params.set('lat', String(filters.latitude));
    params.set('lon', String(filters.longitude));
  } else if (filters.city && filters.province) {
    params.set('ciudad', filters.city);
    params.set('provincia', filters.province);
  }
  if (filters.sortBy !== 'UNIT_PRICE') params.set('orden', SORT_PARAM[filters.sortBy]);
  return params;
}

export const toSearchHref = (filters: SearchFilters): string => {
  const query = toSearchParams(filters).toString();
  return query ? `/buscar?${query}` : '/buscar';
};

export const hasLocation = (filters: SearchFilters): boolean =>
  (filters.latitude !== null && filters.longitude !== null) || Boolean(filters.city && filters.province);

/** Parámetros de ubicación para la API; los nombres son los del contrato. */
export function locationQuery(filters: SearchFilters): Record<string, string> {
  if (filters.latitude !== null && filters.longitude !== null) {
    return {
      latitude: String(filters.latitude),
      longitude: String(filters.longitude),
      radiusKm: String(NEARBY_RADIUS_KM),
    };
  }
  if (filters.city && filters.province) return { city: filters.city, province: filters.province };
  return {};
}

/** Etiqueta de la localidad elegida, para mostrarla y para el selector. */
export const localityValue = (city: string | null, province: string | null): string =>
  city && province ? `${city}|${province}` : '';

export function parseLocalityValue(value: string): { city: string | null; province: string | null } {
  const [city, province] = value.split('|');
  return city && province ? { city, province } : { city: null, province: null };
}
