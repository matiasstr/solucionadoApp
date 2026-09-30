import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

/** Valor de ejemplo de .env.example: se rechaza en producción. */
export const EXAMPLE_JWT_SECRET = 'solo-desarrollo-cambiar-por-un-valor-aleatorio-largo';

class Environment {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3001;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9.:[\]-]+$/)
  HOST = '127.0.0.1';

  // Proxies confiables para X-Forwarded-For (IP real en rate limit). Vacío = ninguno.
  // `vercel` = confiar en exactamente un salto: Vercel reemplaza X-Forwarded-For con la IP
  // del cliente y descarta la que manda el cliente (verificado en producción, ADR 0010).
  @IsIn(['', 'loopback', 'uniquelocal', 'loopback,uniquelocal', 'vercel'])
  TRUST_PROXY = '';

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((origin) => origin.trim()) : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  CORS_ORIGINS: string[] = ['http://localhost:3000'];

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(512)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @Matches(/^[a-z0-9.:-]{3,80}$/)
  JWT_ISSUER = 'tusofertas-api';

  @IsString()
  @Matches(/^[a-z0-9.:-]{3,80}$/)
  JWT_AUDIENCE = 'tusofertas-web';

  @Transform(toInt)
  @IsInt()
  @Min(60)
  @Max(3600)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_TTL_DAYS = 30;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(10000)
  AUTH_RATE_LIMIT_PER_MINUTE = 10;

  // Antigüedad máxima de una observación para considerarla vigente (ADR 0008).
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(365)
  PRICE_MAX_AGE_DAYS = 7;

  // Fuentes preferidas ante igual fecha observada, de mayor a menor prioridad.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((source) => source.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-z0-9._-]{1,80}$/, { each: true })
  PRICE_SOURCE_PRECEDENCE: string[] = [];

  // Planificador (P5-01, ADR 0013): acotan el espacio de candidatos del optimizador.
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(62)
  PLANNER_MAX_HORIZON_DAYS = 28;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(31)
  PLANNER_MAX_CANDIDATE_DATES = 7;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(20)
  PLANNER_MAX_CANDIDATE_STORES = 8;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(10)
  PLANNER_MAX_OFFERS_PER_STORE = 2;

  // Presupuesto del optimizador (P5-02, ADR 0014): combinaciones antes del método aproximado.
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(2000000)
  PLANNER_MAX_COMBINATIONS = 100000;
}

/** Token de inyección de la configuración validada. */
export const API_CONFIG = Symbol('API_CONFIG');

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly corsOrigins: readonly string[];
  /** Valor para Express `trust proxy` (nombres de subred o cantidad de saltos); false si no hay proxy. */
  readonly trustProxy: string | number | false;
  /** Secreto: no registrar ni devolver. */
  readonly databaseUrl: string;
  readonly auth: {
    /** Secreto HS256: no registrar ni devolver. */
    readonly accessSecret: string;
    readonly issuer: string;
    readonly audience: string;
    readonly accessTtlSeconds: number;
    readonly refreshTtlDays: number;
    readonly rateLimitPerMinute: number;
    /** Cookie Secure: siempre en producción. */
    readonly secureCookies: boolean;
  };
  readonly prices: {
    /** Días tras los cuales una observación se muestra como desactualizada. */
    readonly maxAgeDays: number;
    /** Desempate por fuente ante igual `observedAt`; vacío = orden alfabético. */
    readonly sourcePrecedence: readonly string[];
  };
  readonly planner: {
    /** Días máximos de un plan, extremos incluidos. */
    readonly maxHorizonDays: number;
    /** Fechas de compra evaluadas por plan: las primeras de la ventana. */
    readonly maxCandidateDates: number;
    /** Sucursales que llegan al optimizador. */
    readonly maxCandidateStores: number;
    /** Ofertas más baratas por necesidad y sucursal. */
    readonly maxOffersPerStore: number;
    /** Combinaciones que evalúa la búsqueda exacta antes de pasar al método aproximado. */
    readonly maxCombinations: number;
  };
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

export function validateEnvironment(raw: Record<string, unknown>): ApiConfig {
  // Copy only known keys: process.env also contains credentials for other services.
  const input: Record<string, unknown> = {};
  for (const key of [
    'NODE_ENV', 'PORT', 'HOST', 'CORS_ORIGINS', 'DATABASE_URL',
    'JWT_ACCESS_SECRET', 'JWT_ISSUER', 'JWT_AUDIENCE', 'ACCESS_TOKEN_TTL_SECONDS', 'REFRESH_TOKEN_TTL_DAYS',
    'AUTH_RATE_LIMIT_PER_MINUTE', 'TRUST_PROXY',
    'PRICE_MAX_AGE_DAYS', 'PRICE_SOURCE_PRECEDENCE',
    'PLANNER_MAX_HORIZON_DAYS', 'PLANNER_MAX_CANDIDATE_DATES', 'PLANNER_MAX_CANDIDATE_STORES',
    'PLANNER_MAX_OFFERS_PER_STORE', 'PLANNER_MAX_COMBINATIONS',
  ]) {
    if (raw[key] !== undefined) input[key] = raw[key];
  }
  const env = plainToInstance(Environment, input);
  const invalidKeys = validateSync(env, {
    validationError: { target: false, value: false },
  }).map((error) => error.property);

  if (
    Array.isArray(env.CORS_ORIGINS) &&
    env.CORS_ORIGINS.some((origin) => typeof origin !== 'string' || !isExactHttpOrigin(origin))
  ) {
    invalidKeys.push('CORS_ORIGINS');
  }
  if (typeof env.DATABASE_URL === 'string' && !isPostgresUrl(env.DATABASE_URL)) {
    invalidKeys.push('DATABASE_URL');
  }
  if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === EXAMPLE_JWT_SECRET) {
    invalidKeys.push('JWT_ACCESS_SECRET');
  }
  if (invalidKeys.length) {
    // Report variable names without exposing their possibly sensitive values.
    throw new Error(`Configuración inválida: ${[...new Set(invalidKeys)].sort().join(', ')}`);
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV as ApiConfig['nodeEnv'],
    port: env.PORT,
    host: env.HOST,
    corsOrigins: Object.freeze([...new Set(env.CORS_ORIGINS)]),
    trustProxy: env.TRUST_PROXY === 'vercel' ? 1 : env.TRUST_PROXY || false,
    databaseUrl: env.DATABASE_URL,
    auth: Object.freeze({
      accessSecret: env.JWT_ACCESS_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      rateLimitPerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
      secureCookies: env.NODE_ENV === 'production',
    }),
    prices: Object.freeze({
      maxAgeDays: env.PRICE_MAX_AGE_DAYS,
      sourcePrecedence: Object.freeze([...new Set(env.PRICE_SOURCE_PRECEDENCE)]),
    }),
    planner: Object.freeze({
      maxHorizonDays: env.PLANNER_MAX_HORIZON_DAYS,
      maxCandidateDates: env.PLANNER_MAX_CANDIDATE_DATES,
      maxCandidateStores: env.PLANNER_MAX_CANDIDATE_STORES,
      maxOffersPerStore: env.PLANNER_MAX_OFFERS_PER_STORE,
      maxCombinations: env.PLANNER_MAX_COMBINATIONS,
    }),
  });
}
