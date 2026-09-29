import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { PrismaService } from '../../../database/prisma.service';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import { optimizePlan } from '../domain/plan-optimizer';
import type { OptimizedPlan, OptimizerSettings } from '../domain/optimized-plan.types';
import type { PlanCandidates } from '../domain/planner.types';
import { BuildPlanCandidatesUseCase } from './build-plan-candidates.use-case';
import type { PlanCandidatesQuery } from './build-plan-candidates.use-case';

/** Entrada y resultado del cálculo: lo que P5-03 guarda como snapshot del plan. */
export interface ShoppingPlanComputation {
  readonly candidates: PlanCandidates;
  readonly plan: OptimizedPlan;
}

/**
 * Calcula el plan de un usuario (P5-02): candidatos de P5-01 más las
 * penalidades y el máximo de sucursales de sus preferencias, optimizados por el
 * dominio puro. No guarda nada: la persistencia y los endpoints son P5-03.
 */
@Injectable()
export class PlanShoppingUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: BuildPlanCandidatesUseCase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(userId: string, query: PlanCandidatesQuery = {}): Promise<ShoppingPlanComputation> {
    const candidates = await this.candidates.execute(userId, query);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { storeVisitPenalty: true, distancePenaltyPerKm: true, maxStoresPerShoppingPlan: true },
    });
    if (!user) throw new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');
    const settings: OptimizerSettings = {
      storeVisitPenalty: toAmountString(user.storeVisitPenalty, 2),
      distancePenaltyPerKm: toAmountString(user.distancePenaltyPerKm, 2),
      maxStores: user.maxStoresPerShoppingPlan,
      maxCombinations: this.config.planner.maxCombinations,
    };
    return { candidates, plan: optimizePlan(candidates, settings) };
  }
}
