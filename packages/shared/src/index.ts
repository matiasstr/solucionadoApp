/** Importes decimales transportados como texto; el cálculo ocurre en el dominio. */
export type DecimalString = string;

export interface MoneyDto {
  amount: DecimalString;
  currency: 'ARS';
}

/** Contrato público: nunca agregar hashes, tokens ni entidades Prisma. */
export interface HealthResponse {
  status: 'ok';
  service: string;
}

export type PaymentMethod = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'TRANSFER' | 'WALLET';

/** Perfil público (GET /api/users/me). Decimales como texto. */
export interface UserProfile {
  id: string;
  email: string;
  city: string | null;
  province: string | null;
  latitude: DecimalString | null;
  longitude: DecimalString | null;
  maxTravelDistanceKm: DecimalString;
  maxStoresPerShoppingPlan: number | null;
  storeVisitPenalty: DecimalString;
  distancePenaltyPerKm: DecimalString;
  paymentMethods: PaymentMethod[];
  banks: string[];
  membershipPrograms: string[];
  onboardingCompletedAt: string | null;
  createdAt: string;
}

/** Respuesta de register/login/refresh. El refresh token viaja solo en cookie HttpOnly. */
export interface SessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserProfile;
}

/** Cuerpo de error público de la API. `fields` nombra propiedades, nunca valores. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  fields?: string[];
}
