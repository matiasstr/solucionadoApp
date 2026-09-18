import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
    // Secreto y opciones se pasan por llamada desde AccessTokenService.
    JwtModule.register({}),
    // Almacenamiento en memoria: válido para una instancia. Con varias réplicas, mover a Redis (P8).
    ThrottlerModule.forRootAsync({
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => [{ ttl: 60_000, limit: config.auth.rateLimitPerMinute }],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenService, JwtAuthGuard, OriginGuard],
  exports: [AccessTokenService, JwtAuthGuard],
})
export class AuthModule {}
