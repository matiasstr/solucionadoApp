'use client';

import { useQuery } from '@tanstack/react-query';
import type { UserProfile } from '@tusofertas/shared';
import { Surface } from '@tusofertas/ui';
import { useAuth } from '../../lib/auth/auth-provider';

const numberFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'America/Argentina/Buenos_Aires' });

export function AccountHome({ welcome = false }: { welcome?: boolean }) {
  const { state, authRequest } = useAuth();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  // La clave incluye el usuario: los datos privados nunca se comparten entre sesiones.
  const profile = useQuery({
    queryKey: ['me', userId],
    queryFn: () => authRequest<UserProfile>('/users/me'),
    enabled: Boolean(userId),
  });

  return (
    <div className="account-home">
      <p className="eyebrow"><span className="status-dot" /> {welcome ? 'CUENTA CREADA' : 'TU CUENTA'}</p>
      <h1 className="account-title">{welcome ? '¡Listo! Ya tenés tu cuenta.' : 'Hola de nuevo.'}</h1>
      <p className="hero-copy">
        Todavía estamos armando la parte principal: cargar lo que comprás, comparar precios y planificar tu semana.
        Te avisamos acá en cuanto esté disponible. Por ahora no hay precios ni planes para mostrar.
      </p>

      <div className="grid gap-5 md:grid-cols-2">
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
                <dt>Tiendas por compra</dt>
                <dd>{profile.data.maxStoresPerShoppingPlan ?? 'Sin límite'}</dd>
              </div>
              <div><dt>Ubicación</dt><dd>{profile.data.city ?? 'Sin cargar'}</dd></div>
            </dl>
          )}
        </Surface>
        <Surface className="account-card account-next">
          <h2>Lo que viene</h2>
          <ol>
            <li>Contanos qué comprás habitualmente y cuánto tenés en casa.</li>
            <li>Buscá productos y compará precios entre sucursales.</li>
            <li>Recibí un plan semanal con el ahorro estimado.</li>
          </ol>
          <p className="muted">Estas funciones todavía no están disponibles.</p>
        </Surface>
      </div>
    </div>
  );
}
