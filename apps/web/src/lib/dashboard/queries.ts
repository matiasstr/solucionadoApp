'use client';

import { useQuery } from '@tanstack/react-query';
import type { DashboardDto } from '@tusofertas/shared';
import { useAuth } from '../auth/auth-provider';

/** Clave por usuario, como el resto de la cuenta; los cambios de plan la invalidan. */
export const dashboardKey = (userId: string | null) => ['dashboard', userId] as const;

export function useDashboard() {
  const { authRequest, state } = useAuth();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  return useQuery({
    queryKey: dashboardKey(userId),
    queryFn: () => authRequest<DashboardDto>('/dashboard'),
    enabled: Boolean(userId),
  });
}
