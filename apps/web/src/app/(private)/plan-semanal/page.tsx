import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '../../../components/common/states';
import { PlanView } from '../../../components/plans/plan-view';

export const metadata: Metadata = { title: 'Plan semanal · Tus Ofertas' };

export default function PlanSemanalPage() {
  // El plan elegido vive en la URL (useSearchParams), que necesita un límite Suspense.
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
      <PlanView />
    </Suspense>
  );
}
