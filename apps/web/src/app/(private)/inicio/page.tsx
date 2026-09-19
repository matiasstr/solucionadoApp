import type { Metadata } from 'next';
import { AccountHome } from '../../../components/account/account-home';

export const metadata: Metadata = { title: 'Tu cuenta · Tus Ofertas' };

export default function InicioPage() {
  return <AccountHome />;
}
