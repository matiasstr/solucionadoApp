import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ApiConfig } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './modules/health/health.controller';

@Module({})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot(config.databaseUrl)],
      controllers: [HealthController],
    };
  }
}
