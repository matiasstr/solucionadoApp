import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PricesModule } from '../prices/prices.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { StoresModule } from '../stores/stores.module';
import { BuildPlanCandidatesUseCase } from './application/build-plan-candidates.use-case';

/**
 * Planificador (fase 5). P5-01: necesidades y candidatos, sin endpoints todavía;
 * el optimizador (P5-02) y las rutas `/shopping-plans` (P5-03) se suman acá.
 * Compone catálogo, precios, comercios y promociones; nadie lo importa, así que
 * no forma ciclos.
 */
@Module({
  imports: [CatalogModule, PricesModule, StoresModule, PromotionsModule],
  providers: [BuildPlanCandidatesUseCase],
  exports: [BuildPlanCandidatesUseCase],
})
export class ShoppingPlansModule {}
