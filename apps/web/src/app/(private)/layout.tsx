import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PrivateShell } from '../../components/auth/private-shell';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return <PrivateShell>{children}</PrivateShell>;
}
