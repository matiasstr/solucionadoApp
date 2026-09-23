import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductView } from '../../../components/product/product-view';

export const metadata: Metadata = {
  title: 'Precios del producto · Tus Ofertas',
  description: 'Precio por sucursal, precio por kilo o litro y alternativas equivalentes.',
};

export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  // En Next 16 los params de una ruta dinámica son una promesa.
  const { id } = await params;
  return (
    <Suspense fallback={<p className="data-state" role="status">Cargando el producto…</p>}>
      <ProductView productId={id} />
    </Suspense>
  );
}
