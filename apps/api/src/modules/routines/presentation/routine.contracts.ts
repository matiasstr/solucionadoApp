/**
 * Contratos HTTP privados de rutinas (P4-01). Se reflejan en `packages/shared`
 * para la web; si cambian, cambiar los dos y `docs/API.md`.
 */
import type { Prisma } from '../../../generated/prisma/client';
import { toQuantityString } from '../../catalog/infrastructure/decimal-mapper';
import type { BaseUnit, MeasurementUnit } from '../../catalog/domain/units';
import { effectiveSchedule } from '../domain/routine-rules';
import type { EffectiveSchedule } from '../domain/routine-rules';

export interface CanonicalSummaryDto {
  id: string;
  name: string;
  defaultUnit: BaseUnit;
}

export interface PreferredProductDto {
  id: string;
  name: string;
  brand: string | null;
  quantity: string;
  unit: MeasurementUnit;
}

export interface RoutineItemDto {
  id: string;
  routineId: string;
  canonicalProduct: CanonicalSummaryDto;
  preferredProduct: PreferredProductDto | null;
  /** Necesidad por ocurrencia, en la unidad del canónico. */
  quantity: string;
  unit: BaseUnit;
  /** Frecuencia aplicada: la propia del ítem o la heredada de la rutina. */
  schedule: EffectiveSchedule;
  allowSubstitutes: boolean;
  preferredBrands: string[];
  excludedBrands: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineDto {
  id: string;
  name: string;
  frequencyDays: number;
  anchorDate: string;
  items: RoutineItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineListDto {
  items: RoutineDto[];
}

export const routineItemInclude = {
  canonicalProduct: true,
  preferredProduct: true,
} satisfies Prisma.ShoppingRoutineItemInclude;

export const routineInclude = {
  items: {
    include: routineItemInclude,
    orderBy: [{ canonicalProduct: { normalizedName: 'asc' } }, { id: 'asc' }],
  },
} satisfies Prisma.ShoppingRoutineInclude;

type RoutineRow = Prisma.ShoppingRoutineGetPayload<{ include: typeof routineInclude }>;
type RoutineItemRow = Prisma.ShoppingRoutineItemGetPayload<{ include: typeof routineItemInclude }>;
type ScheduleRow = { frequencyDays: number; anchorDate: Date };

/** Columna `date`: Prisma la entrega como medianoche UTC. */
export const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);
export const fromCalendarDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

export function toRoutineItemDto(item: RoutineItemRow, routine: ScheduleRow): RoutineItemDto {
  const override = item.frequencyDays !== null && item.anchorDate !== null
    ? { frequencyDays: item.frequencyDays, anchorDate: toCalendarDate(item.anchorDate) }
    : null;
  const preferred = item.preferredProduct;
  return {
    id: item.id,
    routineId: item.routineId,
    canonicalProduct: {
      id: item.canonicalProduct.id,
      name: item.canonicalProduct.name,
      defaultUnit: item.canonicalProduct.defaultUnit,
    },
    preferredProduct: preferred
      ? {
          id: preferred.id,
          name: preferred.name,
          brand: preferred.brand,
          quantity: toQuantityString(preferred.quantity),
          unit: preferred.unit,
        }
      : null,
    quantity: toQuantityString(item.quantity),
    unit: item.unit,
    schedule: effectiveSchedule(
      { frequencyDays: routine.frequencyDays, anchorDate: toCalendarDate(routine.anchorDate) },
      override,
    ),
    allowSubstitutes: item.allowSubstitutes,
    preferredBrands: item.preferredBrands,
    excludedBrands: item.excludedBrands,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toRoutineDto(routine: RoutineRow): RoutineDto {
  return {
    id: routine.id,
    name: routine.name,
    frequencyDays: routine.frequencyDays,
    anchorDate: toCalendarDate(routine.anchorDate),
    items: routine.items.map((item) => toRoutineItemDto(item, routine)),
    createdAt: routine.createdAt.toISOString(),
    updatedAt: routine.updatedAt.toISOString(),
  };
}
