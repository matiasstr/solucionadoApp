import { Transform } from 'class-transformer';
import {
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
import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from '../domain/search-term';
import { MAX_RADIUS_KM } from '../../stores/domain/geo';

/**
 * Filtros de consulta del catálogo. `whitelist` + `forbidNonWhitelisted` (bootstrap)
 * rechazan cualquier parámetro que no esté acá, así un filtro mal escrito falla
 * en vez de ignorarse en silencio.
 */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;

class PaginationQuery {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  /** Cursor opaco devuelto por la página anterior. */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  cursor?: string;
}

/**
 * Búsqueda de productos: texto libre (nombre, marca o EAN), filtros de catálogo y
 * de dónde se consigue. Coordenadas y radio acotan por cercanía real; ciudad y
 * provincia, por localidad.
 */
export class ListProductsQueryDto extends PaginationQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(MIN_SEARCH_LENGTH)
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  canonicalProductId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsUUID()
  chainId?: string;

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
}

export class ListCanonicalProductsQueryDto extends PaginationQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
