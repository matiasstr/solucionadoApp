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
  Min,
  validateSync,
} from 'class-validator';

class Environment {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3001;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9.:[\]-]+$/)
  HOST = '127.0.0.1';

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((origin) => origin.trim()) : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  CORS_ORIGINS: string[] = ['http://localhost:3000'];
}

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly corsOrigins: readonly string[];
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
  for (const key of ['NODE_ENV', 'PORT', 'HOST', 'CORS_ORIGINS']) {
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
  if (invalidKeys.length) {
    // Report variable names without exposing their possibly sensitive values.
    throw new Error(`Configuración inválida: ${[...new Set(invalidKeys)].sort().join(', ')}`);
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV as ApiConfig['nodeEnv'],
    port: env.PORT,
    host: env.HOST,
    corsOrigins: Object.freeze([...new Set(env.CORS_ORIGINS)]),
  });
}
