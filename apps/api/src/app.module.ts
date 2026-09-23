import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import type { ApiConfig } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthController } from './modules/health/health.controller';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PricesModule } from './modules/prices/prices.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { RoutinesModule } from './modules/routines/routines.module';
import { SearchModule } from './modules/search/search.module';
import { StoresModule } from './modules/stores/stores.module';
import { UsersModule } from './modules/users/users.module';

@Module({})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(config.databaseUrl),
        AuthModule,
        UsersModule,
        CatalogModule,
        StoresModule,
        PricesModule,
        PromotionsModule,
        SearchModule,
        RoutinesModule,
        InventoryModule,
      ],
      controllers: [HealthController],
    };
  }
}
