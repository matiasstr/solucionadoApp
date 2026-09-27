import type { Metadata } from 'next';
import { RoutinesView } from '../../../components/routines/routines-view';

export const metadata: Metadata = { title: 'Mis compras · Tus Ofertas' };

export default function MisComprasPage() {
  return <RoutinesView />;
}
