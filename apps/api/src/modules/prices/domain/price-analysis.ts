/**
 * Historial y análisis de un precio (P6-01, ADR 0016). Función pura: sin Prisma,
 * Nest ni reloj propio.
 *
 * - Una **serie** es un producto en una sucursal según una fuente: nunca se
 *   mezclan sucursales ni fuentes como si fueran el mismo precio.
 * - **Cierre diario** en calendario argentino: la última observación del día
 *   (desempate `ingestedAt` y id). Diez importaciones en un día pesan lo mismo
 *   que una.
 * - El análisis compara el **precio actual** (la última observación de la serie)
 *   con los cierres de los 30 días **anteriores** a su día: si la base incluyera
 *   al precio actual, nunca podría estar por debajo de su propio mínimo.
 * - Con pocos días o con un precio viejo no hay etiqueta concluyente.
 */
import { DecimalValue } from '../../catalog/domain/decimal';
import { ageInDays } from './price-freshness';

export type CalendarDate = string;

/** Días que mira el análisis hacia atrás desde el día del precio actual. */
export const ANALYSIS_WINDOW_DAYS = 30;
/** Días con dato necesarios en la ventana para dar una etiqueta. */
export const MIN_DAYS_WITH_DATA = 7;
/** Buena oferta: por debajo del 85 % del promedio. Caro: por encima del 115 %. */
export const GOOD_DEAL_RATIO = '0.85';
export const EXPENSIVE_RATIO = '1.15';

const UNIT_PRICE_SCALE = 6;
const RATIO_SCALE = 4;
const MS_PER_DAY = 86_400_000;
/** Argentina usa UTC−3 todo el año (sin horario de verano desde 2009). */
const ARGENTINA_OFFSET_MS = 3 * 3_600_000;

export type PriceClassification =
  | 'HISTORIC_LOW'
  | 'GOOD_DEAL'
  | 'NORMAL'
  | 'EXPENSIVE'
  | 'STALE'
  | 'INSUFFICIENT_DATA';

export interface SeriesObservation {
  readonly id: string;
  readonly price: string;
  readonly unitPrice: string;
  readonly observedAt: Date;
  readonly ingestedAt: Date;
}

export interface DailyClose {
  readonly date: CalendarDate;
  readonly price: string;
  readonly unitPrice: string;
  readonly observedAt: Date;
  /** Observaciones de ese día en la serie: el cierre es la última. */
  readonly observations: number;
}

export interface PriceAnalysis {
  readonly classification: PriceClassification;
  readonly current: {
    readonly price: string;
    readonly unitPrice: string;
    readonly observedAt: Date;
    readonly date: CalendarDate;
    readonly ageDays: number;
    readonly isStale: boolean;
  } | null;
  /** Días anteriores al precio actual contra los que se compara. */
  readonly baseWindow: {
    readonly from: CalendarDate;
    readonly to: CalendarDate;
    readonly days: number;
    readonly daysWithData: number;
    readonly observations: number;
  } | null;
  /** Precio por unidad base: promedio de cierres diarios (cada día pesa igual). */
  readonly average: string | null;
  readonly lowest: string | null;
  /** Último día en que se vio el mínimo de la ventana. */
  readonly lowestDate: CalendarDate | null;
  readonly highest: string | null;
  /** `actual / promedio`, con cuatro decimales. */
  readonly ratioToAverage: string | null;
}

/** Día del calendario argentino al que pertenece un instante. */
export function argentineDate(instant: Date): CalendarDate {
  return new Date(instant.getTime() - ARGENTINA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Primer instante (UTC) de un día argentino: 00:00 en Buenos Aires. */
export function argentineDayStart(date: CalendarDate): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + ARGENTINA_OFFSET_MS);
}

export function shiftDate(date: CalendarDate, days: number): CalendarDate {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY);
}

/** La observación que queda como precio del día: la más tardía; desempate ingesta más reciente e id. */
function isLater(a: SeriesObservation, b: SeriesObservation): boolean {
  if (a.observedAt.getTime() !== b.observedAt.getTime()) return a.observedAt.getTime() > b.observedAt.getTime();
  if (a.ingestedAt.getTime() !== b.ingestedAt.getTime()) return a.ingestedAt.getTime() > b.ingestedAt.getTime();
  return a.id < b.id;
}

/** Un cierre por día argentino, del más viejo al más nuevo. */
export function dailyCloses(observations: readonly SeriesObservation[]): DailyClose[] {
  const byDay = new Map<CalendarDate, { close: SeriesObservation; count: number }>();
  for (const observation of observations) {
    const date = argentineDate(observation.observedAt);
    const entry = byDay.get(date);
    if (!entry) byDay.set(date, { close: observation, count: 1 });
    else byDay.set(date, { close: isLater(observation, entry.close) ? observation : entry.close, count: entry.count + 1 });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { close, count }]) => ({
      date,
      price: close.price,
      unitPrice: close.unitPrice,
      observedAt: close.observedAt,
      observations: count,
    }));
}

export interface AnalysisInput {
  /** Observaciones de **una** serie; deben cubrir la ventana previa al precio actual. */
  readonly observations: readonly SeriesObservation[];
  /** La última observación de la serie, aunque quede fuera de lo pedido. */
  readonly latest: SeriesObservation | null;
  readonly now: Date;
  readonly maxAgeDays: number;
}

/**
 * Precedencia estable de la clasificación: sin precio → `INSUFFICIENT_DATA`;
 * precio viejo → `STALE`; menos de 7 días con dato → `INSUFFICIENT_DATA`;
 * por debajo del mínimo de la ventana → `HISTORIC_LOW` (igualarlo no alcanza);
 * `< 85 %` del promedio → `GOOD_DEAL`; `> 115 %` → `EXPENSIVE`; si no, `NORMAL`.
 */
export function analyzeSeries(input: AnalysisInput): PriceAnalysis {
  const empty: PriceAnalysis = {
    classification: 'INSUFFICIENT_DATA',
    current: null,
    baseWindow: null,
    average: null,
    lowest: null,
    lowestDate: null,
    highest: null,
    ratioToAverage: null,
  };
  if (!input.latest) return empty;

  const currentDate = argentineDate(input.latest.observedAt);
  const ageDays = ageInDays(input.latest.observedAt, input.now);
  const current = {
    price: input.latest.price,
    unitPrice: input.latest.unitPrice,
    observedAt: input.latest.observedAt,
    date: currentDate,
    ageDays,
    isStale: ageDays > input.maxAgeDays,
  };

  const from = shiftDate(currentDate, -ANALYSIS_WINDOW_DAYS);
  const to = shiftDate(currentDate, -1);
  const base = dailyCloses(input.observations).filter((close) => close.date >= from && close.date <= to);
  const baseWindow = {
    from,
    to,
    days: ANALYSIS_WINDOW_DAYS,
    daysWithData: base.length,
    observations: base.reduce((total, close) => total + close.observations, 0),
  };
  if (!base.length) return { ...empty, current, baseWindow, classification: current.isStale ? 'STALE' : 'INSUFFICIENT_DATA' };

  const prices = base.map((close) => DecimalValue.parse(close.unitPrice));
  const sum = prices.reduce((total, value) => total.add(value), DecimalValue.zero(UNIT_PRICE_SCALE));
  const average = sum.divide(DecimalValue.parse(String(prices.length)), UNIT_PRICE_SCALE);
  let lowestIndex = 0;
  let highest = prices[0] as DecimalValue;
  for (const [index, value] of prices.entries()) {
    // `<=`: ante empate queda el día más reciente con ese mínimo.
    if (value.compare(prices[lowestIndex] as DecimalValue) <= 0) lowestIndex = index;
    if (value.compare(highest) > 0) highest = value;
  }
  const lowest = prices[lowestIndex] as DecimalValue;
  const currentUnit = DecimalValue.parse(current.unitPrice);

  let classification: PriceClassification;
  if (current.isStale) classification = 'STALE';
  else if (base.length < MIN_DAYS_WITH_DATA) classification = 'INSUFFICIENT_DATA';
  else if (currentUnit.compare(lowest) < 0) classification = 'HISTORIC_LOW';
  // Comparaciones exactas: actual × 1 contra promedio × umbral, sin redondear el umbral.
  else if (currentUnit.compare(average.multiply(DecimalValue.parse(GOOD_DEAL_RATIO))) < 0) classification = 'GOOD_DEAL';
  else if (currentUnit.compare(average.multiply(DecimalValue.parse(EXPENSIVE_RATIO))) > 0) classification = 'EXPENSIVE';
  else classification = 'NORMAL';

  return {
    classification,
    current,
    baseWindow,
    average: average.toFixed(UNIT_PRICE_SCALE),
    lowest: lowest.toFixed(UNIT_PRICE_SCALE),
    lowestDate: (base[lowestIndex] as DailyClose).date,
    highest: highest.toFixed(UNIT_PRICE_SCALE),
    ratioToAverage: average.isZero() ? null : currentUnit.divide(average, RATIO_SCALE).toFixed(RATIO_SCALE),
  };
}
