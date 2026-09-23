import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { rethrowRuleErrors, rethrowUniqueAs } from '../../../common/rule-errors';
import { PrismaService } from '../../../database/prisma.service';
import { NeedQuantityError, toCanonicalQuantity } from '../../catalog/domain/need-quantity';
import { baseUnitOf } from '../../catalog/domain/units';
import type { BaseUnit } from '../../catalog/domain/units';
import {
  argentineToday,
  assertBrandsDisjoint,
  assertSubstitutionRule,
  MAX_ITEMS_PER_ROUTINE,
  MAX_ROUTINES_PER_USER,
  normalizeBrandList,
  parseCalendarDate,
  resolveScheduleOverride,
  RoutineRuleError,
  validateFrequencyDays,
} from '../domain/routine-rules';
import type { Schedule } from '../domain/routine-rules';
import {
  fromCalendarDate,
  routineInclude,
  routineItemInclude,
  toRoutineDto,
  toRoutineItemDto,
} from '../presentation/routine.contracts';
import type { RoutineDto, RoutineItemDto } from '../presentation/routine.contracts';
import type {
  CreateRoutineDto,
  CreateRoutineItemDto,
  UpdateRoutineDto,
  UpdateRoutineItemDto,
} from '../presentation/routines.dto';

/** Ajena o inexistente responden igual: no se revela que el id existe. */
const routineNotFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos esa rutina.');
const itemNotFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto en la rutina.');
const invalid = (error: string, message: string, fields: string[]) =>
  new PublicHttpException(400, error, message, fields);
const asRuleError = rethrowRuleErrors([RoutineRuleError, NeedQuantityError]);

/**
 * Rutinas de compra con ownership (P4-01). Toda consulta y mutación filtra por el
 * usuario del token; el id que envía el cliente nunca determina la propiedad,
 * tampoco en los ítems anidados (docs/DOMAIN.md, ADR 0011).
 */
@Injectable()
export class RoutinesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<RoutineDto[]> {
    const routines = await this.prisma.shoppingRoutine.findMany({
      where: { userId },
      include: routineInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return routines.map(toRoutineDto);
  }

  async get(userId: string, routineId: string): Promise<RoutineDto> {
    const routine = await this.prisma.shoppingRoutine.findFirst({
      where: { id: routineId, userId },
      include: routineInclude,
    });
    if (!routine) throw routineNotFound();
    return toRoutineDto(routine);
  }

  async create(userId: string, dto: CreateRoutineDto): Promise<RoutineDto> {
    const schedule = this.parseRoutineSchedule(dto.frequencyDays ?? 7, dto.anchorDate ?? argentineToday(new Date()));
    const routine = await this.prisma.$transaction(async (tx) => {
      // Bloquea la fila del usuario para que dos altas simultáneas no pasen el límite.
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if ((await tx.shoppingRoutine.count({ where: { userId } })) >= MAX_ROUTINES_PER_USER) {
        throw new PublicHttpException(409, 'ROUTINE_LIMIT', `Podés tener hasta ${MAX_ROUTINES_PER_USER} rutinas.`);
      }
      return tx.shoppingRoutine.create({
        data: {
          userId,
          name: dto.name,
          frequencyDays: schedule.frequencyDays,
          anchorDate: fromCalendarDate(schedule.anchorDate),
        },
        include: routineInclude,
      });
    });
    return toRoutineDto(routine);
  }

  async update(userId: string, routineId: string, dto: UpdateRoutineDto): Promise<RoutineDto> {
    const frequencyDays = dto.frequencyDays === undefined ? undefined : this.parseFrequency(dto.frequencyDays);
    const anchorDate = dto.anchorDate === undefined ? undefined : this.parseDate(dto.anchorDate);
    const { count } = await this.prisma.shoppingRoutine.updateMany({
      where: { id: routineId, userId },
      data: {
        name: dto.name,
        frequencyDays,
        anchorDate: anchorDate === undefined ? undefined : fromCalendarDate(anchorDate),
      },
    });
    if (count === 0) throw routineNotFound();
    return this.get(userId, routineId);
  }

  /** Borra la rutina y sus ítems (cascada). Inventario y planes emitidos no cambian. */
  async remove(userId: string, routineId: string): Promise<void> {
    const { count } = await this.prisma.shoppingRoutine.deleteMany({ where: { id: routineId, userId } });
    if (count === 0) throw routineNotFound();
  }

  async addItem(userId: string, routineId: string, dto: CreateRoutineItemDto): Promise<RoutineItemDto> {
    const canonical = await this.prisma.canonicalProduct.findUnique({
      where: { id: dto.canonicalProductId },
      select: { id: true, defaultUnit: true },
    });
    const preferredProductId = dto.preferredProductId ?? null;
    const allowSubstitutes = dto.allowSubstitutes ?? true;
    const preferredBrands = normalizeBrandList(dto.preferredBrands ?? []);
    const excludedBrands = normalizeBrandList(dto.excludedBrands ?? []);

    // La rutina se verifica antes que el cuerpo: sobre una rutina ajena no se informa nada más.
    await this.findOwnedRoutine(userId, routineId);
    if (!canonical) throw invalid('CANONICAL_NOT_FOUND', 'Ese producto no existe en el catálogo.', ['canonicalProductId']);
    const { quantity, unit, override } = this.applyRules(() => {
      const normalized = toCanonicalQuantity({ quantity: dto.quantity, unit: dto.unit }, canonical.defaultUnit, {
        allowZero: false,
      });
      assertBrandsDisjoint(preferredBrands, excludedBrands);
      assertSubstitutionRule(allowSubstitutes, preferredProductId);
      return { ...normalized, override: resolveScheduleOverride(dto.frequencyDays ?? null, dto.anchorDate ?? null) };
    });
    if (preferredProductId) await this.assertPreferredProduct(preferredProductId, canonical);

    const item = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ShoppingRoutine" WHERE "id" = ${routineId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
      if (owned.length === 0) throw routineNotFound();
      if ((await tx.shoppingRoutineItem.count({ where: { routineId } })) >= MAX_ITEMS_PER_ROUTINE) {
        throw new PublicHttpException(409, 'ROUTINE_ITEM_LIMIT', `Una rutina admite hasta ${MAX_ITEMS_PER_ROUTINE} productos.`);
      }
      return tx.shoppingRoutineItem.create({
        data: {
          routineId,
          canonicalProductId: canonical.id,
          preferredProductId,
          quantity,
          unit,
          frequencyDays: override?.frequencyDays ?? null,
          anchorDate: override ? fromCalendarDate(override.anchorDate) : null,
          allowSubstitutes,
          preferredBrands,
          excludedBrands,
        },
        include: { ...routineItemInclude, routine: true },
      });
    }).catch(rethrowUniqueAs(new PublicHttpException(
      409,
      'ROUTINE_ITEM_DUPLICATE',
      'Ese producto ya está en la rutina: editá la cantidad existente.',
      ['canonicalProductId'],
    )));
    return toRoutineItemDto(item, item.routine);
  }

  async updateItem(
    userId: string,
    routineId: string,
    itemId: string,
    dto: UpdateRoutineItemDto,
  ): Promise<RoutineItemDto> {
    const current = await this.findOwnedItem(userId, routineId, itemId);
    if ((dto.quantity === undefined) !== (dto.unit === undefined)) {
      throw invalid('VALIDATION_FAILED', 'La cantidad y su unidad se envían juntas.', ['quantity', 'unit']);
    }

    const preferredProductId = dto.preferredProductId === undefined ? current.preferredProductId : dto.preferredProductId;
    const allowSubstitutes = dto.allowSubstitutes ?? current.allowSubstitutes;
    const preferredBrands = dto.preferredBrands ? normalizeBrandList(dto.preferredBrands) : current.preferredBrands;
    const excludedBrands = dto.excludedBrands ? normalizeBrandList(dto.excludedBrands) : current.excludedBrands;
    const scheduleSent = dto.frequencyDays !== undefined || dto.anchorDate !== undefined;
    const canonicalUnit = current.canonicalProduct.defaultUnit;

    const { normalized, override } = this.applyRules(() => {
      assertBrandsDisjoint(preferredBrands, excludedBrands);
      assertSubstitutionRule(allowSubstitutes, preferredProductId);
      return {
        normalized: dto.quantity !== undefined && dto.unit !== undefined
          ? toCanonicalQuantity({ quantity: dto.quantity, unit: dto.unit }, canonicalUnit, { allowZero: false })
          : null,
        // Frecuencia y ancla se reemplazan juntas (las dos `null` = heredar); omitir las dos deja la actual.
        override: scheduleSent ? resolveScheduleOverride(dto.frequencyDays ?? null, dto.anchorDate ?? null) : undefined,
      };
    });
    if (scheduleSent && (dto.frequencyDays === undefined || dto.anchorDate === undefined)) {
      throw invalid(
        'SCHEDULE_OVERRIDE_INCOMPLETE',
        'La frecuencia propia del producto necesita intervalo y fecha de inicio juntos.',
        ['frequencyDays', 'anchorDate'],
      );
    }
    // Solo se revalida un preferido nuevo: uno ya elegido y luego desactivado no bloquea editar la cantidad.
    if (dto.preferredProductId && dto.preferredProductId !== current.preferredProductId) {
      await this.assertPreferredProduct(dto.preferredProductId, { id: current.canonicalProductId, defaultUnit: canonicalUnit });
    }

    const item = await this.prisma.shoppingRoutineItem.update({
      where: { id: current.id },
      data: {
        preferredProductId,
        allowSubstitutes,
        preferredBrands,
        excludedBrands,
        ...(normalized ? { quantity: normalized.quantity, unit: normalized.unit } : {}),
        ...(override !== undefined
          ? {
              frequencyDays: override?.frequencyDays ?? null,
              anchorDate: override ? fromCalendarDate(override.anchorDate) : null,
            }
          : {}),
      },
      include: { ...routineItemInclude, routine: true },
    });
    return toRoutineItemDto(item, item.routine);
  }

  async removeItem(userId: string, routineId: string, itemId: string): Promise<void> {
    const { count } = await this.prisma.shoppingRoutineItem.deleteMany({
      where: { id: itemId, routineId, routine: { userId } },
    });
    if (count === 0) throw itemNotFound();
  }

  private async findOwnedRoutine(userId: string, routineId: string): Promise<void> {
    const routine = await this.prisma.shoppingRoutine.findFirst({ where: { id: routineId, userId }, select: { id: true } });
    if (!routine) throw routineNotFound();
  }

  /** El ítem debe pertenecer a esa rutina y la rutina al usuario: un ítem propio bajo una rutina ajena es 404. */
  private async findOwnedItem(userId: string, routineId: string, itemId: string) {
    const item = await this.prisma.shoppingRoutineItem.findFirst({
      where: { id: itemId, routineId, routine: { userId } },
      include: { canonicalProduct: { select: { defaultUnit: true } } },
    });
    if (!item) throw itemNotFound();
    return item;
  }

  /** El preferido pertenece al canónico, comparte su dimensión y sigue a la venta. */
  private async assertPreferredProduct(productId: string, canonical: { id: string; defaultUnit: BaseUnit }): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { canonicalProductId: true, unit: true, isActive: true },
    });
    if (
      !product ||
      !product.isActive ||
      product.canonicalProductId !== canonical.id ||
      baseUnitOf(product.unit) !== canonical.defaultUnit
    ) {
      throw invalid(
        'PREFERRED_PRODUCT_INVALID',
        'El producto preferido tiene que ser una presentación disponible de ese mismo producto.',
        ['preferredProductId'],
      );
    }
  }

  private parseRoutineSchedule(frequencyDays: number, anchorDate: string): Schedule {
    return { frequencyDays: this.parseFrequency(frequencyDays), anchorDate: this.parseDate(anchorDate) };
  }

  private parseFrequency(value: number): number {
    return this.applyRules(() => validateFrequencyDays(value));
  }

  private parseDate(value: string): string {
    return this.applyRules(() => parseCalendarDate(value));
  }

  private applyRules<T>(rules: () => T): T {
    try {
      return rules();
    } catch (error: unknown) {
      return asRuleError(error);
    }
  }
}
