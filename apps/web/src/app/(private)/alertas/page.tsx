import type { Metadata } from 'next';
import { AlertsView } from '../../../components/alerts/alerts-view';

export const metadata: Metadata = { title: 'Alertas · Tus Ofertas' };

export default function AlertasPage() {
  return <AlertsView />;
}
