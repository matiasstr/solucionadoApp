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

const toInt = ({ value }: { value: unknown }) =>
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
  @IsIn(['', 'loopback', 'uniquelocal', 'loopback,uniquelocal'])
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
}

/** Token de inyección de la configuración validada. */
export const API_CONFIG = Symbol('API_CONFIG');

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly corsOrigins: readonly string[];
  /** Valor para Express `trust proxy`; false si no hay proxy delante. */
  readonly trustProxy: string | false;
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
    trustProxy: env.TRUST_PROXY || false,
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
  });
}
