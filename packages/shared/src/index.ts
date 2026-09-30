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
  sortBy: PriceSortBy;
  /** Un precio actual por sucursal, del más barato por unidad base al más caro. */
  prices: StorePriceDto[];
}

/** Promociones simples (P2-03). Refleja los contratos del módulo `promotions`. */
export type PromotionType = 'PERCENTAGE' | 'SECOND_UNIT' | 'TWO_FOR_ONE' | 'FIXED_PRICE' | 'BANK_DISCOUNT';
export type DiscountCapPeriod = 'PURCHASE' | 'WEEK' | 'MONTH' | 'CAMPAIGN';

export interface PromotionScopeDto {
  /** Exactamente uno de los dos tiene valor. */
  storeId: string | null;
  chainId: string | null;
  /** Como máximo uno; ninguno significa todo el comercio. */
  productId: string | null;
  canonicalProductId: string | null;
}

export interface PromotionConditionsDto {
  paymentMethod: PaymentMethod | null;
  bank: string | null;
  membershipProgram: string | null;
  minimumSpend: DecimalString | null;
  discountCap: DecimalString | null;
  capPeriod: DiscountCapPeriod | null;
  /** ISO 1 = lunes … 7 = domingo; vacío significa todos los días. */
  eligibleWeekdays: number[];
}

export interface PromotionDto {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScopeDto;
  discountPercentage: DecimalString | null;
  /** Precio final por unidad de venta, no el total del lote. */
  fixedPrice: DecimalString | null;
  requiredQuantity: number | null;
  conditions: PromotionConditionsDto;
  /**
   * false cuando el beneficio depende del banco, del medio de pago, de una
   * membresía o de compras anteriores: se informa, pero no se calcula solo.
   */
  automatic: boolean;
  terms: string | null;
  source: string;
  /** Vigencia `[validFrom, validUntil)`, ISO 8601 en UTC. */
  validFrom: string;
  validUntil: string;
}

/** Búsqueda y comparación (P3-01). */
export type PriceSortBy = 'UNIT_PRICE' | 'PRICE' | 'DISTANCE';

/** Coincidencia exacta con lo buscado, o alternativa del mismo canónico. */
export type OfferMatchType = 'EXACT' | 'ALTERNATIVE';

/** Cómo se acotó una búsqueda de productos. */
export interface SearchProductsScopeDto {
  origin: PriceScopeOrigin;
  radiusKm: number | null;
  /** Sucursales consideradas; null cuando la búsqueda no se acotó por ubicación. */
  storesConsidered: number | null;
}

/**
 * Promoción que cambia el precio de una oferta. El precio regular se conserva
 * aparte: el beneficio se muestra junto a la cantidad que hay que llevar.
 */
export interface OfferPromotionDto {
  id: string;
  name: string;
  type: PromotionType;
  minimumQuantity: number;
  regularTotal: DecimalString;
  total: DecimalString;
  discount: DecimalString;
  /** Precio por unidad base con la promoción, comparable con `unitPrice`. */
  promotionalUnitPrice: DecimalString;
  eligibleWeekdays: number[];
  terms: string | null;
}

/** Precio de un producto en una sucursal, con su procedencia y su promoción. */
export interface OfferDto {
  store: StoreDto;
  price: DecimalString;
  currency: string;
  unitPrice: DecimalString;
  unitPriceUnit: BaseUnit;
  unitPricePer100g: DecimalString | null;
  source: string;
  freshness: PriceFreshnessDto;
  /** Null cuando ninguna promoción automática alcanza a esta oferta. */
  promotion: OfferPromotionDto | null;
}

export interface ProductSearchItemDto extends ProductDto {
  /** Oferta más barata por unidad base dentro del alcance; null si no hay precio. */
  bestOffer: OfferDto | null;
}

export interface SearchProductsResultDto {
  items: ProductSearchItemDto[];
  page: { limit: number; nextCursor: string | null };
  scope: SearchProductsScopeDto;
}

export interface CanonicalOfferDto extends OfferDto {
  product: ProductDto;
  matchType: OfferMatchType;
}

export interface CanonicalPricesDto {
  canonicalProduct: CanonicalProductDto;
  scope: PriceScopeDto;
  sortBy: PriceSortBy;
  /** Una oferta por presentación y sucursal, comparables por unidad base. */
  offers: CanonicalOfferDto[];
}

// Rutinas y despensa privadas (P4-01). Espejo de apps/api/src/modules/routines y inventory.

export interface CanonicalSummaryDto {
  id: string;
  name: string;
  defaultUnit: BaseUnit;
}

export interface PreferredProductDto {
  id: string;
  name: string;
  brand: string | null;
  quantity: DecimalString;
  unit: MeasurementUnit;
}

export interface RoutineScheduleDto {
  frequencyDays: number;
  /** Fecha de calendario `AAAA-MM-DD`, sin hora. */
  anchorDate: string;
  /** `true` si el ítem usa la frecuencia y el ancla de su rutina. */
  inherited: boolean;
}

export interface RoutineItemDto {
  id: string;
  routineId: string;
  canonicalProduct: CanonicalSummaryDto;
  preferredProduct: PreferredProductDto | null;
  /** Necesidad por ocurrencia, en la unidad del canónico. */
  quantity: DecimalString;
  unit: BaseUnit;
  schedule: RoutineScheduleDto;
  allowSubstitutes: boolean;
  preferredBrands: string[];
  excludedBrands: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineDto {
  id: string;
  name: string;
  frequencyDays: number;
  anchorDate: string;
  items: RoutineItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineListDto {
  items: RoutineDto[];
}

export interface InventoryItemDto {
  id: string;
  canonicalProduct: CanonicalSummaryDto;
  /** Saldo aproximado en la unidad del canónico. */
  quantity: DecimalString;
  unit: BaseUnit;
  updatedAt: string;
}

export interface InventoryListDto {
  items: InventoryItemDto[];
}

/** Cuerpos de pedido de rutinas, despensa y perfil. Cantidades como texto decimal. */
export interface UpdateProfileRequest {
  city?: string | null;
  province?: string | null;
  latitude?: DecimalString | null;
  longitude?: DecimalString | null;
  maxTravelDistanceKm?: DecimalString;
  /** `null` = sin límite. */
  maxStoresPerShoppingPlan?: number | null;
  /** Solo `true`: la fecha la pone el servidor y conserva la primera (ADR 0012). */
  onboardingCompleted?: true;
}

export interface CreateRoutineRequest {
  name: string;
  frequencyDays?: number;
  anchorDate?: string;
}

export type UpdateRoutineRequest = Partial<CreateRoutineRequest>;

export interface RoutineItemFieldsRequest {
  quantity?: DecimalString;
  unit?: MeasurementUnit;
  preferredProductId?: string | null;
  /** Junto con `anchorDate`; los dos en `null` = heredar de la rutina. */
  frequencyDays?: number | null;
  anchorDate?: string | null;
  allowSubstitutes?: boolean;
  preferredBrands?: string[];
  excludedBrands?: string[];
}

export interface CreateRoutineItemRequest extends RoutineItemFieldsRequest {
  canonicalProductId: string;
  quantity: DecimalString;
  unit: MeasurementUnit;
}

export interface InventoryQuantityRequest {
  quantity: DecimalString;
  unit: MeasurementUnit;
}

export interface CreateInventoryItemRequest extends InventoryQuantityRequest {
  canonicalProductId: string;
}

// Planes de compra guardados (P5-03). Espejo de apps/api/src/modules/shopping-plans/presentation.

/** `EXPIRED` no se pide: un borrador o activo cuya última fecha ya pasó se informa vencido. */
export type ShoppingPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
/** `EMPTY`: nada que comprar. `PARTIAL`: hay faltantes. */
export type PlanCoverage = 'COMPLETE' | 'PARTIAL' | 'EMPTY';
/** `EXACT_BOUNDED`: óptimo entre los candidatos evaluados, no entre todas las sucursales. */
export type OptimizationMethod = 'EXACT_BOUNDED' | 'HEURISTIC' | 'NO_CANDIDATES';
export type PlanLocationOrigin = 'COORDINATES' | 'LOCALITY' | 'NONE';

export type PlanLineReasonCode =
  | 'CHEAPEST_EVALUATED'
  | 'CHEAPER_OPTION_NOT_WORTH_IT'
  | 'EXACT_PRODUCT_REQUIRED'
  | 'PREFERRED_PRODUCT'
  | 'PROMOTION_APPLIED';

export interface PlanLineAlternativeDto {
  offerId: string;
  productName: string;
  storeName: string;
  date: string;
  total: DecimalString;
  /** Alternativa − elegida: negativo si la alternativa era más barata en productos. */
  difference: DecimalString;
}

export interface PlanLineDto {
  id: string;
  canonicalProductId: string;
  canonicalName: string;
  productId: string;
  productName: string;
  brand: string | null;
  matchType: OfferMatchType;
  neededQuantity: DecimalString;
  quantity: DecimalString;
  unit: BaseUnit;
  packageCount: number | null;
  saleMode: SaleMode;
  surplus: DecimalString;
  quantityIsEstimate: boolean;
  price: DecimalString;
  regularPrice: DecimalString;
  discount: DecimalString;
  promotion: { id: string; name: string } | null;
  priceObservedAt: string;
  priceSource: string;
  reasonCodes: PlanLineReasonCode[];
  reason: string;
  alternatives: PlanLineAlternativeDto[];
}

export interface PlanScheduleVisitDto {
  storeId: string;
  storeName: string;
  chainName: string;
  distanceMeters: number | null;
  /** Ida y vuelta estimada en línea recta; null si no hay coordenadas. */
  roundTripKm: DecimalString | null;
  subtotal: DecimalString;
  lines: PlanLineDto[];
}

export interface PlanScheduleDayDto {
  date: string;
  visits: PlanScheduleVisitDto[];
}

export interface PlanTotalsDto {
  productCost: DecimalString;
  regularProductCost: DecimalString;
  promotionDiscount: DecimalString;
  visitCount: number;
  storeCount: number;
  storeVisitPenaltyCost: DecimalString;
  distancePenaltyCost: DecimalString;
  effectiveCost: DecimalString;
  totalDistanceKm: DecimalString | null;
}

export interface PlanNoticeDto {
  code: string;
  message: string;
}

export interface PlanUnfulfilledNeedDto {
  canonicalProductId: string;
  canonicalName: string;
  netQuantity: DecimalString;
  unit: BaseUnit;
  reason: string;
}

export interface PlanCoveredByInventoryDto {
  canonicalProductId: string;
  canonicalName: string;
  grossQuantity: DecimalString;
  unit: BaseUnit;
  inventory: { quantity: DecimalString; unit: BaseUnit; updatedAt: string; ageDays: number; applied: boolean; subtracted: DecimalString } | null;
}

export interface PlanNeedSummaryDto {
  canonicalProductId: string;
  canonicalName: string;
  unit: BaseUnit;
  grossQuantity: DecimalString;
  netQuantity: DecimalString;
  inventorySubtracted: DecimalString | null;
  sources: { routineName: string; occurrences: string[]; quantity: DecimalString }[];
}

export interface ShoppingPlanSummaryDto {
  id: string;
  status: ShoppingPlanStatus;
  startDate: string;
  endDate: string;
  generatedAt: string;
  completedAt: string | null;
  coverage: PlanCoverage;
  lineCount: number;
  visitCount: number;
  unfulfilledCount: number;
  optimizedCost: DecimalString;
  effectiveCost: DecimalString;
  /** Null sin base comparable: no hay ahorro que mostrar. */
  estimatedSavings: DecimalString | null;
}

export interface ShoppingPlanListDto {
  items: ShoppingPlanSummaryDto[];
}

export interface ShoppingPlanDto extends ShoppingPlanSummaryDto {
  optimizerVersion: string;
  method: OptimizationMethod;
  baselineMethod: 'SINGLE_STORE_REGULAR_PRICES' | 'NONE';
  location: { origin: PlanLocationOrigin; radiusKm: number | null; city: string | null; province: string | null };
  settings: { storeVisitPenalty: DecimalString; distancePenaltyPerKm: DecimalString; maxStores: number | null };
  totals: PlanTotalsDto;
  savings: {
    estimatedSavings: DecimalString;
    effectiveCostDifference: DecimalString;
    baselineStoreName: string;
    baselineProductCost: DecimalString;
  } | null;
  schedule: PlanScheduleDayDto[];
  needs: PlanNeedSummaryDto[];
  unfulfilled: PlanUnfulfilledNeedDto[];
  coveredByInventory: PlanCoveredByInventoryDto[];
  limitations: PlanNoticeDto[];
  warnings: PlanNoticeDto[];
  prices: { oldestObservedAt: string; newestObservedAt: string } | null;
}

/** POST /shopping-plans/generate (con cabecera Idempotency-Key). Fechas AAAA-MM-DD opcionales. */
export interface GeneratePlanRequest {
  startDate?: string;
  endDate?: string;
}

export interface UpdatePlanStatusRequest {
  status: 'ACTIVE' | 'COMPLETED';
}

// Historial y análisis de precios (P6-01). Espejo de apps/api/src/modules/prices/presentation/price-history.contracts.ts.

/** `STALE` e `INSUFFICIENT_DATA` no son conclusiones: faltan datos recientes o suficientes. */
export type PriceClassification = 'HISTORIC_LOW' | 'GOOD_DEAL' | 'NORMAL' | 'EXPENSIVE' | 'STALE' | 'INSUFFICIENT_DATA';

export interface PriceHistoryPointDto {
  /** Día argentino AAAA-MM-DD; solo días con dato (los huecos no se rellenan). */
  date: string;
  price: DecimalString;
  unitPrice: DecimalString;
  observedAt: string;
  observations: number;
}

export interface PriceAnalysisDto {
  classification: PriceClassification;
  current: { price: DecimalString; unitPrice: DecimalString; observedAt: string; date: string; ageDays: number; isStale: boolean } | null;
  baseWindow: { from: string; to: string; days: number; daysWithData: number; observations: number } | null;
  average: DecimalString | null;
  lowest: DecimalString | null;
  lowestDate: string | null;
  highest: DecimalString | null;
  ratioToAverage: DecimalString | null;
}

export interface PriceHistorySeriesDto {
  store: StoreDto;
  source: string;
  unitPriceUnit: BaseUnit;
  daysInRange: number;
  daysWithData: number;
  points: PriceHistoryPointDto[];
  analysis: PriceAnalysisDto;
}

export interface PriceHistoryDto {
  product: ProductDto;
  range: { from: string; to: string; days: number; timeZone: string; granularity: 'DAY' };
  scope: { origin: 'STORE' | 'COORDINATES' | 'LOCALITY' | 'ALL'; radiusKm: number | null; storesConsidered: number | null };
  policy: {
    dailyClose: 'LAST_OBSERVATION_OF_DAY';
    windowDays: number;
    minDaysWithData: number;
    goodDealBelowRatio: DecimalString;
    expensiveAboveRatio: DecimalString;
    maxAgeDays: number;
  };
  series: PriceHistorySeriesDto[];
  seriesLimit: number;
  truncated: boolean;
}

// Dashboard privado (P6-02). Espejo de apps/api/src/modules/dashboard/presentation/dashboard.contracts.ts.

export interface NextPurchaseDto {
  planId: string;
  status: 'ACTIVE' | 'DRAFT';
  startDate: string;
  endDate: string;
  /** Próximo día con compras del plan; si todos pasaron, el último y `dateHasPassed`. */
  date: string;
  dateHasPassed: boolean;
  visits: { storeId: string; storeName: string; chainName: string; lineCount: number; subtotal: DecimalString }[];
  remainingLines: number;
}

export interface SavingsBucketDto {
  amount: DecimalString;
  plans: number;
}

export interface OpportunityDto {
  canonicalProductId: string;
  canonicalName: string;
  productId: string;
  productName: string;
  brand: string | null;
  store: { id: string; name: string; chainName: string; distanceMeters: number | null };
  classification: 'HISTORIC_LOW' | 'GOOD_DEAL';
  price: DecimalString;
  unitPrice: DecimalString;
  unitPriceUnit: BaseUnit;
  observedAt: string;
  average: DecimalString;
  lowest: DecimalString;
  ratioToAverage: DecimalString;
}

export interface DashboardDto {
  today: string;
  nextPurchase: NextPurchaseDto | null;
  routines: { routineCount: number; itemCount: number };
  savings: {
    /** Estimado: planes en uso o completados, uno por período, por fecha de inicio. */
    estimated: {
      week: SavingsBucketDto;
      month: SavingsBucketDto;
      total: SavingsBucketDto;
      plansWithoutBaseline: number;
      selection: 'ONE_PLAN_PER_PERIOD_ACTIVE_OR_COMPLETED';
    };
    /** No hay registro de compras todavía. */
    registered: { available: false; message: string };
  };
  opportunities: {
    items: OpportunityDto[];
    unavailableReason: 'NO_ROUTINES' | 'NO_LOCATION' | 'NO_STORES_IN_SCOPE' | null;
    storesConsidered: number;
    seriesAnalyzed: number;
  };
}

/** Alertas de precio (P9-01, ADR 0022). */
export type AlertCondition = 'TARGET_PRICE' | 'HISTORIC_LOW' | 'GOOD_DEAL';

export type AlertOutcome =
  | 'NOTIFIED'
  | 'ALREADY_NOTIFIED'
  | 'COOLDOWN'
  | 'NO_MATCH'
  | 'NO_FRESH_PRICES'
  | 'INSUFFICIENT_DATA'
  | 'NO_ELIGIBLE_PRODUCTS'
  | 'NO_LOCATION'
  | 'NO_STORES_IN_SCOPE'
  | 'PAUSED'
  | 'RULE_CHANGED'
  | 'RULE_DELETED';

export interface PriceAlertDto {
  id: string;
  canonicalProduct: { id: string; name: string; defaultUnit: BaseUnit };
  /** Presentación preferida; `null` = cualquiera del genérico. */
  product: { id: string; name: string; brand: string | null } | null;
  allowSubstitutes: boolean;
  excludedBrands: string[];
  condition: AlertCondition;
  /** Solo en `TARGET_PRICE`: precio por unidad base del genérico, en pesos. */
  target: { unitPrice: DecimalString; unit: BaseUnit; currency: 'ARS' } | null;
  /** `null` = el radio de las preferencias. */
  radiusKm: DecimalString | null;
  active: boolean;
  status: { lastEvaluatedAt: string | null; lastOutcome: AlertOutcome | null; lastNotifiedAt: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface PriceAlertListDto {
  items: PriceAlertDto[];
  limit: number;
}

export interface CreatePriceAlertRequest {
  canonicalProductId: string;
  condition: AlertCondition;
  productId?: string | null;
  allowSubstitutes?: boolean;
  excludedBrands?: string[];
  targetUnitPrice?: DecimalString | null;
  targetUnit?: BaseUnit | null;
  currency?: 'ARS';
  radiusKm?: DecimalString | null;
  active?: boolean;
}

export type UpdatePriceAlertRequest = Partial<Omit<CreatePriceAlertRequest, 'canonicalProductId'>>;

/** Snapshot de un aviso de precio: tal como estaba al avisar. */
export interface PriceAlertNotificationData {
  reason: AlertCondition;
  canonicalProduct: { id: string; name: string };
  product: { id: string; name: string; brand: string | null };
  isAlternative: boolean;
  preferredProduct: { id: string; name: string } | null;
  store: { id: string; name: string; chainName: string; distanceMeters: number | null };
  price: DecimalString;
  unitPrice: DecimalString;
  unitPriceUnit: BaseUnit;
  currency: 'ARS';
  source: string;
  observedAt: string;
  target: { unitPrice: DecimalString; unit: BaseUnit; currency: 'ARS' } | null;
  analysis: { classification: string; average: DecimalString | null; lowest: DecimalString | null; ratioToAverage: DecimalString | null };
}

export interface NotificationDto {
  id: string;
  kind: 'PRICE_ALERT';
  ruleId: string | null;
  title: string;
  message: string;
  link: string;
  data: PriceAlertNotificationData;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  page: { limit: number; nextCursor: string | null };
  unreadCount: number;
}
