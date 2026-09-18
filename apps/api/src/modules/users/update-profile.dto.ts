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
import { PaymentMethod } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry)) : value;

/**
 * Preferencias editables. `whitelist` + `forbidNonWhitelisted` rechazan email, passwordHash,
 * id y cualquier otro campo (sin mass assignment). `null` borra un campo opcional.
 * Decimales como string para no pasar por `number` binario (ADR 0002).
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

  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/)
  maxTravelDistanceKm?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxStoresPerShoppingPlan?: number | null;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  storeVisitPenalty?: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  distancePenaltyPerKm?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PaymentMethod, { each: true })
  paymentMethods?: PaymentMethod[];

  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  banks?: string[];

  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  membershipPrograms?: string[];
}
