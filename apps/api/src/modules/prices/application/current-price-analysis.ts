import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { ANALYSIS_WINDOW_DAYS, argentineDate, argentineDayStart, classifyCurrentPrice, shiftDate } from '../domain/price-analysis';
import type { PriceAnalysis } from '../domain/price-analysis';
import type { PriceObservationRecord } from '../domain/price-records';
import { ProductPriceRepository } from '../infrastructure/product-price.repository';

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
 *
 * P10-02: la ventana de cada serie se resume en la base (`findCurrentWithWindowStats`). Antes se
 * traían las observaciones con un tope de 50.000 y, con un dataset grande, las series que quedaban
 * afuera se clasificaban sin historia; ahora todas se analizan con el mismo criterio que la ficha.
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
    // Precio actual reciente + los 30 días anteriores: alcanza con mirar esa ventana hacia atrás.
    const series = await this.prices.findCurrentWithWindowStats(productIds, storeIds, {
      since: new Date(now.getTime() - (maxAgeDays + 1) * DAY_MS),
      windowStart: argentineDayStart(shiftDate(argentineDate(now), -(ANALYSIS_WINDOW_DAYS + maxAgeDays + 1))),
      until: new Date(now.getTime() + 1),
      windowDays: ANALYSIS_WINDOW_DAYS,
    });
    return series.map(({ latest, stats }) => ({ latest, analysis: classifyCurrentPrice({ latest, stats, now, maxAgeDays }) }));
  }
}
