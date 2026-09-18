import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { JsonLogger } from './common/json-logger';
import type { ApiConfig } from './config/environment';

export async function createApp(
  config: ApiConfig,
  logger = new JsonLogger(),
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger, abortOnError: false });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();
  return app;
}
