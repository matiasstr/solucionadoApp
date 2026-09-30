import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricesModule } from '../prices/prices.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { StoresModule } from '../stores/stores.module';
import { BuildPlanCandidatesUseCase } from './application/build-plan-candidates.use-case';
import { PlanShoppingUseCase } from './application/plan-shopping.use-case';
import { ShoppingPlansService } from './application/shopping-plans.service';
import { ShoppingPlansController } from './presentation/shopping-plans.controller';

/**
 * Planificador (fase 5). P5-01: necesidades y candidatos; P5-02: optimizador
 * (`PlanShoppingUseCase`); P5-03: planes guardados en `/shopping-plans`.
 * Compone catálogo, precios, comercios y promociones; solo lo importan la raíz y
 * el worker de jobs (P8-01), así que no forma ciclos.
 */
@Module({
  imports: [AuthModule, CatalogModule, PricesModule, StoresModule, PromotionsModule],
  controllers: [ShoppingPlansController],
  providers: [BuildPlanCandidatesUseCase, PlanShoppingUseCase, ShoppingPlansService],
  exports: [BuildPlanCandidatesUseCase, PlanShoppingUseCase, ShoppingPlansService],
})
export class ShoppingPlansModule {}
