import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricesModule } from '../prices/prices.module';
import { StoresModule } from '../stores/stores.module';
import { EvaluatePriceAlertsUseCase } from './application/evaluate-price-alerts.use-case';
import { NotificationsService } from './application/notifications.service';
import { PriceAlertsService } from './application/price-alerts.service';
import { AlertsController, NotificationsController } from './presentation/alerts.controller';

/**
 * Alertas de precio y bandeja de avisos (P9-01, ADR 0022). La evaluación la corre el job
 * `CHECK_PRICE_ALERTS` en el worker; el API solo administra reglas y avisos. Solo lo importan
 * la raíz y el worker, así que no forma ciclos.
 */
@Module({
  imports: [AuthModule, CatalogModule, PricesModule, StoresModule],
  controllers: [AlertsController, NotificationsController],
  providers: [PriceAlertsService, NotificationsService, EvaluatePriceAlertsUseCase],
  exports: [EvaluatePriceAlertsUseCase],
})
export class AlertsModule {}
