import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import { MEASUREMENT_UNITS } from '../catalog/domain/units';
import { QUANTITY_PATTERN } from '../routines/presentation/routines.dto';

/** Saldo aproximado de la despensa: cantidad y unidad siempre juntas. */
export class SetInventoryQuantityDto {
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;

  @IsIn(MEASUREMENT_UNITS as readonly string[])
  unit!: string;
}

export class CreateInventoryDto extends SetInventoryQuantityDto {
  @IsUUID()
  canonicalProductId!: string;
}
