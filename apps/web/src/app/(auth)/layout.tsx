import { Brand } from '@tusofertas/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <a className="skip-link" href="#contenido">Ir al contenido</a>
      <header className="site-header mx-auto flex max-w-6xl items-center justify-between px-6">
        <Link href="/" className="brand-link"><Brand /></Link>
        <Link className="nav-link" href="/">Volver al inicio</Link>
      </header>
      <main id="contenido" className="auth-main">{children}</main>
    </div>
  );
}
