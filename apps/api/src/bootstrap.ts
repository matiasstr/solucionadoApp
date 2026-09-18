import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { JsonLogger } from './common/json-logger';
import { PublicHttpException } from './common/public-http.exception';
import { CSRF_HEADER } from './modules/auth/auth.constants';
import type { ApiConfig } from './config/environment';

export async function createApp(
  config: ApiConfig,
  logger = new JsonLogger(),
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), { logger, abortOnError: false });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // X-Requested-With es el header anti-CSRF exigido en /auth (ver ADR 0003).
    allowedHeaders: ['Content-Type', 'Authorization', CSRF_HEADER],
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => new PublicHttpException(
      400,
      'VALIDATION_FAILED',
      'Revisá los datos ingresados.',
      [...new Set(errors.map((error) => error.property))].sort(),
    ),
  }));
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();
  return app;
}
