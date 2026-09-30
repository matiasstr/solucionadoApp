'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePriceAlertRequest,
  NotificationDto,
  NotificationPageDto,
  PriceAlertDto,
  PriceAlertListDto,
  UpdatePriceAlertRequest,
} from '@tusofertas/shared';
import { useAuth } from '../auth/auth-provider';

/**
 * Alertas y bandeja (P9-02, API de P9-01). Claves por usuario, como el resto de la cuenta;
 * cualquier cambio invalida la familia entera (una alerta borrada deja sus avisos sin regla).
 */
export const alertKeys = {
  all: (userId: string | null) => ['alerts', userId] as const,
  list: (userId: string | null) => ['alerts', userId, 'list'] as const,
  notifications: (userId: string | null, unreadOnly: boolean) => ['alerts', userId, 'notifications', unreadOnly] as const,
  unread: (userId: string | null) => ['alerts', userId, 'unread'] as const,
};

const PAGE_SIZE = 20;

function useSessionUserId(): string | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.user.id : null;
}

export function useAlerts() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: alertKeys.list(userId),
    queryFn: () => authRequest<PriceAlertListDto>('/alerts'),
    enabled: Boolean(userId),
  });
}

function useInvalidateAlerts() {
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: alertKeys.all(userId) });
}

export function useCreateAlert() {
  const { authRequest } = useAuth();
  const invalidate = useInvalidateAlerts();
  return useMutation({
    mutationFn: (body: CreatePriceAlertRequest) => authRequest<PriceAlertDto>('/alerts', { method: 'POST', body }),
    onSettled: invalidate,
  });
}

export function useUpdateAlert() {
  const { authRequest } = useAuth();
  const invalidate = useInvalidateAlerts();
  return useMutation({
    mutationFn: ({ alertId, body }: { alertId: string; body: UpdatePriceAlertRequest }) =>
      authRequest<PriceAlertDto>(`/alerts/${alertId}`, { method: 'PATCH', body }),
    onSettled: invalidate,
  });
}

export function useDeleteAlert() {
  const { authRequest } = useAuth();
  const invalidate = useInvalidateAlerts();
  return useMutation({
    mutationFn: (alertId: string) => authRequest<void>(`/alerts/${alertId}`, { method: 'DELETE' }),
    onSettled: invalidate,
  });
}

/** Bandeja paginada por cursor: "Ver más" pide la página siguiente. */
export function useNotifications(unreadOnly: boolean) {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useInfiniteQuery({
    queryKey: alertKeys.notifications(userId, unreadOnly),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (unreadOnly) params.set('unread', 'true');
      if (pageParam) params.set('cursor', pageParam);
      return authRequest<NotificationPageDto>(`/notifications?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.nextCursor,
    enabled: Boolean(userId),
  });
}

/** Contador de no leídos y los últimos avisos, para el menú y el resumen. */
export function useLatestNotifications(limit = 3) {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: [...alertKeys.unread(userId), limit],
    queryFn: () => authRequest<NotificationPageDto>(`/notifications?limit=${limit}`),
    enabled: Boolean(userId),
  });
}

export function useMarkNotificationRead() {
  const { authRequest } = useAuth();
  const invalidate = useInvalidateAlerts();
  return useMutation({
    mutationFn: (notificationId: string) => authRequest<NotificationDto>(`/notifications/${notificationId}/read`, { method: 'PATCH' }),
    onSettled: invalidate,
  });
}
