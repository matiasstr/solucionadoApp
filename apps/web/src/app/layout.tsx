import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tus Ofertas · Tus compras, mejor pensadas',
  description: 'Estamos preparando una forma más simple de comparar precios y planificar tus compras habituales en Argentina.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
