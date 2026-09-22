import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { MAX_RADIUS_KM } from '../../stores/domain/geo';

const PRICE_SORT_BY = ['UNIT_PRICE', 'PRICE', 'DISTANCE'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

/**
 * Alcance de una consulta de precios: por coordenadas + radio, o por localidad.
 * Los dos caminos son excluyentes y el radio exige coordenadas (se valida en el caso de uso).
 */
export class PricesQueryDto {
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

  /** Orden: por precio por unidad base (predeterminado), por envase o por distancia. */
  @IsOptional()
  @IsIn(PRICE_SORT_BY as readonly string[])
  sortBy?: string;
}

export class ProductPricesQueryDto extends PricesQueryDto {}

/** Comparación de alternativas: `productId` marca cuál es la coincidencia exacta. */
export class CanonicalPricesQueryDto extends PricesQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}
