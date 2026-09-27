'use client';

import type { UpdateProfileRequest, UserProfile } from '@tusofertas/shared';
import { useId, useMemo, useState } from 'react';
import { useStores } from '../../lib/catalog/queries';
import { describedBy, FieldError } from '../account/form-parts';

/**
 * Preferencias de compra editables en el onboarding y en /preferencias. Cada bloque
 * recibe su valor y avisa cambios; quien lo usa decide cuándo guardar (PATCH /users/me).
 */

export const PROVINCES = [
  'Ciudad Autónoma de Buenos Aires', 'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro',
  'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero',
  'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'Tucumán',
] as const;

export interface LocationValue {
  city: string;
  province: string;
  latitude: string | null;
  longitude: string | null;
}

export const locationFromProfile = (profile: UserProfile): LocationValue => ({
  city: profile.city ?? '',
  province: profile.province ?? '',
  latitude: profile.latitude,
  longitude: profile.longitude,
});

/**
 * Cuerpo del PATCH para la ubicación, o los campos con error. Localidad y provincia
 * van juntas (vacías las dos = borrarla); las coordenadas también.
 */
export function locationRequest(value: LocationValue): { body: UpdateProfileRequest } | { errors: Record<string, string> } {
  const city = value.city.trim();
  const province = value.province.trim();
  if (Boolean(city) !== Boolean(province)) {
    return { errors: city ? { province: 'Elegí la provincia.' } : { city: 'Escribí tu localidad o barrio.' } };
  }
  return {
    body: {
      city: city || null,
      province: province || null,
      latitude: value.latitude,
      longitude: value.longitude,
    },
  };
}

type GeoStatus = 'idle' | 'asking' | 'denied' | 'unavailable';

export function LocationFields({
  value,
  onChange,
  errors,
}: {
  value: LocationValue;
  onChange(value: LocationValue): void;
  errors: Partial<Record<string, string>>;
}) {
  const id = useId();
  const stores = useStores();
  const [geo, setGeo] = useState<GeoStatus>('idle');
  // Localidades con sucursales cargadas: sugerencias, no una lista cerrada.
  const suggestions = useMemo(
    () => [...new Set((stores.data?.items ?? []).map((store) => store.city))].sort((a, b) => a.localeCompare(b, 'es')),
    [stores.data],
  );
  const hasCoordinates = value.latitude !== null && value.longitude !== null;

  // La ubicación precisa se pide solo cuando la persona toca el botón, nunca al cargar.
  function requestLocation() {
    if (!('geolocation' in navigator)) return setGeo('unavailable');
    setGeo('asking');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeo('idle');
        // Cuatro decimales (unos 10 m) alcanzan para calcular distancias a sucursales.
        onChange({ ...value, latitude: position.coords.latitude.toFixed(4), longitude: position.coords.longitude.toFixed(4) });
      },
      (error) => setGeo(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  }

  return (
    <div className="preference-block">
      <div className="location-fields">
        <div className="field">
          <label htmlFor={`${id}-city`}>Localidad o barrio</label>
          <input
            id={`${id}-city`}
            name="city"
            list={`${id}-cities`}
            autoComplete="address-level2"
            value={value.city}
            maxLength={120}
            onChange={(event) => onChange({ ...value, city: event.target.value })}
            aria-invalid={Boolean(errors.city)}
            aria-describedby={describedBy(errors.city && `${id}-city-error`)}
          />
          <datalist id={`${id}-cities`}>
            {suggestions.map((city) => <option key={city} value={city} />)}
          </datalist>
          <FieldError id={`${id}-city-error`} message={errors.city} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-province`}>Provincia</label>
          <select
            id={`${id}-province`}
            name="province"
            value={value.province}
            onChange={(event) => onChange({ ...value, province: event.target.value })}
            aria-invalid={Boolean(errors.province)}
            aria-describedby={describedBy(errors.province && `${id}-province-error`)}
          >
            <option value="">Elegí una provincia</option>
            {value.province && !(PROVINCES as readonly string[]).includes(value.province) && (
              <option value={value.province}>{value.province}</option>
            )}
            {PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}
          </select>
          <FieldError id={`${id}-province-error`} message={errors.province} />
        </div>
      </div>

      <div className="geo-box">
        <p className="geo-title">Ubicación exacta <span className="muted">(opcional)</span></p>
        <p className="field-hint">
          Sirve para calcular distancias a cada sucursal. Si no la compartís, usamos tu localidad.
        </p>
        {hasCoordinates ? (
          <div className="geo-actions">
            <p className="success-note" role="status">Ubicación guardada para calcular distancias.</p>
            <button type="button" className="link-button" onClick={() => onChange({ ...value, latitude: null, longitude: null })}>
              Quitar ubicación
            </button>
          </div>
        ) : (
          <div className="geo-actions">
            <button type="button" className="secondary-button" onClick={requestLocation} disabled={geo === 'asking'}>
              {geo === 'asking' ? 'Obteniendo ubicación…' : 'Usar mi ubicación actual'}
            </button>
            <p className="field-hint" role="status">
              {geo === 'denied' && 'No diste permiso para ver tu ubicación. Podés seguir con tu localidad.'}
              {geo === 'unavailable' && 'No pudimos obtener tu ubicación. Podés seguir con tu localidad.'}
            </p>
          </div>
        )}
        <FieldError id={`${id}-coordinates-error`} message={errors.latitude ?? errors.longitude} />
      </div>
    </div>
  );
}

/** Grupo de opciones como botones de radio. Si el valor guardado no es una opción, se agrega. */
function ChoiceGroup<T extends string | number | null>({
  legend,
  hint,
  name,
  options,
  value,
  onChange,
  error,
  formatOther,
}: {
  legend: string;
  hint?: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
  error?: string;
  /** Etiqueta de un valor guardado que no está entre las opciones (cargado en otro lado). */
  formatOther(value: T): string;
}) {
  const id = useId();
  const all = options.some((option) => option.value === value)
    ? options
    : [...options, { value, label: `${formatOther(value)} (actual)` }];
  return (
    <fieldset className="choice-group" aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}>
      <legend>{legend}</legend>
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
      <div className="choice-options">
        {all.map((option) => (
          <label key={String(option.value)} className="choice-option">
            <input
              type="radio"
              name={`${id}-${name}`}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  );
}

const RADIUS_OPTIONS = ['2', '5', '10', '20'].map((km) => ({ value: km, label: `${km} km` }));

/** El radio llega como decimal ("5.00" o "5"): se compara sin ceros sobrantes. */
export const normalizeKm = (value: string): string => String(Number(value));

export function RadiusChoice({ value, onChange, error }: { value: string; onChange(value: string): void; error?: string }) {
  return (
    <ChoiceGroup
      legend="¿Hasta qué distancia estás dispuesto a ir?"
      hint="Las sucursales más lejanas no entran en tus comparaciones ni en el plan."
      name="radius"
      options={RADIUS_OPTIONS}
      value={normalizeKm(value)}
      onChange={onChange}
      error={error}
      formatOther={(km) => `${km.replace('.', ',')} km`}
    />
  );
}

const STORE_OPTIONS: { value: number | null; label: string }[] = [
  { value: 1, label: '1 sucursal' },
  { value: 2, label: '2 sucursales' },
  { value: 3, label: '3 sucursales' },
  { value: null, label: 'Sin límite' },
];

export function StoresChoice({
  value,
  onChange,
  error,
}: {
  value: number | null;
  onChange(value: number | null): void;
  error?: string;
}) {
  return (
    <ChoiceGroup
      legend="¿En cuántas sucursales querés hacer cada compra?"
      hint="Más sucursales pueden ahorrar más, pero implican más viajes."
      name="stores"
      options={STORE_OPTIONS}
      value={value}
      onChange={onChange}
      error={error}
      formatOther={(count) => `${count} sucursales`}
    />
  );
}
