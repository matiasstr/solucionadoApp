import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricesModule } from '../prices/prices.module';
import { StoresModule } from '../stores/stores.module';
import { GetDashboardUseCase } from './application/get-dashboard.use-case';
import { DashboardController } from './presentation/dashboard.controller';

/**
 * Dashboard (P6-02, ADR 0017): compone planes, rutinas y el análisis de precios.
 * Nadie lo importa, así que no forma ciclos.
 */
@Module({
  imports: [AuthModule, CatalogModule, PricesModule, StoresModule],
  controllers: [DashboardController],
  providers: [GetDashboardUseCase],
})
export class DashboardModule {}
