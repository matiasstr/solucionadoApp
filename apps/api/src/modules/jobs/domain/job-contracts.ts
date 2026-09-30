/**
 * Contratos de los jobs (P8-01, ADR 0020): nombres, colas, datos y claves. Los datos son
 * chicos (parámetros e ids, nunca archivos ni credenciales) y se validan al encolar **y** al
 * procesar: lo que llega de Redis no se da por bueno.
 */
import { createHash } from 'node:crypto';
import { parseCalendarDate, RoutineRuleError } from '../../routines/domain/routine-rules';
import type { CalendarDate } from '../../routines/domain/routine-rules';
import { addDays, toDayNumber } from '../../shopping-plans/domain/plan-calendar';

export const JOB_NAMES = ['IMPORT_PRICES', 'IMPORT_PROMOTIONS', 'GENERATE_WEEKLY_PLANS', 'CHECK_PRICE_ALERTS'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export const QUEUE_NAMES = ['imports', 'plans', 'alerts'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export const JOB_QUEUE: Readonly<Record<JobName, QueueName>> = {
  IMPORT_PRICES: 'imports',
  IMPORT_PROMOTIONS: 'imports',
  GENERATE_WEEKLY_PLANS: 'plans',
  CHECK_PRICE_ALERTS: 'alerts',
};

/** `CHECK_PRICE_ALERTS` es solo contrato hasta la fase 9: no se encola ni se procesa. */
export const IMPLEMENTED_JOBS: readonly JobName[] = ['IMPORT_PRICES', 'IMPORT_PROMOTIONS', 'GENERATE_WEEKLY_PLANS'];
/** Colas que consume el worker. */
export const WORKER_QUEUES: readonly QueueName[] = ['imports', 'plans'];

export const isJobName = (value: unknown): value is JobName => (JOB_NAMES as readonly unknown[]).includes(value);
export const isImplementedJob = (name: JobName): boolean => IMPLEMENTED_JOBS.includes(name);

/** Mismos límites que el comando de importación (P7-02). */
export const IMPORT_LIMITS = {
  seed: [0, 1_000_000],
  stores: [1, 1000],
  products: [1, 100_000],
  days: [1, 400],
  every: [0, 1_000_000],
  batchSize: [1, 1000],
  concurrency: [1, 16],
  maxRetries: [0, 5],
} as const satisfies Record<string, readonly [number, number]>;

export interface MockPricesPayload {
  readonly v: 1;
  readonly provider: 'mock';
  readonly seed: number;
  readonly stores: number;
  readonly products: number;
  readonly days: number;
  /** Se fija al encolar: un reintento al día siguiente importa lo mismo. */
  readonly anchorDate: CalendarDate;
  readonly corruptEvery: number;
  readonly withoutEanEvery: number;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly maxRetries: number;
}

export interface JsonLinesPricesPayload {
  readonly v: 1;
  readonly provider: 'jsonl';
  readonly source: string;
  readonly decimalSeparator: ',' | '.';
  /** Ruta relativa a `IMPORT_FILES_DIR`; nunca absoluta ni con `..`. */
  readonly file: string | null;
  /** Sin credenciales ni query: una URL firmada llevaría un secreto a Redis. */
  readonly url: string | null;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly maxRetries: number;
}

export type ImportPricesPayload = MockPricesPayload | JsonLinesPricesPayload;

export interface ImportPromotionsPayload {
  readonly v: 1;
  readonly provider: 'mock';
  readonly anchorDate: CalendarDate;
  readonly batchSize: number;
  readonly maxRetries: number;
}

export interface WeeklyPlansPayload {
  readonly v: 1;
  /** Lunes de la semana del plan (calendario argentino). */
  readonly weekStart: CalendarDate;
  /** Un usuario puntual; null = todos los que tienen rutinas con productos. */
  readonly userId: string | null;
}

/** Contrato para la fase 9: todavía no hay alertas que revisar. */
export interface PriceAlertsPayload {
  readonly v: 1;
  readonly asOf: CalendarDate;
}

export interface JobPayloads {
  readonly IMPORT_PRICES: ImportPricesPayload;
  readonly IMPORT_PROMOTIONS: ImportPromotionsPayload;
  readonly GENERATE_WEEKLY_PLANS: WeeklyPlansPayload;
  readonly CHECK_PRICE_ALERTS: PriceAlertsPayload;
}

/** Datos inválidos: el mensaje nombra el campo, nunca el valor. */
export class JobPayloadError extends Error {
  constructor(
    message: string,
    readonly fields: readonly string[],
  ) {
    super(message);
    this.name = 'JobPayloadError';
  }
}

type Raw = Readonly<Record<string, unknown>>;

const MAX_PAYLOAD_CHARS = 4000;
const SOURCE = /^[a-z0-9._-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Relativa, sin `..`, sin barras invertidas ni dobles, y con extensión de JSON Lines. */
const RELATIVE_FILE = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_-][A-Za-z0-9._/-]{0,198}\.jsonl(\.gz)?$/;
const JOB_KEY = /^[A-Za-z0-9_-]{1,64}$/;

function asRecord(raw: unknown): Raw {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new JobPayloadError('Los datos del job deben ser un objeto.', ['data']);
  if (JSON.stringify(raw).length > MAX_PAYLOAD_CHARS) throw new JobPayloadError('Los datos del job son demasiado grandes.', ['data']);
  return raw as Raw;
}

function onlyKeys(raw: Raw, keys: readonly string[]): void {
  const unknown = Object.keys(raw).filter((key) => !keys.includes(key)).sort();
  if (unknown.length) throw new JobPayloadError('Los datos del job tienen campos desconocidos.', unknown);
}

function version(raw: Raw): 1 {
  if (raw.v !== 1) throw new JobPayloadError('Versión de datos del job no soportada.', ['v']);
  return 1;
}

function integer(raw: Raw, key: string, [min, max]: readonly [number, number]): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new JobPayloadError(`${key} debe ser un entero entre ${min} y ${max}.`, [key]);
  }
  return value;
}

function calendarDate(raw: Raw, key: string): CalendarDate {
  const value = raw[key];
  try {
    if (typeof value !== 'string') throw new RoutineRuleError('ANCHOR_DATE_INVALID', '', [key]);
    return parseCalendarDate(value, key);
  } catch (error: unknown) {
    if (error instanceof RoutineRuleError) throw new JobPayloadError(`${key} debe ser una fecha AAAA-MM-DD.`, [key]);
    throw error;
  }
}

function nullableText(raw: Raw, key: string): string | null {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new JobPayloadError(`${key} debe ser texto o null.`, [key]);
  return value;
}

/** La URL se valida del todo al procesar (hosts permitidos); acá, que no lleve secretos. */
function safeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new JobPayloadError('url no es una URL válida.', ['url']);
  }
  if (value.length > 2000 || !['https:', 'http:'].includes(url.protocol)) throw new JobPayloadError('url debe ser http(s).', ['url']);
  if (url.username || url.password || url.search || url.hash) {
    throw new JobPayloadError('url no puede llevar credenciales, parámetros ni fragmento: quedarían guardados en la cola.', ['url']);
  }
  return value;
}

const TUNING_KEYS = ['batchSize', 'concurrency', 'maxRetries'] as const;

function parseImportPrices(raw: Raw): ImportPricesPayload {
  const tuning = {
    batchSize: integer(raw, 'batchSize', IMPORT_LIMITS.batchSize),
    concurrency: integer(raw, 'concurrency', IMPORT_LIMITS.concurrency),
    maxRetries: integer(raw, 'maxRetries', IMPORT_LIMITS.maxRetries),
  };
  if (raw.provider === 'mock') {
    onlyKeys(raw, ['v', 'provider', 'seed', 'stores', 'products', 'days', 'anchorDate', 'corruptEvery', 'withoutEanEvery', ...TUNING_KEYS]);
    return {
      v: version(raw),
      provider: 'mock',
      seed: integer(raw, 'seed', IMPORT_LIMITS.seed),
      stores: integer(raw, 'stores', IMPORT_LIMITS.stores),
      products: integer(raw, 'products', IMPORT_LIMITS.products),
      days: integer(raw, 'days', IMPORT_LIMITS.days),
      anchorDate: calendarDate(raw, 'anchorDate'),
      corruptEvery: integer(raw, 'corruptEvery', IMPORT_LIMITS.every),
      withoutEanEvery: integer(raw, 'withoutEanEvery', IMPORT_LIMITS.every),
      ...tuning,
    };
  }
  if (raw.provider === 'jsonl') {
    onlyKeys(raw, ['v', 'provider', 'source', 'decimalSeparator', 'file', 'url', ...TUNING_KEYS]);
    if (typeof raw.source !== 'string' || !SOURCE.test(raw.source)) throw new JobPayloadError('source debe ser [a-z0-9._-], hasta 80.', ['source']);
    if (raw.decimalSeparator !== ',' && raw.decimalSeparator !== '.') throw new JobPayloadError('decimalSeparator debe ser "," o ".".', ['decimalSeparator']);
    const file = nullableText(raw, 'file');
    const url = nullableText(raw, 'url');
    if ((file === null) === (url === null)) throw new JobPayloadError('Indicá file o url (uno solo).', ['file', 'url']);
    if (file !== null && !RELATIVE_FILE.test(file)) {
      throw new JobPayloadError('file debe ser una ruta relativa a IMPORT_FILES_DIR terminada en .jsonl o .jsonl.gz.', ['file']);
    }
    return {
      v: version(raw),
      provider: 'jsonl',
      source: raw.source,
      decimalSeparator: raw.decimalSeparator,
      file,
      url: url === null ? null : safeUrl(url),
      ...tuning,
    };
  }
  throw new JobPayloadError('provider debe ser mock o jsonl.', ['provider']);
}

function parseImportPromotions(raw: Raw): ImportPromotionsPayload {
  onlyKeys(raw, ['v', 'provider', 'anchorDate', 'batchSize', 'maxRetries']);
  if (raw.provider !== 'mock') throw new JobPayloadError('Por ahora solo hay promociones simuladas (provider mock).', ['provider']);
  return {
    v: version(raw),
    provider: 'mock',
    anchorDate: calendarDate(raw, 'anchorDate'),
    batchSize: integer(raw, 'batchSize', IMPORT_LIMITS.batchSize),
    maxRetries: integer(raw, 'maxRetries', IMPORT_LIMITS.maxRetries),
  };
}

function parseWeeklyPlans(raw: Raw): WeeklyPlansPayload {
  onlyKeys(raw, ['v', 'weekStart', 'userId']);
  const weekStart = calendarDate(raw, 'weekStart');
  if (!isMonday(weekStart)) throw new JobPayloadError('weekStart debe ser un lunes.', ['weekStart']);
  const userId = nullableText(raw, 'userId');
  if (userId !== null && !UUID.test(userId)) throw new JobPayloadError('userId debe ser un UUID.', ['userId']);
  return { v: version(raw), weekStart, userId: userId?.toLowerCase() ?? null };
}

function parsePriceAlerts(raw: Raw): PriceAlertsPayload {
  onlyKeys(raw, ['v', 'asOf']);
  return { v: version(raw), asOf: calendarDate(raw, 'asOf') };
}

const PARSERS: { readonly [K in JobName]: (raw: Raw) => JobPayloads[K] } = {
  IMPORT_PRICES: parseImportPrices,
  IMPORT_PROMOTIONS: parseImportPromotions,
  GENERATE_WEEKLY_PLANS: parseWeeklyPlans,
  CHECK_PRICE_ALERTS: parsePriceAlerts,
};

/** Validación estricta: todos los campos presentes, sin extras. Se usa al encolar y al procesar. */
export function parseJobPayload<K extends JobName>(name: K, raw: unknown): JobPayloads[K] {
  return PARSERS[name](asRecord(raw));
}

/** Días desde un jueves (1970-01-01): lunes = 0. */
const weekday = (date: CalendarDate): number => (((toDayNumber(date) + 3) % 7) + 7) % 7;

export const isMonday = (date: CalendarDate): boolean => weekday(date) === 0;

/** Lunes de la semana que empieza hoy o la próxima: un plan semanal no arranca a mitad de semana. */
export function upcomingWeekStart(today: CalendarDate): CalendarDate {
  const day = weekday(today);
  return day === 0 ? today : addDays(today, 7 - day);
}

/** JSON con claves ordenadas: el mismo contenido da el mismo resumen. */
function canonical(payload: object): string {
  return JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))));
}

const digest = (payload: object): string => createHash('sha256').update(canonical(payload)).digest('hex').slice(0, 16);

/**
 * Id del job por ejecución lógica (BullMQ no acepta `:` ni ids numéricos). Encolar lo mismo
 * dos veces devuelve el job existente. Importaciones: mismos datos el mismo día, salvo que
 * se indique otra clave; planes: la semana (y el usuario, si es uno solo).
 */
export function jobIdFor<K extends JobName>(name: K, payload: JobPayloads[K], options: { readonly today: CalendarDate; readonly key?: string }): string {
  const { key, today } = options;
  if (key !== undefined && !JOB_KEY.test(key)) throw new JobPayloadError('La clave debe tener de 1 a 64 letras, números, guiones o guiones bajos.', ['key']);
  switch (name) {
    case 'IMPORT_PRICES':
      return `prices-${key ?? `${today}-${digest(payload)}`}`;
    case 'IMPORT_PROMOTIONS':
      return `promotions-${key ?? `${today}-${digest(payload)}`}`;
    case 'GENERATE_WEEKLY_PLANS': {
      if (key !== undefined) throw new JobPayloadError('Los planes semanales ya son únicos por semana: no llevan clave.', ['key']);
      const { weekStart, userId } = payload as WeeklyPlansPayload;
      return `weekly-plans-${weekStart}${userId ? `-${userId}` : ''}`;
    }
    default:
      return `price-alerts-${(payload as PriceAlertsPayload).asOf}`;
  }
}

/** Mismo contenido, sin importar el orden de las claves: detecta una clave reusada con otros datos. */
export const samePayload = (a: object, b: object): boolean => canonical(a) === canonical(b);
