/**
 * Contrato de `GET /products/:id/price-history` (P6-01). Se refleja en
 * `packages/shared` y `docs/API.md`. Precios de góndola observados, sin promociones:
 * una promoción condicional o por cantidad no es el precio habitual.
 */
import type { BaseUnit } from '../../catalog/domain/units';
import type { ProductDto } from '../../catalog/presentation/catalog.contracts';
import type { StoreDto } from '../../stores/presentation/store.contracts';
import type { PriceClassification } from '../domain/price-analysis';

export interface PriceHistoryPointDto {
  /** Día argentino `AAAA-MM-DD`. Solo días con dato: un hueco no se rellena. */
  date: string;
  price: string;
  unitPrice: string;
  observedAt: string;
  /** Observaciones de ese día; el punto es la última. */
  observations: number;
}

export interface PriceAnalysisDto {
  classification: PriceClassification;
  current: {
    price: string;
    unitPrice: string;
    observedAt: string;
    date: string;
    ageDays: number;
    isStale: boolean;
  } | null;
  /** Los 30 días anteriores al precio actual, contra los que se compara. */
  baseWindow: { from: string; to: string; days: number; daysWithData: number; observations: number } | null;
  average: string | null;
  lowest: string | null;
  lowestDate: string | null;
  highest: string | null;
  ratioToAverage: string | null;
}

export interface PriceHistorySeriesDto {
  store: StoreDto;
  source: string;
  /** Unidad de `unitPrice`: KG, L o UNIT. */
  unitPriceUnit: BaseUnit;
  daysInRange: number;
  daysWithData: number;
  points: PriceHistoryPointDto[];
  analysis: PriceAnalysisDto;
}

export type PriceHistoryScopeOrigin = 'STORE' | 'COORDINATES' | 'LOCALITY' | 'ALL';

export interface PriceHistoryDto {
  product: ProductDto;
  range: { from: string; to: string; days: number; timeZone: string; granularity: 'DAY' };
  scope: { origin: PriceHistoryScopeOrigin; radiusKm: number | null; storesConsidered: number | null };
  policy: {
    dailyClose: 'LAST_OBSERVATION_OF_DAY';
    windowDays: number;
    minDaysWithData: number;
    goodDealBelowRatio: string;
    expensiveAboveRatio: string;
    maxAgeDays: number;
  };
  series: PriceHistorySeriesDto[];
  /** Máximo de series por respuesta; `truncated` avisa si quedaron afuera. */
  seriesLimit: number;
  truncated: boolean;
}
