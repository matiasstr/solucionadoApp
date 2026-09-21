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
import { MAX_RADIUS_KM } from '../domain/geo';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;

/** Filtros de sucursales. Con `latitude`/`longitude` la búsqueda pasa a ser por cercanía. */
export class ListStoresQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  search?: string;

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
}
