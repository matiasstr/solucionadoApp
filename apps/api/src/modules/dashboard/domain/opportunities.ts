/**
 * Oportunidades del dashboard (P6-02): productos habituales cuyo precio actual,
 * cerca de la persona, es una buena oferta o el mínimo de la ventana según el
 * análisis de P6-01. Función pura: recibe series ya analizadas.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import { normalizeName } from '../../catalog/domain/naming';
import type { PriceAnalysis } from '../../prices/domain/price-analysis';

export const MAX_OPPORTUNITIES = 10;

export interface AnalyzedSeries<T> {
  readonly canonicalName: string;
  readonly productId: string;
  readonly storeId: string;
  readonly analysis: PriceAnalysis;
  readonly payload: T;
}

/** Solo etiquetas concluyentes y a favor: nunca un precio viejo ni con pocos datos. */
const isOpportunity = (analysis: PriceAnalysis) =>
  analysis.classification === 'HISTORIC_LOW' || analysis.classification === 'GOOD_DEAL';

/**
 * Orden: mínimo de la ventana primero, después la mayor rebaja contra el promedio,
 * el nombre del producto y los ids. Hasta `limit` resultados.
 */
export function rankOpportunities<T>(series: readonly AnalyzedSeries<T>[], limit = MAX_OPPORTUNITIES): AnalyzedSeries<T>[] {
  const ratio = (entry: AnalyzedSeries<T>) => DecimalValue.parse(entry.analysis.ratioToAverage ?? '1');
  return series
    .filter((entry) => isOpportunity(entry.analysis))
    .sort(
      (a, b) =>
        Number(b.analysis.classification === 'HISTORIC_LOW') - Number(a.analysis.classification === 'HISTORIC_LOW') ||
        ratio(a).compare(ratio(b)) ||
        normalizeName(a.canonicalName).localeCompare(normalizeName(b.canonicalName)) ||
        a.productId.localeCompare(b.productId) ||
        a.storeId.localeCompare(b.storeId),
    )
    .slice(0, limit);
}
