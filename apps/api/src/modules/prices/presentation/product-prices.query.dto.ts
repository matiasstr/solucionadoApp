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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { MAX_RADIUS_KM } from '../../stores/domain/geo';

const PRICE_SORT_BY = ['UNIT_PRICE', 'PRICE', 'DISTANCE'] as const;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Historial (P6-01): una sucursal **o** una ubicación (coordenadas + radio, o
 * localidad), y un rango de días argentinos inclusivo. Sin rango: los últimos 30 días.
 */
export class PriceHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  /** Formato; que el día exista y el rango entre en el límite lo valida el caso de uso. */
  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN)
  from?: string;

  @IsOptional()
  @Matches(CALENDAR_DATE_PATTERN)
  to?: string;

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
}

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
