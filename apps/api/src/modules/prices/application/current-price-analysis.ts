import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { ANALYSIS_WINDOW_DAYS, analyzeSeries, argentineDate, argentineDayStart, shiftDate } from '../domain/price-analysis';
import type { PriceAnalysis } from '../domain/price-analysis';
import type { PriceObservationRecord } from '../domain/price-records';
import { ProductPriceRepository } from '../infrastructure/product-price.repository';

/** Tope de observaciones leídas por consulta: una zona grande no se carga entera en memoria. */
const MAX_OBSERVATIONS = 50_000;
const DAY_MS = 86_400_000;

export interface AnalyzedCurrentPrice {
  /** Última observación de la serie (producto + sucursal + fuente). */
  readonly latest: PriceObservationRecord;
  readonly analysis: PriceAnalysis;
}

/**
 * Precio actual de cada serie con su análisis contra los 30 días anteriores (ADR 0016).
 * Lo usan el dashboard (oportunidades, P6-02) y las alertas (P9-01), así las dos pantallas
 * califican un precio igual. Solo series con un precio de los últimos `maxAgeDays + 1` días:
 * uno más viejo no es noticia (y el análisis lo marcaría `STALE`).
 */
@Injectable()
export class CurrentPriceAnalysis {
  constructor(
    private readonly prices: ProductPriceRepository,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async analyze(productIds: readonly string[], storeIds: readonly string[], now: Date): Promise<AnalyzedCurrentPrice[]> {
    if (!productIds.length || !storeIds.length) return [];
    const maxAgeDays = this.config.prices.maxAgeDays;
    const latest = (await this.prices.findLatestPerSeries(productIds, storeIds)).filter(
      (observation) => now.getTime() - observation.observedAt.getTime() <= (maxAgeDays + 1) * DAY_MS,
    );
    if (!latest.length) return [];
    // Precio actual reciente + los 30 días anteriores: alcanza con mirar esa ventana hacia atrás.
    const from = argentineDayStart(shiftDate(argentineDate(now), -(ANALYSIS_WINDOW_DAYS + maxAgeDays + 1)));
    const observations = await this.prices.findBetween([...new Set(latest.map((observation) => observation.productId))], {
      storeIds,
      from,
      until: new Date(now.getTime() + 1),
      limit: MAX_OBSERVATIONS,
    });
    const bySeries = new Map<string, PriceObservationRecord[]>();
    for (const observation of observations.slice(0, MAX_OBSERVATIONS)) {
      const key = seriesKey(observation);
      const group = bySeries.get(key);
      if (group) group.push(observation);
      else bySeries.set(key, [observation]);
    }
    return latest.map((current) => ({
      latest: current,
      analysis: analyzeSeries({ observations: bySeries.get(seriesKey(current)) ?? [], latest: current, now, maxAgeDays }),
    }));
  }
}

const seriesKey = (observation: Pick<PriceObservationRecord, 'productId' | 'storeId' | 'source'>): string =>
  `${observation.productId}|${observation.storeId}|${observation.source}`;
