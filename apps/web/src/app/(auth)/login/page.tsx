import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm, AuthFormFallback } from '../../../components/auth/auth-form';

export const metadata: Metadata = { title: 'Ingresar · Tus Ofertas', robots: { index: false } };

export default function LoginPage() {
  // useSearchParams (?next=) requiere un límite Suspense para no bloquear el prerender.
  return <Suspense fallback={<AuthFormFallback />}><AuthForm mode="login" /></Suspense>;
}
