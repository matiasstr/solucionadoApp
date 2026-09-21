import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';

/**
 * Filtros de consulta del catálogo. `whitelist` + `forbidNonWhitelisted` (bootstrap)
 * rechazan cualquier parámetro que no esté acá, así un filtro mal escrito falla
 * en vez de ignorarse en silencio.
 */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

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

export class ListProductsQueryDto extends PaginationQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  canonicalProductId?: string;
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
