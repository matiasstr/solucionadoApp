import type { PaymentMethod, User } from '../../generated/prisma/client';

/** Vista pública del usuario. Nunca incluye passwordHash, sesiones ni campos internos. */
export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly city: string | null;
  readonly province: string | null;
  /** Decimales como string (ADR 0002). */
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly maxTravelDistanceKm: string;
  readonly maxStoresPerShoppingPlan: number | null;
  readonly storeVisitPenalty: string;
  readonly distancePenaltyPerKm: string;
  readonly paymentMethods: readonly PaymentMethod[];
  readonly banks: readonly string[];
  readonly membershipPrograms: readonly string[];
  readonly onboardingCompletedAt: string | null;
  readonly createdAt: string;
}

export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    city: user.city,
    province: user.province,
    latitude: user.latitude?.toString() ?? null,
    longitude: user.longitude?.toString() ?? null,
    maxTravelDistanceKm: user.maxTravelDistanceKm.toString(),
    maxStoresPerShoppingPlan: user.maxStoresPerShoppingPlan,
    storeVisitPenalty: user.storeVisitPenalty.toString(),
    distancePenaltyPerKm: user.distancePenaltyPerKm.toString(),
    paymentMethods: user.paymentMethods,
    banks: user.banks,
    membershipPrograms: user.membershipPrograms,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
