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

/**
 * Catálogo y precios (P2-02). Refleja los contratos de la API, que viven en los
 * archivos `contracts.ts` de cada módulo: si cambia uno, cambia el otro.
 * Decimales como texto y fechas ISO 8601 en UTC.
 */
export type BaseUnit = 'KG' | 'L' | 'UNIT';
export type MeasurementUnit = 'KG' | 'G' | 'L' | 'ML' | 'UNIT';
export type SaleMode = 'PACKAGED' | 'VARIABLE_WEIGHT';

/** Página por cursor: `nextCursor` es opaco y null cuando no hay más resultados. */
export interface PaginatedDto<T> {
  items: T[];
  page: { limit: number; nextCursor: string | null };
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface CanonicalProductDto {
  id: string;
  name: string;
  categoryId: string;
  defaultUnit: BaseUnit;
}

export interface ProductDto {
  id: string;
  ean: string | null;
  name: string;
  brand: string | null;
  categoryId: string;
  canonicalProductId: string | null;
  /** Contenido total del paquete o base de cotización para venta por peso. */
  quantity: DecimalString;
  unit: MeasurementUnit;
  saleMode: SaleMode;
  packageCount: number;
}

export interface ProductDetailDto extends ProductDto {
  category: CategoryDto;
  canonicalProduct: CanonicalProductDto | null;
}

export interface CanonicalProductDetailDto extends CanonicalProductDto {
  category: CategoryDto;
  /** Alternativas aceptables; no son el mismo producto exacto. */
  products: ProductDto[];
}

export interface StoreDto {
  id: string;
  chainId: string;
  chainName: string;
  name: string;
  address: string;
  city: string;
  province: string;
  latitude: DecimalString | null;
  longitude: DecimalString | null;
  /** Solo cuando la consulta llevó coordenadas y la sucursal las tiene. */
  distanceMeters: number | null;
}

export interface PriceFreshnessDto {
  observedAt: string;
  ageDays: number;
  maxAgeDays: number;
  /** Precio viejo: mostrarlo con su fecha, nunca como disponibilidad garantizada. */
  isStale: boolean;
}

export interface StorePriceDto {
  store: StoreDto;
  price: DecimalString;
  currency: string;
  unitPrice: DecimalString;
  unitPriceUnit: BaseUnit;
  unitPricePer100g: DecimalString | null;
  source: string;
  freshness: PriceFreshnessDto;
}

export type PriceScopeOrigin = 'COORDINATES' | 'LOCALITY' | 'ALL';

export interface PriceScopeDto {
  origin: PriceScopeOrigin;
  radiusKm: number | null;
  distancesAvailable: boolean;
  storesConsidered: number;
  maxAgeDays: number;
  includeStale: boolean;
}

export interface ProductPricesDto {
  product: ProductDto;
  scope: PriceScopeDto;
  /** Un precio actual por sucursal, del más barato por unidad base al más caro. */
  prices: StorePriceDto[];
}
