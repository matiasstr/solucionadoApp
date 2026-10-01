'use client';

import type { UserProfile } from '@tusofertas/shared';
import { useState, type FormEvent } from 'react';
import { useProfile, useUpdateProfile } from '../../lib/account/queries';
import { apiFieldErrors, type FieldErrors } from '../../lib/account/quantities';
import { FormAlert } from '../account/form-parts';
import { ErrorState, LoadingState } from '../common/states';
import { CapUsageSection } from './cap-usage';
import { PaymentFields, paymentFromProfile, paymentRequest } from './payment-fields';
import {
  LocationFields,
  locationFromProfile,
  locationRequest,
  normalizeKm,
  RadiusChoice,
  StoresChoice,
} from './preference-fields';

const PROFILE_FIELDS = [
  'city', 'province', 'latitude', 'longitude', 'maxTravelDistanceKm', 'maxStoresPerShoppingPlan',
  'paymentMethods', 'banks', 'membershipPrograms',
] as const;

export function PreferencesView() {
  const profile = useProfile();
  return (
    <div className="account-page">
      <p className="eyebrow"><span className="status-dot" /> PREFERENCIAS</p>
      <h1 className="page-title">Dónde y cómo comprás</h1>
      <p className="page-lead">Con esto acotamos las comparaciones y armamos tu plan de compra.</p>
      {profile.isPending && <LoadingState label="Cargando tus preferencias…" />}
      {profile.isError && <ErrorState message={profile.error.message} onRetry={() => profile.refetch()} />}
      {profile.data && <PreferencesForm profile={profile.data} />}
      {profile.data && <CapUsageSection />}
    </div>
  );
}

function PreferencesForm({ profile }: { profile: UserProfile }) {
  const update = useUpdateProfile();
  const [location, setLocation] = useState(() => locationFromProfile(profile));
  const [radius, setRadius] = useState(() => normalizeKm(profile.maxTravelDistanceKm));
  const [stores, setStores] = useState(profile.maxStoresPerShoppingPlan);
  const [payment, setPayment] = useState(() => paymentFromProfile(profile));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = () => {
    setSaved(false);
    setErrors({});
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const request = locationRequest(location);
    if ('errors' in request) return setErrors(request.errors);
    try {
      await update.mutateAsync({
        ...request.body,
        maxTravelDistanceKm: radius,
        maxStoresPerShoppingPlan: stores,
        ...paymentRequest(payment),
      });
      setSaved(true);
    } catch (error) {
      const mapped = apiFieldErrors(error, PROFILE_FIELDS);
      setErrors(mapped.fields);
      setFormError(mapped.general);
    }
  }

  return (
    <form className="preferences-form surface" noValidate onSubmit={submit} aria-busy={update.isPending}>
      <FormAlert message={formError} />
      <section aria-labelledby="pref-location">
        <h2 id="pref-location" className="subsection-title">Tu zona</h2>
        <LocationFields value={location} onChange={(value) => { setLocation(value); changed(); }} errors={errors} />
      </section>
      <RadiusChoice value={radius} onChange={(value) => { setRadius(value); changed(); }} error={errors.maxTravelDistanceKm} />
      <StoresChoice value={stores} onChange={(value) => { setStores(value); changed(); }} error={errors.maxStoresPerShoppingPlan} />
      <section aria-labelledby="pref-payment" id="medios-de-pago" className="payment-section">
        <h2 id="pref-payment" className="subsection-title">Medios de pago</h2>
        <p className="field-hint">
          Lo usamos para saber qué descuentos y reintegros de bancos te corresponden. No pedimos números de tarjeta ni
          datos de tu banco. Lo que no declares queda como &quot;depende de un dato tuyo&quot; y no se suma al plan.
        </p>
        <PaymentFields value={payment} onChange={(value) => { setPayment(value); changed(); }} errors={errors} />
      </section>
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={update.isPending}>
          {update.isPending ? 'Guardando…' : 'Guardar preferencias'}
        </button>
        <p className="success-note" role="status">{saved ? 'Guardamos tus preferencias.' : ''}</p>
      </div>
    </form>
  );
}
