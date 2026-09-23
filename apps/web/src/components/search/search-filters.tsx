'use client';

import type { StoreDto } from '@tusofertas/shared';
import { useId, useState } from 'react';
import { localityValue, parseLocalityValue } from '../../lib/catalog/filters';
import type { SearchFilters } from '../../lib/catalog/filters';

interface Props {
  readonly filters: SearchFilters;
  readonly stores: readonly StoreDto[];
  readonly onChange: (filters: SearchFilters) => void;
  /** El orden solo se ofrece donde se comparan precios, no en el listado. */
  readonly showSort?: boolean;
}

/**
 * Filtros de la búsqueda. Cambiarlos reescribe la URL, así que el estado vive en
 * un solo lugar. La ubicación es opcional: sin ella se listan precios igual, pero
 * sin distancias (no se inventan).
 */
export function SearchFiltersBar({ filters, stores, onChange, showSort = true }: Props) {
  const chainId = useId();
  const localityId = useId();
  const sortId = useId();
  const [geolocationError, setGeolocationError] = useState<string | null>(null);

  const chains = [...new Map(stores.map((store) => [store.chainId, store.chainName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], 'es-AR'),
  );
  const localities = [...new Map(stores.map((store) => [localityValue(store.city, store.province), store.city])).entries()]
    .filter(([value]) => value)
    .sort((a, b) => a[1].localeCompare(b[1], 'es-AR'));

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeolocationError('Tu navegador no comparte la ubicación. Elegí una localidad.');
      return;
    }
    setGeolocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          ...filters,
          city: null,
          province: null,
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
      },
      // Denegar el permiso es una respuesta válida: se sigue sin distancias.
      () => setGeolocationError('No pudimos acceder a tu ubicación. Podés elegir una localidad.'),
      { timeout: 8_000 },
    );
  }

  const usingCoordinates = filters.latitude !== null && filters.longitude !== null;

  return (
    <div className="filters-bar">
      <div className="field field-inline">
        <label htmlFor={chainId}>Cadena</label>
        <select
          id={chainId}
          value={filters.chainId ?? ''}
          onChange={(event) => onChange({ ...filters, chainId: event.target.value || null })}
        >
          <option value="">Todas</option>
          {chains.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="field field-inline">
        <label htmlFor={localityId}>Localidad</label>
        <select
          id={localityId}
          value={usingCoordinates ? '' : localityValue(filters.city, filters.province)}
          onChange={(event) =>
            onChange({
              ...filters,
              ...parseLocalityValue(event.target.value),
              latitude: null,
              longitude: null,
              sortBy: filters.sortBy === 'DISTANCE' ? 'UNIT_PRICE' : filters.sortBy,
            })
          }
        >
          <option value="">Todas</option>
          {localities.map(([value, city]) => (
            <option key={value} value={value}>
              {city}
            </option>
          ))}
        </select>
      </div>

      {showSort && (
      <div className="field field-inline">
        <label htmlFor={sortId}>Ordenar por</label>
        <select
          id={sortId}
          value={filters.sortBy}
          onChange={(event) => onChange({ ...filters, sortBy: event.target.value as SearchFilters['sortBy'] })}
        >
          <option value="UNIT_PRICE">Precio por kilo o litro</option>
          <option value="PRICE">Precio del envase</option>
          <option value="DISTANCE" disabled={!usingCoordinates}>
            Distancia {usingCoordinates ? '' : '(necesita tu ubicación)'}
          </option>
        </select>
      </div>
      )}

      <div className="filters-actions">
        {usingCoordinates ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onChange({
                ...filters,
                latitude: null,
                longitude: null,
                sortBy: filters.sortBy === 'DISTANCE' ? 'UNIT_PRICE' : filters.sortBy,
              })
            }
          >
            Quitar mi ubicación
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={useMyLocation}>
            Usar mi ubicación
          </button>
        )}
      </div>

      {geolocationError && (
        <p className="field-hint filters-hint" role="status">
          {geolocationError}
        </p>
      )}
      {usingCoordinates && (
        <p className="field-hint filters-hint">Mostrando sucursales a menos de 10 km de donde estás.</p>
      )}
    </div>
  );
}
