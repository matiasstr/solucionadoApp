import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { API_CONFIG } from './environment';
import type { ApiConfig } from './environment';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: API_CONFIG, useValue: config }], exports: [API_CONFIG] };
  }
}
