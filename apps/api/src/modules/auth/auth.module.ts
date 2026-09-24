import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { API_CONFIG } from '../../config/environment';
import type { ApiConfig } from '../../config/environment';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OriginGuard } from './origin.guard';

@Module({
  imports: [
    // Almacenamiento en memoria: válido para una instancia. Con varias réplicas, mover a Redis (P8).
    ThrottlerModule.forRootAsync({
      inject: [API_CONFIG],
      // Refresh corre en cada carga de la web: 6× el límite de login/registro.
      useFactory: (config: ApiConfig) => [{
        ttl: 60_000,
        limit: (context) => config.auth.rateLimitPerMinute * (context.getHandler().name === 'refresh' ? 6 : 1),
      }],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenService, JwtAuthGuard, OriginGuard],
  exports: [AccessTokenService, JwtAuthGuard],
})
export class AuthModule {}
