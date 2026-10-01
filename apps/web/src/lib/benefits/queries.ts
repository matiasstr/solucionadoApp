'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BenefitUsageListDto,
  InformBenefitUsageRequest,
  InformedBenefitUsageDto,
  PaginatedDto,
  PromotionDto,
} from '@tusofertas/shared';
import { apiRequest } from '../api';
import { useAuth } from '../auth/auth-provider';

/**
 * Beneficios de pago (P10-02, API de P10-01): promociones con tope que se arrastra entre
 * compras y lo que la persona informa como ya usado fuera de la app. Claves por usuario.
 */
export const benefitKeys = {
  usage: (userId: string | null) => ['benefit-usage', userId] as const,
  conditioned: ['promotions', 'conditioned'] as const,
};

/** Páginas de `GET /promotions` que se recorren como máximo (50 por página). */
const MAX_PAGES = 6;

function useSessionUserId(): string | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.user.id : null;
}

/** Un tope se arrastra entre compras si es por semana, mes o campaña (el de una compra no se informa). */
export const hasTrackableCap = (promotion: PromotionDto): boolean =>
  Boolean(promotion.conditions.discountCap) &&
  (promotion.conditions.capPeriod === 'WEEK' || promotion.conditions.capPeriod === 'MONTH' || promotion.conditions.capPeriod === 'CAMPAIGN');

/** Clave del tope tal como la guarda la API: el grupo compartido o la promoción sola. */
export const capKeyOf = (promotion: PromotionDto): string =>
  promotion.conditions.capGroup ? `group:${promotion.conditions.capGroup}` : `promotion:${promotion.id}`;

/** Depende de algo de la persona: banco, medio, membresía o un tope que se arrastra entre compras. */
const isConditioned = (promotion: PromotionDto): boolean =>
  promotion.type === 'BANK_DISCOUNT' ||
  Boolean(promotion.conditions.bank || promotion.conditions.paymentMethod || promotion.conditions.membershipProgram) ||
  hasTrackableCap(promotion);

/** Promociones vigentes que dependen de la persona (públicas): sugerencias de bancos y topes informables. */
export function useConditionedPromotions() {
  return useQuery({
    queryKey: benefitKeys.conditioned,
    queryFn: async ({ signal }) => {
      const found: PromotionDto[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({ limit: '50' });
        if (cursor) query.set('cursor', cursor);
        const result: PaginatedDto<PromotionDto> = await apiRequest(`/promotions?${query}`, { signal });
        found.push(...result.items.filter(isConditioned));
        cursor = result.page.nextCursor;
        if (!cursor) break;
      }
      return found;
    },
    staleTime: 5 * 60_000,
  });
}

export function useBenefitUsage() {
  const { authRequest } = useAuth();
  const userId = useSessionUserId();
  return useQuery({
    queryKey: benefitKeys.usage(userId),
    queryFn: () => authRequest<BenefitUsageListDto>('/benefit-usage'),
    enabled: Boolean(userId),
  });
}

function useInvalidateUsage() {
  const userId = useSessionUserId();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: benefitKeys.usage(userId) });
}

export function useInformUsage() {
  const { authRequest } = useAuth();
  const invalidate = useInvalidateUsage();
  return useMutation({
    mutationFn: ({ promotionId, body }: { promotionId: string; body: InformBenefitUsageRequest }) =>
      authRequest<InformedBenefitUsageDto>(`/benefit-usage/${promotionId}`, { method: 'PUT', body }),
    onSettled: invalidate,
  });
}

export function useForgetUsage() {
  const { authRequest } = useAuth();
  const invalidate = useInvalidateUsage();
  return useMutation({
    mutationFn: (promotionId: string) => authRequest<void>(`/benefit-usage/${promotionId}`, { method: 'DELETE' }),
    onSettled: invalidate,
  });
}
