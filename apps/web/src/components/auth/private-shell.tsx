'use client';

import { Brand } from '@tusofertas/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth/auth-provider';

/**
 * Límite de navegación privada. Solo evita mostrar pantallas sin sesión: la autorización
 * real la hace la API en cada pedido.
 */
export function PrivateShell({ children }: { children: ReactNode }) {
  const { state, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (state.status === 'anonymous' && !leaving) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, leaving, router, pathname]);

  async function onLogout() {
    setLeaving(true);
    await logout();
    router.replace('/');
  }

  if (state.status !== 'authenticated') {
    return (
      <div className="private-loading" role="status" aria-live="polite">
        {state.status === 'anonymous' && state.unavailable
          ? 'No pudimos conectar con el servicio. Probá de nuevo en unos minutos.'
          : 'Cargando tu sesión…'}
      </div>
    );
  }

  return (
    <div className="private-shell">
      <a className="skip-link" href="#contenido">Ir al contenido</a>
      <header className="private-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6">
          <Link href="/inicio" className="brand-link"><Brand /></Link>
          <div className="private-user">
            <span className="private-email" title={state.user.email}>{state.user.email}</span>
            <button type="button" className="secondary-button" onClick={onLogout} disabled={leaving}>
              {leaving ? 'Saliendo…' : 'Cerrar sesión'}
            </button>
          </div>
        </div>
      </header>
      <main id="contenido" className="private-main mx-auto max-w-6xl px-6">{children}</main>
    </div>
  );
}
