import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { rethrowRuleErrors } from '../../../common/rule-errors';
import { isPrismaError } from '../../../database/prisma-errors';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { argentineToday } from '../../routines/domain/routine-rules';
import { assertTransition, effectiveStatus, PlanStatusError } from '../domain/plan-status';
import type { RequestedPlanStatus } from '../domain/plan-status';
import { toPlanRecord } from '../domain/plan-snapshot';
import {
  fromCalendarDate,
  planInclude,
  toCalendarDate,
  toPlanDto,
  toPlanSummaryDto,
} from '../presentation/shopping-plan.contracts';
import type { PlanRow, ShoppingPlanDto, ShoppingPlanSummaryDto } from '../presentation/shopping-plan.contracts';
import type { GeneratePlanDto } from '../presentation/shopping-plans.dto';
import { PlanShoppingUseCase } from './plan-shopping.use-case';

/** Token opaco del cliente: UUID u otro identificador de 8 a 80 caracteres seguros. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const DEFAULT_LIST_LIMIT = 20;

const planNotFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese plan.');
const asRuleError = rethrowRuleErrors([PlanStatusError]);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export interface GeneratedPlan {
  /** `false` si la clave ya se había usado: el reintento devuelve el plan guardado. */
  readonly created: boolean;
  readonly plan: ShoppingPlanDto;
}

/**
 * Planes guardados (P5-03, ADR 0015). Toda lectura y escritura filtra por el
 * usuario del token; un plan ajeno responde igual que uno inexistente. Generar
 * no descuenta la despensa ni registra una compra.
 */
@Injectable()
export class ShoppingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: PlanShoppingUseCase,
  ) {}

  async generate(userId: string, dto: GeneratePlanDto, idempotencyKey: string | undefined): Promise<GeneratedPlan> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new PublicHttpException(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Falta la cabecera Idempotency-Key (8 a 80 letras, números, guiones o guiones bajos).',
        ['Idempotency-Key'],
      );
    }
    const replay = await this.findByKey(userId, idempotencyKey);
    if (replay) return { created: false, plan: this.replayOf(replay, dto) };

    const { candidates, plan } = await this.planner.execute(userId, { startDate: dto.startDate, endDate: dto.endDate });
    const record = toPlanRecord(candidates, plan);
    try {
      const row = await this.prisma.shoppingPlan.create({
        data: {
          userId,
          idempotencyKey,
          startDate: fromCalendarDate(record.startDate),
          endDate: fromCalendarDate(record.endDate),
          estimatedRegularCost: record.estimatedRegularCost,
          optimizedCost: record.optimizedCost,
          estimatedSavings: record.estimatedSavings,
          storeVisitPenaltyCost: record.storeVisitPenaltyCost,
          distancePenaltyCost: record.distancePenaltyCost,
          effectiveCost: record.effectiveCost,
          totalDistanceKm: record.totalDistanceKm,
          optimizerVersion: record.optimizerVersion,
          baselineMethod: record.baselineMethod,
          inputSnapshot: json(record.inputSnapshot),
          resultSnapshot: json(record.resultSnapshot),
          unfulfilledNeeds: json(record.unfulfilledNeeds),
          generatedAt: new Date(candidates.generatedAt),
          items: {
            create: record.items.map((item) => ({
              canonicalProductId: item.canonicalProductId,
              productId: item.productId,
              storeId: item.storeId,
              productPriceId: item.productPriceId,
              promotionId: item.promotionId,
              neededQuantity: item.neededQuantity,
              quantity: item.quantity,
              unit: item.unit,
              packageCount: item.packageCount,
              price: item.price,
              estimatedRegularPrice: item.estimatedRegularPrice,
              estimatedSavings: item.estimatedSavings,
              recommendedDate: fromCalendarDate(item.recommendedDate),
              reason: item.reason,
              snapshot: json(item.snapshot),
            })),
          },
        },
        include: planInclude,
      });
      return { created: true, plan: toPlanDto(row, this.today()) };
    } catch (error: unknown) {
      // Dos pedidos simultáneos con la misma clave: gana el primero y el otro lo devuelve.
      if (!isPrismaError(error, 'P2002')) throw error;
      const winner = await this.findByKey(userId, idempotencyKey);
      if (!winner) throw error;
      return { created: false, plan: this.replayOf(winner, dto) };
    }
  }

  async list(userId: string, limit = DEFAULT_LIST_LIMIT): Promise<ShoppingPlanSummaryDto[]> {
    const rows = await this.prisma.shoppingPlan.findMany({
      where: { userId },
      omit: { inputSnapshot: true },
      include: { _count: { select: { items: true } } },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    const today = this.today();
    return rows.map((row) => toPlanSummaryDto(row, today));
  }

  async get(userId: string, planId: string): Promise<ShoppingPlanDto> {
    const row = await this.prisma.shoppingPlan.findFirst({ where: { id: planId, userId }, include: planInclude });
    if (!row) throw planNotFound();
    return toPlanDto(row, this.today());
  }

  async updateStatus(userId: string, planId: string, requested: RequestedPlanStatus): Promise<ShoppingPlanDto> {
    const today = this.today();
    await this.prisma.$transaction(async (tx) => {
      const plan = await tx.shoppingPlan.findFirst({
        where: { id: planId, userId },
        select: { status: true, startDate: true, endDate: true },
      });
      if (!plan) throw planNotFound();
      let write: boolean;
      try {
        write = assertTransition(effectiveStatus(plan.status, toCalendarDate(plan.endDate), today), requested);
      } catch (error: unknown) {
        return asRuleError(error);
      }
      if (!write) return;
      if (requested === 'ACTIVE') {
        // Un solo plan activo por período: el que se superponía vuelve a borrador.
        await tx.shoppingPlan.updateMany({
          where: {
            userId,
            status: 'ACTIVE',
            id: { not: planId },
            startDate: { lte: plan.endDate },
            endDate: { gte: plan.startDate },
          },
          data: { status: 'DRAFT' },
        });
      }
      const { count } = await tx.shoppingPlan.updateMany({
        where: { id: planId, userId, status: plan.status },
        data: { status: requested, ...(requested === 'COMPLETED' ? { completedAt: new Date() } : {}) },
      });
      if (count === 0) {
        throw new PublicHttpException(409, 'PLAN_STATUS_CHANGED', 'El plan cambió mientras tanto: recargalo y probá de nuevo.');
      }
    });
    return this.get(userId, planId);
  }

  private findByKey(userId: string, idempotencyKey: string): Promise<PlanRow | null> {
    return this.prisma.shoppingPlan.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: planInclude,
    });
  }

  /** La misma clave con otra ventana explícita es un error del cliente, no un reintento. */
  private replayOf(row: PlanRow, dto: GeneratePlanDto): ShoppingPlanDto {
    const differs =
      (dto.startDate !== undefined && dto.startDate !== toCalendarDate(row.startDate)) ||
      (dto.endDate !== undefined && dto.endDate !== toCalendarDate(row.endDate));
    if (differs) {
      throw new PublicHttpException(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Esa clave ya generó un plan para otras fechas: usá una clave nueva.',
        ['Idempotency-Key'],
      );
    }
    return toPlanDto(row, this.today());
  }

  private today(): string {
    return argentineToday(new Date());
  }
}
