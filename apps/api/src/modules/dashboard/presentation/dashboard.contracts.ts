/**
 * Contrato de `GET /dashboard` (P6-02). Se refleja en `packages/shared` y
 * `docs/API.md`. Todo ahorro es **estimado**; el registrado no existe todavía.
 */
import type { BaseUnit } from '../../catalog/domain/units';
import type { PriceClassification } from '../../prices/domain/price-analysis';

export interface NextPurchaseVisitDto {
  storeId: string;
  storeName: string;
  chainName: string;
  lineCount: number;
  subtotal: string;
}

export interface NextPurchaseDto {
  planId: string;
  status: 'ACTIVE' | 'DRAFT';
  startDate: string;
  endDate: string;
  /** Próximo día con compras del plan; si todos pasaron, el último y `dateHasPassed`. */
  date: string;
  dateHasPassed: boolean;
  visits: NextPurchaseVisitDto[];
  remainingLines: number;
}

export interface SavingsBucketDto {
  amount: string;
  plans: number;
}

export interface OpportunityDto {
  canonicalProductId: string;
  canonicalName: string;
  productId: string;
  productName: string;
  brand: string | null;
  store: { id: string; name: string; chainName: string; distanceMeters: number | null };
  classification: Extract<PriceClassification, 'HISTORIC_LOW' | 'GOOD_DEAL'>;
  price: string;
  unitPrice: string;
  unitPriceUnit: BaseUnit;
  observedAt: string;
  average: string;
  lowest: string;
  ratioToAverage: string;
}

export type OpportunitiesUnavailableReason = 'NO_ROUTINES' | 'NO_LOCATION' | 'NO_STORES_IN_SCOPE';

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
    /** No hay registro de compras: nunca se completa con estimaciones. */
    registered: { available: false; message: string };
  };
  opportunities: {
    items: OpportunityDto[];
    unavailableReason: OpportunitiesUnavailableReason | null;
    storesConsidered: number;
    seriesAnalyzed: number;
  };
}
