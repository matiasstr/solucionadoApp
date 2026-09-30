import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { IsOptionalNotNull } from '../../../common/rule-errors';
import { BASE_UNITS } from '../../catalog/domain/units';
import { MAX_BRANDS_PER_LIST } from '../../routines/domain/routine-rules';
import { ALERT_CONDITIONS, TARGET_PRICE_PATTERN } from '../domain/alert-rules';
import type { AlertCondition } from '../domain/alert-rules';

const RADIUS_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
const toInt = ({ value }: { value: unknown }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/**
 * Campos editables de una alerta. `whitelist` + `forbidNonWhitelisted` rechazan `userId` y
 * cualquier campo extra: la dueña es siempre la persona del token. Formato acá; reglas
 * (objetivo según condición, unidad del genérico, moneda) en el dominio, sobre el resultado.
 */
class AlertFieldsDto {
  /** Presentación preferida; `null` la quita (cualquiera del genérico). */
  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @IsOptionalNotNull()
  @IsBoolean()
  allowSubstitutes?: boolean;

  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_BRANDS_PER_LIST)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  excludedBrands?: string[];

  /** Precio por unidad base (KG, L o UNIT) en pesos; `null` al pasar a otra condición. */
  @IsOptional()
  @IsString()
  @Matches(TARGET_PRICE_PATTERN)
  targetUnitPrice?: string | null;

  @IsOptional()
  @IsIn(BASE_UNITS as readonly string[])
  targetUnit?: 'KG' | 'L' | 'UNIT' | null;

  /** Solo `ARS` por ahora; otra moneda es `400 CURRENCY_NOT_SUPPORTED`. */
  @IsOptionalNotNull()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  /** 0,1 a 100 km; `null` usa el radio de las preferencias. */
  @IsOptional()
  @IsString()
  @Matches(RADIUS_PATTERN)
  radiusKm?: string | null;

  @IsOptionalNotNull()
  @IsBoolean()
  active?: boolean;
}

export class CreatePriceAlertDto extends AlertFieldsDto {
  @IsUUID()
  canonicalProductId!: string;

  @IsIn(ALERT_CONDITIONS as readonly string[])
  condition!: AlertCondition;
}

/** El genérico no se cambia (borrar y crear otra); la condición sí, con su objetivo coherente. */
export class UpdatePriceAlertDto extends AlertFieldsDto {
  @IsOptionalNotNull()
  @IsIn(ALERT_CONDITIONS as readonly string[])
  condition?: AlertCondition;
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  cursor?: string;

  /** `true` = solo los no leídos. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;
}
