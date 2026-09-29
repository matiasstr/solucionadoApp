'use client';

import { Surface } from '@tusofertas/ui';
import Link from 'next/link';
import { useInventory, useProfile, useRoutines } from '../../lib/account/queries';

const numberFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'America/Argentina/Buenos_Aires' });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function AccountHome() {
  const profile = useProfile();
  const routines = useRoutines();
  const inventory = useInventory();
  const needs = routines.data?.items.reduce((total, routine) => total + routine.items.length, 0);
  const stock = inventory.data?.items.length;

  return (
    <div className="account-home">
      <p className="eyebrow"><span className="status-dot" /> TU CUENTA</p>
      <h1 className="account-title">Hola de nuevo.</h1>

      {profile.data && !profile.data.onboardingCompletedAt && (
        <div className="onboarding-banner" role="note">
          <div>
            <p className="onboarding-banner-title">Terminá de configurar tu cuenta</p>
            <p className="muted">Tu zona, hasta dónde vas y qué comprás seguido. Lleva un par de minutos.</p>
          </div>
          <Link className="primary-link" href="/onboarding">Continuar configuración</Link>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Surface className="account-card">
          <h2>Mis compras</h2>
          <p className="account-figure">
            {needs === undefined ? '…' : needs === 0 ? 'Todavía no cargaste productos' : plural(needs, 'producto habitual', 'productos habituales')}
          </p>
          <Link className="text-link" href="/mis-compras">{needs ? 'Ver y editar' : 'Cargar lo que comprás'}</Link>
        </Surface>
        <Surface className="account-card">
          <h2>Mi despensa</h2>
          <p className="account-figure">
            {stock === undefined ? '…' : stock === 0 ? 'Vacía' : plural(stock, 'producto en casa', 'productos en casa')}
          </p>
          <Link className="text-link" href="/mi-despensa">{stock ? 'Actualizar cantidades' : 'Cargar lo que tenés'}</Link>
        </Surface>
        <Surface className="account-card">
          <h2>Tus datos</h2>
          {profile.isPending && <p className="muted" role="status">Cargando…</p>}
          {profile.isError && <p className="field-error" role="alert">{profile.error.message}</p>}
          {profile.data && (
            <dl className="account-list">
              <div><dt>Email</dt><dd>{profile.data.email}</dd></div>
              <div><dt>Cuenta creada</dt><dd>{dateFormat.format(new Date(profile.data.createdAt))}</dd></div>
              <div><dt>Distancia máxima</dt><dd>{numberFormat.format(Number(profile.data.maxTravelDistanceKm))} km</dd></div>
              <div>
                <dt>Sucursales por compra</dt>
                <dd>{profile.data.maxStoresPerShoppingPlan ?? 'Sin límite'}</dd>
              </div>
              <div><dt>Zona</dt><dd>{profile.data.city ?? 'Sin cargar'}</dd></div>
            </dl>
          )}
          <p className="account-card-foot"><Link className="text-link" href="/preferencias">Cambiar preferencias</Link></p>
        </Surface>
        <Surface className="account-card account-next">
          <h2>Plan semanal</h2>
          <p className="muted">
            Con tus compras habituales, tu despensa y los últimos precios observados cerca tuyo armamos qué comprar,
            dónde y qué día, con el ahorro estimado.
          </p>
          <p className="account-card-foot">
            <Link className="text-link" href="/plan-semanal">Ver o generar tu plan</Link>
            {' · '}
            <Link className="text-link" href="/dashboard">Ver tu resumen</Link>
          </p>
        </Surface>
      </div>
    </div>
  );
}
