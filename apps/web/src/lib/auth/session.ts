import type { SessionResponse } from '@tusofertas/shared';
import { ApiError, apiRequest } from '../api';

let refreshInFlight: Promise<SessionResponse | null> | null = null;

/**
 * Única promesa de refresh compartida. La API revoca la sesión si recibe dos refresh
 * simultáneos con el mismo token (ADR 0003), así que nunca se disparan en paralelo:
 * StrictMode, varias pestañas del mismo componente o varios 401 reutilizan esta promesa.
 * Devuelve null si la sesión terminó (401/403).
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= apiRequest<SessionResponse>('/auth/refresh', { method: 'POST' })
    .catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

// Indicador sin secretos: evita pedir un refresh en cada visita de alguien que nunca inició
// sesión. No es un token ni prueba de sesión; la cookie HttpOnly sigue siendo la fuente.
const HINT_KEY = 'tusofertas:had-session';

export function hadSession(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}

export function rememberSession(active: boolean): void {
  try {
    if (active) window.localStorage.setItem(HINT_KEY, '1');
    else window.localStorage.removeItem(HINT_KEY);
  } catch {
    // Almacenamiento bloqueado: solo se pierde la optimización.
  }
}
