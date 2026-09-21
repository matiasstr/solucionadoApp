import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_RADIUS_KM } from '../../stores/domain/geo';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Alcance de una consulta de precios: por coordenadas + radio, o por localidad.
 * Los dos caminos son excluyentes y el radio exige coordenadas (se valida en el caso de uso).
 */
export class ProductPricesQueryDto {
  @IsOptional()
  @Transform(toNumber)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.1)
  @Max(MAX_RADIUS_KM)
  radiusKm?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  province?: string;

  /** Por defecto se incluyen los precios viejos, marcados con su fecha. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeStale?: boolean;
}
