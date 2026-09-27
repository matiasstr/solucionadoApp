import type { Metadata } from 'next';
import { PreferencesView } from '../../../components/preferences/preferences-view';

export const metadata: Metadata = { title: 'Preferencias · Tus Ofertas' };

export default function PreferenciasPage() {
  return <PreferencesView />;
}
