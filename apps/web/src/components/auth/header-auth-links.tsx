'use client';

import Link from 'next/link';
import { useAuth } from '../../lib/auth/auth-provider';

export function HeaderAuthLinks() {
  const { state } = useAuth();
  return (
    <nav className="header-nav" aria-label="Principal">
      <a className="nav-link nav-optional" href="#como-funciona">Cómo funciona</a>
      {state.status === 'authenticated' ? (
        <Link className="nav-button" href="/inicio">Mi cuenta</Link>
      ) : (
        <>
          <Link className="nav-link" href="/login">Ingresar</Link>
          <Link className="nav-button" href="/register">Crear cuenta</Link>
        </>
      )}
    </nav>
  );
}
