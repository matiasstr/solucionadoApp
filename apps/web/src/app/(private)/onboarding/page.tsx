import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingView } from '../../../components/onboarding/onboarding-view';
import { LoadingState } from '../../../components/common/states';

export const metadata: Metadata = { title: 'Configurá tu cuenta · Tus Ofertas' };

export default function OnboardingPage() {
  // El paso vive en la URL (useSearchParams), que necesita un límite Suspense.
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
      <OnboardingView />
    </Suspense>
  );
}
