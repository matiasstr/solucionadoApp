import type { Metadata } from 'next';
import { InventoryView } from '../../../components/inventory/inventory-view';

export const metadata: Metadata = { title: 'Mi despensa · Tus Ofertas' };

export default function MiDespensaPage() {
  return <InventoryView />;
}
