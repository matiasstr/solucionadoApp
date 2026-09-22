import { Module } from '@nestjs/common';
import { PromotionRepository } from './infrastructure/promotion.repository';
import { PromotionsController } from './presentation/promotions.controller';

/**
 * Promociones simples (P2-03): reglas persistidas, calculador puro en el dominio
 * y listado público. El cálculo sobre una canasta llega con el planificador.
 */
@Module({
  controllers: [PromotionsController],
  providers: [PromotionRepository],
  exports: [PromotionRepository],
})
export class PromotionsModule {}
