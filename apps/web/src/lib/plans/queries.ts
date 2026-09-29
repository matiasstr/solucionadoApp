'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GeneratePlanRequest,
  ShoppingPlanDto,
  ShoppingPlanListDto,
  UpdatePlanStatusRequest,
} from '@tusofertas/shared';
import { useAuth } from '../auth/auth-provider';
import { dashboardKey } from '../dashboard/queries';

/**
 * Planes guardados. Las claves llevan el id del usuario (como el resto de la cuenta)
 * y cualquier cambio invalida la familia entera: activar un plan puede devolver otro
 * a borrador.
 */
export const planKeys = {
  all: (userId: string | null) => ['plans', userId] as const,
  list: (userId: string | null) => ['plans', userId, 'list'] as const,
  detail: (userId: string | null, planId: string | null) => ['plans', userId, 'detail', planId] as const,
};

function useSessionUserId(): string | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.user.id : null;
}

export function usePlans() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: planKeys.list(userId),
    queryFn: () => authRequest<ShoppingPlanListDto>('/shopping-plans?limit=10'),
    enabled: Boolean(userId),
  });
}

export function usePlan(planId: string | null) {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: planKeys.detail(userId, planId),
    queryFn: () => authRequest<ShoppingPlanDto>(`/shopping-plans/${planId}`),
    enabled: Boolean(userId && planId),
  });
}

/**
 * Generar un plan. La clave idempotente la decide quien llama y la reutiliza al
 * reintentar: si la respuesta se perdió, la API devuelve el plan ya guardado.
 */
export function useGeneratePlan() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, body = {} }: { idempotencyKey: string; body?: GeneratePlanRequest }) =>
      authRequest<ShoppingPlanDto>('/shopping-plans/generate', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: (plan) => queryClient.setQueryData(planKeys.detail(userId, plan.id), plan),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: planKeys.list(userId) });
      await queryClient.invalidateQueries({ queryKey: dashboardKey(userId) });
    },
  });
}

export function useUpdatePlanStatus() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: UpdatePlanStatusRequest }) =>
      authRequest<ShoppingPlanDto>(`/shopping-plans/${planId}`, { method: 'PATCH', body }),
    onSuccess: (plan) => queryClient.setQueryData(planKeys.detail(userId, plan.id), plan),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: planKeys.all(userId) });
      await queryClient.invalidateQueries({ queryKey: dashboardKey(userId) });
    },
  });
}
