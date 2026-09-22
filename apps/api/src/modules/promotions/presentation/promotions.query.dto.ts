import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { PROMOTION_TYPES } from '../domain/promotion.types';

const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Filtros de promociones. Por defecto solo se listan las vigentes **ahora**:
 * mostrar una promoción vencida como si estuviera activa sería engañoso.
 * `activeAt` permite consultar otro instante e `includeInactive` ver todas.
 */
export class ListPromotionsQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  chainId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  canonicalProductId?: string;

  @IsOptional()
  @IsIn(PROMOTION_TYPES as readonly string[])
  type?: string;

  /** Instante de referencia en ISO 8601; por defecto, ahora. */
  @IsOptional()
  @IsISO8601()
  activeAt?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeInactive?: boolean;

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
