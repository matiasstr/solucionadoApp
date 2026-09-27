'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CanonicalProductDetailDto,
  CanonicalProductDto,
  CreateInventoryItemRequest,
  CreateRoutineItemRequest,
  CreateRoutineRequest,
  InventoryItemDto,
  InventoryListDto,
  InventoryQuantityRequest,
  PaginatedDto,
  RoutineDto,
  RoutineItemDto,
  RoutineItemFieldsRequest,
  RoutineListDto,
  UpdateProfileRequest,
  UpdateRoutineRequest,
  UserProfile,
} from '@tusofertas/shared';
import { apiRequest } from '../api';
import { useAuth } from '../auth/auth-provider';

/**
 * Datos privados de la cuenta (rutinas, despensa y preferencias). Las claves llevan el
 * id del usuario, así una sesión nunca ve la caché de otra, y el logout la vacía entera
 * (`queryClient.clear()` en AuthProvider). Toda mutación invalida lo que cambia.
 */

export const accountKeys = {
  profile: (userId: string | null) => ['me', userId] as const,
  routines: (userId: string | null) => ['routines', userId] as const,
  inventory: (userId: string | null) => ['inventory', userId] as const,
};

function useSessionUserId(): string | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.user.id : null;
}

export function useProfile() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: accountKeys.profile(userId),
    queryFn: () => authRequest<UserProfile>('/users/me'),
    enabled: Boolean(userId),
  });
}

export function useUpdateProfile() {
  const { authRequest, updateUser } = useAuth();
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => authRequest<UserProfile>('/users/me', { method: 'PATCH', body }),
    onSuccess: (profile) => {
      queryClient.setQueryData(accountKeys.profile(userId), profile);
      updateUser(profile);
    },
  });
}

export function useRoutines() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: accountKeys.routines(userId),
    queryFn: () => authRequest<RoutineListDto>('/shopping-routines'),
    enabled: Boolean(userId),
  });
}

export function useInventory() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: accountKeys.inventory(userId),
    queryFn: () => authRequest<InventoryListDto>('/inventory'),
    enabled: Boolean(userId),
  });
}

/** Mutación que, salga bien o mal, vuelve a traer la lista afectada (un 409 también la cambia). */
function useAccountMutation<TVariables, TResult>(
  key: 'routines' | 'inventory',
  request: (authRequest: ReturnType<typeof useAuth>['authRequest'], variables: TVariables) => Promise<TResult>,
) {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => request(authRequest, variables),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys[key](userId) }),
  });
}

export const useCreateRoutine = () =>
  useAccountMutation<CreateRoutineRequest, RoutineDto>('routines', (authRequest, body) =>
    authRequest('/shopping-routines', { method: 'POST', body }));

export const useUpdateRoutine = () =>
  useAccountMutation<{ routineId: string; body: UpdateRoutineRequest }, RoutineDto>('routines', (authRequest, { routineId, body }) =>
    authRequest(`/shopping-routines/${routineId}`, { method: 'PATCH', body }));

export const useDeleteRoutine = () =>
  useAccountMutation<string, void>('routines', (authRequest, routineId) =>
    authRequest(`/shopping-routines/${routineId}`, { method: 'DELETE' }));

export const useAddRoutineItem = () =>
  useAccountMutation<{ routineId: string; body: CreateRoutineItemRequest }, RoutineItemDto>('routines', (authRequest, { routineId, body }) =>
    authRequest(`/shopping-routines/${routineId}/items`, { method: 'POST', body }));

export const useUpdateRoutineItem = () =>
  useAccountMutation<{ routineId: string; itemId: string; body: RoutineItemFieldsRequest }, RoutineItemDto>(
    'routines',
    (authRequest, { routineId, itemId, body }) =>
      authRequest(`/shopping-routines/${routineId}/items/${itemId}`, { method: 'PATCH', body }),
  );

export const useDeleteRoutineItem = () =>
  useAccountMutation<{ routineId: string; itemId: string }, void>('routines', (authRequest, { routineId, itemId }) =>
    authRequest(`/shopping-routines/${routineId}/items/${itemId}`, { method: 'DELETE' }));

export const useAddInventoryItem = () =>
  useAccountMutation<CreateInventoryItemRequest, InventoryItemDto>('inventory', (authRequest, body) =>
    authRequest('/inventory', { method: 'POST', body }));

export const useUpdateInventoryItem = () =>
  useAccountMutation<{ id: string; body: InventoryQuantityRequest }, InventoryItemDto>('inventory', (authRequest, { id, body }) =>
    authRequest(`/inventory/${id}`, { method: 'PATCH', body }));

export const useDeleteInventoryItem = () =>
  useAccountMutation<string, void>('inventory', (authRequest, id) => authRequest(`/inventory/${id}`, { method: 'DELETE' }));

/**
 * Rutina que usa el onboarding: la primera que exista o una nueva. Antes de crear vuelve
 * a consultar la lista, así un reintento (o una respuesta que se perdió) no duplica rutinas.
 */
export function useEnsureRoutine() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<RoutineDto> => {
      const current = await authRequest<RoutineListDto>('/shopping-routines');
      return current.items[0] ?? authRequest<RoutineDto>('/shopping-routines', { method: 'POST', body: { name } });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.routines(userId) }),
  });
}

/** Buscador de necesidades (canónicos). Público: no depende de la sesión. */
export function useCanonicalSearch(term: string) {
  const search = term.trim();
  return useQuery({
    queryKey: ['canonical-products', 'search', search],
    enabled: search.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      apiRequest<PaginatedDto<CanonicalProductDto>>(
        `/canonical-products?${new URLSearchParams({ search, limit: '8' }).toString()}`,
        { signal },
      ),
  });
}

/** Presentaciones de un canónico, para elegir un preferido. Se pide solo cuando hace falta. */
export function useCanonicalDetail(canonicalProductId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['canonical-products', canonicalProductId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => apiRequest<CanonicalProductDetailDto>(`/canonical-products/${canonicalProductId}`, { signal }),
  });
}
