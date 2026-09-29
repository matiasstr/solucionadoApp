import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { toProductDto } from '../../catalog/presentation/catalog.mappers';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import type { StoreScopeQuery } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { toStoreDto } from '../../stores/presentation/store.contracts';
import {
  ANALYSIS_WINDOW_DAYS,
  EXPENSIVE_RATIO,
  GOOD_DEAL_RATIO,
  MIN_DAYS_WITH_DATA,
  analyzeSeries,
  argentineDate,
  argentineDayStart,
  dailyCloses,
  daysBetween,
  shiftDate,
} from '../domain/price-analysis';
import type { PriceObservationRecord } from '../domain/price-records';
import { ProductPriceRepository } from '../infrastructure/product-price.repository';
import type { PriceHistoryDto, PriceHistoryScopeOrigin, PriceHistorySeriesDto } from '../presentation/price-history.contracts';

/** Rango máximo pedido y series por respuesta: acotan consulta y tamaño. */
export const MAX_HISTORY_DAYS = 366;
export const MAX_HISTORY_SERIES = 20;
/** Por defecto se muestran los últimos 30 días, hoy incluido. */
const DEFAULT_HISTORY_DAYS = 30;
const MAX_OBSERVATIONS = 50_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface PriceHistoryQuery extends StoreScopeQuery {
  readonly storeId?: string;
  readonly from?: string;
  readonly to?: string;
  /** Momento de referencia; los tests lo fijan. */
  readonly now?: Date;
}

const invalid = (message: string, fields: string[]) => new PublicHttpException(400, 'VALIDATION_FAILED', message, fields);

function validDate(value: string, field: string): string {
  const match = CALENDAR_DATE.exec(value);
  const parsed = match ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid('La fecha debe ser un día real con formato AAAA-MM-DD.', [field]);
  }
  return value;
}

const seriesKey = (observation: { storeId: string; source: string }) => `${observation.storeId}|${observation.source}`;

/**
 * Historial y análisis de un producto (P6-01, ADR 0016): una serie por sucursal y
 * fuente, un punto por día argentino y el análisis del precio actual contra los 30
 * días anteriores. Lectura pública: son los mismos precios que ya expone la API.
 */
@Injectable()
export class GetPriceHistoryUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly prices: ProductPriceRepository,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(productId: string, query: PriceHistoryQuery = {}): Promise<PriceHistoryDto> {
    const product = await this.products.findById(productId);
    if (!product) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto.');

    const now = query.now ?? new Date();
    const to = query.to === undefined ? argentineDate(now) : validDate(query.to, 'to');
    const from = query.from === undefined ? shiftDate(to, -(DEFAULT_HISTORY_DAYS - 1)) : validDate(query.from, 'from');
    if (from > to) throw invalid('La fecha inicial no puede ser posterior a la final.', ['from', 'to']);
    const days = daysBetween(from, to) + 1;
    if (days > MAX_HISTORY_DAYS) throw invalid(`El historial abarca como máximo ${MAX_HISTORY_DAYS} días.`, ['from', 'to']);

    const hasLocation = [query.latitude, query.longitude, query.radiusKm, query.city, query.province].some(
      (value) => value !== undefined,
    );
    if (query.storeId && hasLocation) {
      throw invalid('Elegí una sucursal o una ubicación, no las dos.', ['storeId']);
    }
    let origin: PriceHistoryScopeOrigin = 'STORE';
    let radiusKm: number | null = null;
    let storeIds: string[] | null = query.storeId ? [query.storeId] : null;
    let distances = new Map<string, number>();
    if (!query.storeId) {
      const scope = await this.storeScope.resolve(query);
      origin = scope.origin;
      radiusKm = scope.radiusKm;
      storeIds = scope.storeIds;
      distances = scope.distances;
    }

    const policy = {
      dailyClose: 'LAST_OBSERVATION_OF_DAY' as const,
      windowDays: ANALYSIS_WINDOW_DAYS,
      minDaysWithData: MIN_DAYS_WITH_DATA,
      goodDealBelowRatio: GOOD_DEAL_RATIO,
      expensiveAboveRatio: EXPENSIVE_RATIO,
      maxAgeDays: this.config.prices.maxAgeDays,
    };
    const base = {
      product: toProductDto(product),
      range: { from, to, days, timeZone: 'America/Argentina/Buenos_Aires', granularity: 'DAY' as const },
      scope: { origin, radiusKm, storesConsidered: storeIds?.length ?? null },
      policy,
      seriesLimit: MAX_HISTORY_SERIES,
    };
    if (storeIds?.length === 0) return { ...base, series: [], truncated: false };

    // Las series más recientes primero; el resto se informa como recortado.
    const latest = (await this.prices.findLatestPerSeries(product.id, storeIds)).sort(
      (a, b) => b.observedAt.getTime() - a.observedAt.getTime() || (seriesKey(a) < seriesKey(b) ? -1 : 1),
    );
    const kept = latest.slice(0, MAX_HISTORY_SERIES);
    if (!kept.length) return { ...base, series: [], truncated: false };

    // Una consulta cubre lo pedido y los 30 días previos al precio actual de cada serie.
    const earliestBase = kept.reduce(
      (earliest, observation) => {
        const start = shiftDate(argentineDate(observation.observedAt), -ANALYSIS_WINDOW_DAYS);
        return start < earliest ? start : earliest;
      },
      from,
    );
    const lastObserved = Math.max(...kept.map((observation) => observation.observedAt.getTime()));
    const until = new Date(Math.max(argentineDayStart(shiftDate(to, 1)).getTime(), lastObserved + 1));
    const keptStoreIds = [...new Set(kept.map((observation) => observation.storeId))];
    const observations = await this.prices.findBetween(product.id, {
      storeIds: keptStoreIds,
      from: argentineDayStart(earliestBase),
      until,
      limit: MAX_OBSERVATIONS,
    });
    if (observations.length > MAX_OBSERVATIONS) {
      throw invalid('Hay demasiadas observaciones en ese rango: acotá las fechas o elegí una sucursal.', ['from', 'to']);
    }

    const bySeries = new Map<string, PriceObservationRecord[]>();
    for (const observation of observations) {
      const key = seriesKey(observation);
      const group = bySeries.get(key);
      if (group) group.push(observation);
      else bySeries.set(key, [observation]);
    }
    const storesById = new Map((await this.stores.findManyByIds(keptStoreIds)).map((store) => [store.id, store]));

    const series: PriceHistorySeriesDto[] = [];
    for (const current of kept) {
      const store = storesById.get(current.storeId);
      if (!store) continue;
      const seriesObservations = bySeries.get(seriesKey(current)) ?? [];
      const points = dailyCloses(seriesObservations).filter((close) => close.date >= from && close.date <= to);
      const analysis = analyzeSeries({
        observations: seriesObservations,
        latest: current,
        now,
        maxAgeDays: this.config.prices.maxAgeDays,
      });
      series.push({
        store: toStoreDto(store, distances.get(store.id) ?? null),
        source: current.source,
        unitPriceUnit: current.unitPriceUnit,
        daysInRange: days,
        daysWithData: points.length,
        points: points.map((point) => ({
          date: point.date,
          price: point.price,
          unitPrice: point.unitPrice,
          observedAt: point.observedAt.toISOString(),
          observations: point.observations,
        })),
        analysis: {
          ...analysis,
          current: analysis.current ? { ...analysis.current, observedAt: analysis.current.observedAt.toISOString() } : null,
        },
      });
    }
    // Orden estable para mostrar: cadena, sucursal y fuente.
    series.sort(
      (a, b) =>
        a.store.chainName.localeCompare(b.store.chainName, 'es') ||
        a.store.name.localeCompare(b.store.name, 'es') ||
        a.store.id.localeCompare(b.store.id) ||
        a.source.localeCompare(b.source),
    );
    return { ...base, series, truncated: latest.length > kept.length };
  }
}
