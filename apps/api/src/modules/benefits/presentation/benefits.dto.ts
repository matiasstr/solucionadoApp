import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';

/** Cantidad como texto decimal: unidades enteras para envasados, unidad base para venta por peso. */
const QUANTITY_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const MAX_BENEFIT_PURCHASES = 10;
export const MAX_BENEFIT_LINES = 100;

export class BenefitLineDto {
  @IsUUID()
  productId!: string;

  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;
}

export class BenefitPurchaseDto {
  @IsUUID()
  storeId!: string;

  /** Día de la compra en Argentina: vigencia, día de la semana y período de los topes. */
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BenefitLineDto)
  lines!: BenefitLineDto[];
}

/**
 * Canasta a evaluar (P10-01): hasta 10 compras y 100 líneas en total. Se usan los precios
 * actuales de cada sucursal y las preferencias de pago declaradas por la persona del token.
 */
export class EvaluateBenefitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BENEFIT_PURCHASES)
  @ValidateNested({ each: true })
  @Type(() => BenefitPurchaseDto)
  purchases!: BenefitPurchaseDto[];
}

/** Lo ya usado de un tope fuera de la app, en el período que contiene `date` (hoy por defecto). */
export class BenefitUsageDto {
  @IsString()
  @Matches(AMOUNT_PATTERN)
  consumed!: string;

  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date?: string;
}

export class BenefitUsageQueryDto {
  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date?: string;
}
