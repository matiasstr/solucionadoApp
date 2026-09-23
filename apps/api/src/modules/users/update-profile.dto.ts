import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalNotNull } from '../../common/rule-errors';
import { PaymentMethod } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry)) : value;

/**
 * Preferencias editables. `whitelist` + `forbidNonWhitelisted` rechazan email, passwordHash,
 * id y cualquier otro campo (sin mass assignment). `null` borra un campo opcional.
 * Decimales como string para no pasar por `number` binario (ADR 0002).
 * `maxStoresPerShoppingPlan: null` es "sin límite" (inequívoco: cero no es válido);
 * las columnas no nulas usan `@IsOptionalNotNull` para que `null` sea 400 y no 500.
 */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  province?: string | null;

  // Latitud y longitud se envían juntas; el rango se valida en el servicio y en SQL.
  @IsOptional()
  @Matches(/^-?\d{1,2}(\.\d{1,6})?$/)
  latitude?: string | null;

  @IsOptional()
  @Matches(/^-?\d{1,3}(\.\d{1,6})?$/)
  longitude?: string | null;

  // Rango 0,1 a 100 km, el mismo que `radiusKm` en la API pública; se valida en el servicio.
  @IsOptionalNotNull()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/)
  maxTravelDistanceKm?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxStoresPerShoppingPlan?: number | null;

  @IsOptionalNotNull()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  storeVisitPenalty?: string;

  @IsOptionalNotNull()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  distancePenaltyPerKm?: string;

  @IsOptionalNotNull()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PaymentMethod, { each: true })
  paymentMethods?: PaymentMethod[];

  @IsOptionalNotNull()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  banks?: string[];

  @IsOptionalNotNull()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  membershipPrograms?: string[];
}
