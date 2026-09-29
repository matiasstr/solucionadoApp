'use client';

import type { PriceAnalysisDto, PriceClassification, PriceHistorySeriesDto } from '@tusofertas/shared';
import { useId } from 'react';
import type { SearchFilters } from '../../lib/catalog/filters';
import { usePriceHistory } from '../../lib/catalog/queries';
import { formatArs, formatUnitPrice } from '../../lib/format';
import { EmptyState, ErrorState, LoadingState } from '../common/states';

export const HISTORY_PERIODS = [30, 90, 180] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

// Fechas de calendario: se leen al mediodía UTC para que ninguna zona las corra de día.
const calendar = (date: string) => new Date(`${date}T12:00:00.000Z`);
const dayFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const percentFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const MS_PER_DAY = 86_400_000;
const dayIndex = (from: string, date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
const storeLabel = (series: PriceHistorySeriesDto) =>
  `${series.store.chainName} · ${series.store.name.replace(/ \(DEMO\)$/, '')}${series.source === 'demo-seed' ? '' : ` (${series.source})`}`;

const CLASSIFICATION_LABEL: Record<PriceClassification, string> = {
  HISTORIC_LOW: 'El más bajo en 30 días',
  GOOD_DEAL: 'Buena oferta',
  NORMAL: 'Precio habitual',
  EXPENSIVE: 'Más caro que lo habitual',
  STALE: 'Precio desactualizado',
  INSUFFICIENT_DATA: 'Pocos datos',
};

/** Explicación de la etiqueta con los números que la sostienen. */
function explain(analysis: PriceAnalysisDto, windowDays: number, minDays: number): string {
  const current = analysis.current;
  if (!current) return 'Todavía no hay precios de este producto en esta sucursal.';
  if (analysis.classification === 'STALE') {
    return `El último precio es de hace ${current.ageDays} días: no sabemos si sigue así, así que no lo comparamos.`;
  }
  const days = analysis.baseWindow?.daysWithData ?? 0;
  if (analysis.classification === 'INSUFFICIENT_DATA') {
    return `Hay ${days} de ${windowDays} días con precio antes del actual; hacen falta al menos ${minDays} para comparar.`;
  }
  const ratio = Number(analysis.ratioToAverage ?? '1');
  const difference = percentFormat.format(Math.abs(ratio - 1) * 100);
  const average = `promedio de los ${windowDays} días anteriores (${days} con precio)`;
  if (analysis.classification === 'HISTORIC_LOW') {
    return `Está por debajo del mínimo de esos ${windowDays} días (${formatNumber(analysis.lowest)} el ${dayFormat.format(calendar(analysis.lowestDate as string))}) y un ${difference}% por debajo del ${average}.`;
  }
  if (analysis.classification === 'GOOD_DEAL') return `Está un ${difference}% por debajo del ${average}.`;
  if (analysis.classification === 'EXPENSIVE') return `Está un ${difference}% por encima del ${average}.`;
  if (difference === '0') return `Está en el ${average}: dentro de lo habitual.`;
  return `Está un ${difference}% ${ratio < 1 ? 'por debajo' : 'por encima'} del ${average}: dentro de lo habitual.`;
}

const formatNumber = (amount: string | null) => (amount === null ? '—' : formatArs(amount));

/**
 * Historial de precios del producto (P6-02): una sucursal a la vez, un punto por día y
 * los huecos a la vista. La sucursal y el período viven en la URL.
 */
export function PriceHistorySection({
  productId,
  filters,
  period,
  storeId,
  onChange,
}: {
  productId: string;
  filters: SearchFilters;
  period: HistoryPeriod;
  storeId: string | null;
  onChange: (next: { period: HistoryPeriod; storeId: string | null }) => void;
}) {
  const history = usePriceHistory(productId, filters, period);
  const storeSelectId = useId();
  const periodSelectId = useId();
  const series = (history.data?.series ?? []).filter((entry) => !filters.chainId || entry.store.chainId === filters.chainId);
  const selected = series.find((entry) => entry.store.id === storeId) ?? series[0] ?? null;

  return (
    <section className="history-section" aria-labelledby="historial-titulo">
      <h2 id="historial-titulo">Historial de precios</h2>
      <p className="offer-group-note">
        Precio de góndola observado en cada sucursal, un dato por día (el último del día). Los días sin dato quedan en blanco:
        no inventamos precios intermedios. Las promociones no se incluyen.
      </p>

      <div className="history-controls">
        <div className="field field-inline">
          <label htmlFor={periodSelectId}>Período</label>
          <select
            id={periodSelectId}
            value={period}
            onChange={(event) => onChange({ period: Number(event.target.value) as HistoryPeriod, storeId: selected?.store.id ?? null })}
          >
            {HISTORY_PERIODS.map((days) => <option key={days} value={days}>Últimos {days} días</option>)}
          </select>
        </div>
        {series.length > 0 && (
          <div className="field field-inline history-store-field">
            <label htmlFor={storeSelectId}>Sucursal</label>
            <select
              id={storeSelectId}
              value={selected?.store.id ?? ''}
              onChange={(event) => onChange({ period, storeId: event.target.value })}
            >
              {series.map((entry) => (
                <option key={`${entry.store.id}-${entry.source}`} value={entry.store.id}>
                  {storeLabel(entry)} — {CLASSIFICATION_LABEL[entry.analysis.classification]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {history.isPending && <LoadingState label="Cargando el historial…" />}
      {history.isError && <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />}
      {history.isSuccess && !selected && (
        <EmptyState title="Sin historial en las sucursales elegidas">
          <p>Probá sacando el filtro de cadena o de localidad.</p>
        </EmptyState>
      )}
      {history.isSuccess && selected && (
        <HistoryDetail
          series={selected}
          from={history.data.range.from}
          to={history.data.range.to}
          windowDays={history.data.policy.windowDays}
          minDays={history.data.policy.minDaysWithData}
        />
      )}
      {history.data?.truncated && (
        <p className="results-note">Mostramos las {history.data.seriesLimit} sucursales con datos más recientes.</p>
      )}
    </section>
  );
}

function HistoryDetail({ series, from, to, windowDays, minDays }: {
  series: PriceHistorySeriesDto;
  from: string;
  to: string;
  windowDays: number;
  minDays: number;
}) {
  const { analysis } = series;
  return (
    <div className="history-detail">
      <div className={`history-analysis history-${analysis.classification.toLowerCase().replace('_', '-')}`}>
        <p className="history-badge">{CLASSIFICATION_LABEL[analysis.classification]}</p>
        <p className="history-explanation">{explain(analysis, windowDays, minDays)}</p>
        {analysis.current && (
          <dl className="history-figures">
            <div><dt>Precio actual</dt><dd>{formatUnitPrice(analysis.current.unitPrice, series.unitPriceUnit)}</dd></div>
            {analysis.average && <div><dt>Promedio 30 días</dt><dd>{formatUnitPrice(analysis.average, series.unitPriceUnit)}</dd></div>}
            {analysis.lowest && <div><dt>Mínimo 30 días</dt><dd>{formatUnitPrice(analysis.lowest, series.unitPriceUnit)}</dd></div>}
            {analysis.highest && <div><dt>Máximo 30 días</dt><dd>{formatUnitPrice(analysis.highest, series.unitPriceUnit)}</dd></div>}
          </dl>
        )}
      </div>

      {series.points.length === 0 ? (
        <p className="product-card-empty">No hay precios de esta sucursal en el período elegido.</p>
      ) : (
        <HistoryChart series={series} from={from} to={to} />
      )}
      <p className="muted">
        {series.daysWithData} de {series.daysInRange} días con precio · fuente: {series.source === 'demo-seed' ? 'datos de demostración' : series.source}
      </p>

      {series.points.length > 0 && (
        <details className="history-table">
          <summary>Ver los datos del gráfico</summary>
          <div className="history-table-scroll">
            <table>
              <caption className="visually-hidden">Precios por día en {storeLabel(series)}</caption>
              <thead>
                <tr><th scope="col">Día</th><th scope="col">Precio</th><th scope="col">Por {series.unitPriceUnit === 'KG' ? 'kg' : series.unitPriceUnit === 'L' ? 'litro' : 'unidad'}</th><th scope="col">Lecturas</th></tr>
              </thead>
              <tbody>
                {[...series.points].reverse().map((point) => (
                  <tr key={point.date}>
                    <td>{longDay.format(calendar(point.date))}</td>
                    <td>{formatArs(point.price)}</td>
                    <td>{formatArs(point.unitPrice)}</td>
                    <td>{point.observations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// Proporción pensada para móvil: en 360 px de ancho el gráfico mide unos 150 px de alto.
const WIDTH = 560;
const HEIGHT = 240;
const PAD = { top: 16, right: 12, bottom: 12, left: 12 };

/** Línea solo entre días consecutivos: un hueco corta la línea y un día aislado es un punto. */
function HistoryChart({ series, from, to }: { series: PriceHistorySeriesDto; from: string; to: string }) {
  const titleId = useId();
  const descId = useId();
  const days = dayIndex(from, to) + 1;
  const values = series.points.map((point) => Number(point.unitPrice));
  const average = series.analysis.average ? Number(series.analysis.average) : null;
  const all = average === null ? values : [...values, average];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || max * 0.1 || 1;
  const low = min - span * 0.15;
  const high = max + span * 0.15;
  const x = (date: string) => PAD.left + (days <= 1 ? 0.5 : dayIndex(from, date) / (days - 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * (HEIGHT - PAD.top - PAD.bottom);

  const segments: string[][] = [];
  let previous: string | null = null;
  for (const point of series.points) {
    const coordinate = `${x(point.date).toFixed(1)},${y(Number(point.unitPrice)).toFixed(1)}`;
    if (previous && dayIndex(previous, point.date) === 1) segments[segments.length - 1]?.push(coordinate);
    else segments.push([coordinate]);
    previous = point.date;
  }
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const unit = series.unitPriceUnit === 'KG' ? 'kg' : series.unitPriceUnit === 'L' ? 'litro' : 'unidad';

  return (
    <figure className="history-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${titleId} ${descId}`}>
        <title id={titleId}>Precio por {unit} en {storeLabel(series)}</title>
        <desc id={descId}>
          {`${series.points.length} días con precio entre el ${longDay.format(calendar(from))} y el ${longDay.format(calendar(to))}. `}
          {`Mínimo ${formatArs(String(Math.min(...values)))}, máximo ${formatArs(String(Math.max(...values)))}, último ${formatArs(last?.unitPrice ?? '0')} el ${longDay.format(calendar(last?.date ?? to))}.`}
        </desc>
        <line className="history-axis" x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} />
        {average !== null && (
          <line className="history-average" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(average)} y2={y(average)} />
        )}
        {segments.filter((segment) => segment.length > 1).map((segment) => (
          <polyline key={segment[0]} className="history-line" points={segment.join(' ')} />
        ))}
        {series.points.map((point) => (
          <circle key={point.date} className="history-dot" cx={x(point.date)} cy={y(Number(point.unitPrice))} r={4} />
        ))}
      </svg>
      <div className="history-axis-labels" aria-hidden="true">
        <span>{dayFormat.format(calendar(from))}</span>
        <span>{dayFormat.format(calendar(to))}</span>
      </div>
      <figcaption className="history-legend">
        <span className="legend-line" aria-hidden="true" /> Precio por {unit}
        {average !== null && <><span className="legend-average" aria-hidden="true" /> Promedio de los 30 días anteriores al precio actual</>}
        {first && last && (
          <span className="history-range">
            {' '}· Entre {formatArs(String(Math.min(...values)))} y {formatArs(String(Math.max(...values)))}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
