import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import type { ApiConfig } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthController } from './modules/health/health.controller';
import { PricesModule } from './modules/prices/prices.module';
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
      ],
      controllers: [HealthController],
    };
  }
}
