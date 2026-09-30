import 'reflect-metadata';
import { isAbsolute } from 'node:path';
import { plainToInstance, Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min, validateSync } from 'class-validator';
import { toInt } from '../../config/environment';

/**
 * Configuración de colas y worker (P8-01, ADR 0020). Aparte de `ApiConfig`: el API HTTP no
 * usa Redis y arranca sin estas variables.
 */
class JobsEnvironment {
  @IsString()
  REDIS_URL!: string;

  // Prefijo de las claves en Redis: separa entornos (y los tests) en una misma instancia.
  @Matches(/^[a-z0-9-]{1,40}$/)
  JOBS_PREFIX = 'tusofertas';

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(10)
  JOBS_ATTEMPTS = 3;

  // Primera espera antes de reintentar; se duplica en cada intento.
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  JOBS_BACKOFF_MS = 30_000;

  // Las importaciones ya escriben lotes en paralelo: una por vez evita pisarse en la misma fuente.
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(4)
  JOBS_IMPORT_CONCURRENCY = 1;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(8)
  JOBS_PLAN_CONCURRENCY = 2;

  // Un job cuyo worker deja de renovar el bloqueo durante este tiempo se considera caído.
  @Transform(toInt)
  @IsInt()
  @Min(1000)
  @Max(600_000)
  JOBS_LOCK_DURATION_MS = 60_000;

  @Transform(toInt)
  @IsInt()
  @Min(500)
  @Max(600_000)
  JOBS_STALLED_INTERVAL_MS = 30_000;

  @IsOptional()
  @IsString()
  IMPORT_FILES_DIR?: string;

  @IsOptional()
  @IsString()
  IMPORT_ALLOWED_HOSTS?: string;
}

export interface JobsConfig {
  /** Puede llevar contraseña: no registrar ni devolver. */
  readonly redisUrl: string;
  readonly prefix: string;
  readonly attempts: number;
  readonly backoffMs: number;
  readonly concurrency: { readonly imports: number; readonly plans: number };
  readonly lockDurationMs: number;
  readonly stalledIntervalMs: number;
  /** Único directorio desde el que un job lee archivos; null = no se aceptan archivos. */
  readonly importFilesDir: string | null;
  readonly allowedHosts: readonly string[];
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['redis:', 'rediss:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function validateJobsEnvironment(raw: Record<string, unknown>): JobsConfig {
  const input: Record<string, unknown> = {};
  for (const key of [
    'REDIS_URL', 'JOBS_PREFIX', 'JOBS_ATTEMPTS', 'JOBS_BACKOFF_MS', 'JOBS_IMPORT_CONCURRENCY', 'JOBS_PLAN_CONCURRENCY',
    'JOBS_LOCK_DURATION_MS', 'JOBS_STALLED_INTERVAL_MS', 'IMPORT_FILES_DIR', 'IMPORT_ALLOWED_HOSTS',
  ]) {
    if (raw[key] !== undefined && raw[key] !== '') input[key] = raw[key];
  }
  const env = plainToInstance(JobsEnvironment, input);
  const invalidKeys = validateSync(env, { validationError: { target: false, value: false } }).map((error) => error.property);
  if (typeof env.REDIS_URL === 'string' && !isRedisUrl(env.REDIS_URL)) invalidKeys.push('REDIS_URL');
  if (env.IMPORT_FILES_DIR !== undefined && !isAbsolute(env.IMPORT_FILES_DIR)) invalidKeys.push('IMPORT_FILES_DIR');
  if (invalidKeys.length) {
    // Nombres de variables, nunca sus valores: la URL de Redis puede llevar contraseña.
    throw new Error(`Configuración de jobs inválida: ${[...new Set(invalidKeys)].sort().join(', ')}`);
  }
  return Object.freeze({
    redisUrl: env.REDIS_URL,
    prefix: env.JOBS_PREFIX,
    attempts: env.JOBS_ATTEMPTS,
    backoffMs: env.JOBS_BACKOFF_MS,
    concurrency: Object.freeze({ imports: env.JOBS_IMPORT_CONCURRENCY, plans: env.JOBS_PLAN_CONCURRENCY }),
    lockDurationMs: env.JOBS_LOCK_DURATION_MS,
    stalledIntervalMs: env.JOBS_STALLED_INTERVAL_MS,
    importFilesDir: env.IMPORT_FILES_DIR ?? null,
    allowedHosts: Object.freeze((env.IMPORT_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean)),
  });
}
