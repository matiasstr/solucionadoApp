import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PublicHttpException } from '../../common/public-http.exception';
import { API_CONFIG } from '../../config/environment';
import type { ApiConfig } from '../../config/environment';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './auth.constants';

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * CSRF en /auth: exige Origin (o Referer) de la allowlist y el header personalizado,
 * que un formulario de otro sitio no puede enviar sin pasar el preflight CORS.
 * SameSite=Lax es una defensa adicional, no la única.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = originOf(request.headers.origin) ?? originOf(request.headers.referer);
    const header = request.headers[CSRF_HEADER.toLowerCase()];
    if (!origin || !this.config.corsOrigins.includes(origin) || header !== CSRF_HEADER_VALUE) {
      throw new PublicHttpException(403, 'CSRF_REJECTED', 'La solicitud no proviene de la aplicación.');
    }
    return true;
  }
}
