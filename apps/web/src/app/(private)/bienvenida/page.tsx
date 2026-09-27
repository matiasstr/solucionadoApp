import { redirect } from 'next/navigation';

// La bienvenida de P1-04 pasó a ser el onboarding (P4-02); se conserva la ruta por enlaces viejos.
export default function BienvenidaPage() {
  redirect('/onboarding');
}
