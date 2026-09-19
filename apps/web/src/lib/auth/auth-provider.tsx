'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { SessionResponse, UserProfile } from '@tusofertas/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from '../api';
import { hadSession, refreshSession, rememberSession } from './session';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; unavailable?: boolean }
  | { status: 'authenticated'; user: UserProfile };

interface Credentials {
  email: string;
  password: string;
}

interface AuthContextValue {
  state: AuthState;
  login(credentials: Credentials): Promise<UserProfile>;
  register(credentials: Credentials): Promise<UserProfile>;
  logout(): Promise<void>;
  /** Petición autenticada: ante 401 renueva una vez (promesa compartida) y reintenta una sola vez. */
  authRequest<T>(path: string, options?: { method?: 'GET' | 'PATCH' | 'POST'; body?: unknown }): Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const sessionEnded = () => new ApiError(401, 'SESSION_EXPIRED', 'Tu sesión terminó. Volvé a iniciar sesión.');

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // El access token vive solo en memoria: nunca en storage, cookies legibles ni URLs.
  const accessToken = useRef<string | null>(null);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const apply = useCallback((session: SessionResponse) => {
    accessToken.current = session.accessToken;
    rememberSession(true);
    setState((previous) => {
      // Cambió la persona: no reutilizar datos privados en caché.
      if (previous.status === 'authenticated' && previous.user.id !== session.user.id) queryClient.clear();
      return { status: 'authenticated', user: session.user };
    });
  }, [queryClient]);

  const clear = useCallback((unavailable = false) => {
    accessToken.current = null;
    if (!unavailable) rememberSession(false);
    queryClient.clear();
    setState({ status: 'anonymous', unavailable });
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    // Sin indicio de sesión previa no se consulta la API (visitantes anónimos).
    const restore = hadSession() ? refreshSession() : Promise.resolve(null);
    restore
      .then((session) => {
        if (!active) return;
        if (session) apply(session);
        else clear();
      })
      .catch(() => {
        if (active) clear(true);
      });
    return () => {
      active = false;
    };
  }, [apply, clear]);

  const login = useCallback(async (credentials: Credentials) => {
    const session = await apiRequest<SessionResponse>('/auth/login', { method: 'POST', body: credentials });
    queryClient.clear();
    apply(session);
    return session.user;
  }, [apply, queryClient]);

  const register = useCallback(async (credentials: Credentials) => {
    const session = await apiRequest<SessionResponse>('/auth/register', { method: 'POST', body: credentials });
    queryClient.clear();
    apply(session);
    return session.user;
  }, [apply, queryClient]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Aun sin respuesta del servidor, el estado local se limpia.
    } finally {
      clear();
    }
  }, [clear]);

  const authRequest = useCallback(async <T,>(path: string, options: { method?: 'GET' | 'PATCH' | 'POST'; body?: unknown } = {}) => {
    const token = accessToken.current;
    if (!token) throw sessionEnded();
    try {
      return await apiRequest<T>(path, { ...options, accessToken: token });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const session = await refreshSession().catch(() => null);
      if (!session) {
        clear();
        throw sessionEnded();
      }
      apply(session);
      return apiRequest<T>(path, { ...options, accessToken: session.accessToken });
    }
  }, [apply, clear]);

  const value = useMemo(
    () => ({ state, login, register, logout, authRequest }),
    [state, login, register, logout, authRequest],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
