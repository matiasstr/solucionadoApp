import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricesModule } from '../prices/prices.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { StoresModule } from '../stores/stores.module';
import { BenefitUsageService } from './application/benefit-usage.service';
import { EvaluateBenefitsUseCase } from './application/evaluate-benefits.use-case';
import { BenefitsController, BenefitUsageController } from './presentation/benefits.controller';

/**
 * Beneficios de pago (P10-01, ADR 0023): evaluación de canastas con el motor puro de
 * `promotions/domain/benefit-engine.ts` y el consumo de topes informado. Solo lo importa la raíz.
 */
@Module({
  imports: [AuthModule, CatalogModule, PricesModule, PromotionsModule, StoresModule],
  controllers: [BenefitsController, BenefitUsageController],
  providers: [EvaluateBenefitsUseCase, BenefitUsageService],
  exports: [EvaluateBenefitsUseCase],
})
export class BenefitsModule {}
