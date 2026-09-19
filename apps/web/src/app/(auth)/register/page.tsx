import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm, AuthFormFallback } from '../../../components/auth/auth-form';

export const metadata: Metadata = { title: 'Crear cuenta · Tus Ofertas', robots: { index: false } };

export default function RegisterPage() {
  return <Suspense fallback={<AuthFormFallback />}><AuthForm mode="register" /></Suspense>;
}
