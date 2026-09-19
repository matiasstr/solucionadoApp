import type { Metadata } from 'next';
import { AccountHome } from '../../../components/account/account-home';

export const metadata: Metadata = { title: 'Bienvenida · Tus Ofertas' };

// Onboarding pendiente (P4-02): pantalla honesta, sin rutinas ni ahorro inventados.
export default function BienvenidaPage() {
  return <AccountHome welcome />;
}
