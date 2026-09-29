import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { IsOptionalNotNull } from '../../../common/rule-errors';
import { REQUESTED_PLAN_STATUSES } from '../domain/plan-status';

const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

/** Formato; que el día exista y el horizonte entre en el límite lo valida el dominio. */
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Ventana opcional: por defecto, siete días desde hoy en Argentina. */
export class GeneratePlanDto {
  @IsOptionalNotNull()
  @Matches(CALENDAR_DATE_PATTERN)
  startDate?: string;

  @IsOptionalNotNull()
  @Matches(CALENDAR_DATE_PATTERN)
  endDate?: string;
}

export class ListPlansQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

/** Solo los estados que el usuario puede pedir; `EXPIRED` depende de la fecha. */
export class UpdatePlanStatusDto {
  @IsIn(REQUESTED_PLAN_STATUSES as readonly string[])
  status!: 'ACTIVE' | 'COMPLETED';
}
