import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/rule-errors';
import { MEASUREMENT_UNITS } from '../../catalog/domain/units';
import { MAX_BRANDS_PER_LIST, MAX_FREQUENCY_DAYS } from '../domain/routine-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Cantidad como texto decimal (ADR 0002): hasta 6 decimales para admitir gramos y mililitros. */
export const QUANTITY_PATTERN = /^\d{1,10}(\.\d{1,6})?$/;
/** Formato; que el día exista lo valida el dominio. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DTOs de rutinas. `whitelist` + `forbidNonWhitelisted` rechazan `userId`,
 * `routineId` y cualquier campo extra: la propiedad sale del token, nunca del cuerpo.
 */
export class CreateRoutineDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** 7 por defecto (semanal). */
  @IsOptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(MAX_FREQUENCY_DAYS)
  frequencyDays?: number;

  /** Hoy en Argentina por defecto. */
  @IsOptionalNotNull()
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  anchorDate?: string;
}

export class UpdateRoutineDto {
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(MAX_FREQUENCY_DAYS)
  frequencyDays?: number;

  @IsOptionalNotNull()
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  anchorDate?: string;
}

class RoutineItemFieldsDto {
  /** `null` borra el preferido. */
  @IsOptional()
  @IsUUID()
  preferredProductId?: string | null;

  /** `null` junto con `anchorDate: null` vuelve a heredar la frecuencia de la rutina. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_FREQUENCY_DAYS)
  frequencyDays?: number | null;

  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  anchorDate?: string | null;

  @IsOptionalNotNull()
  @IsBoolean()
  allowSubstitutes?: boolean;

  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_BRANDS_PER_LIST)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  preferredBrands?: string[];

  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_BRANDS_PER_LIST)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  excludedBrands?: string[];
}

export class CreateRoutineItemDto extends RoutineItemFieldsDto {
  @IsUUID()
  canonicalProductId!: string;

  /** Cantidad por ocurrencia, en cualquier unidad de la dimensión del canónico. */
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;

  @IsIn(MEASUREMENT_UNITS as readonly string[])
  unit!: string;
}

/** El canónico identifica al ítem y no se cambia: se borra y se agrega otro. */
export class UpdateRoutineItemDto extends RoutineItemFieldsDto {
  @IsOptionalNotNull()
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity?: string;

  @IsOptionalNotNull()
  @IsIn(MEASUREMENT_UNITS as readonly string[])
  unit?: string;
}
