import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { JsonLogger } from './json-logger';
import { PublicHttpException } from './public-http.exception';

const publicErrors: Record<number, { error: string; message: string }> = {
  400: { error: 'BAD_REQUEST', message: 'La solicitud no es válida.' },
  401: { error: 'UNAUTHORIZED', message: 'Necesitás iniciar sesión.' },
  403: { error: 'FORBIDDEN', message: 'No tenés permiso para realizar esta acción.' },
  404: { error: 'NOT_FOUND', message: 'Recurso no encontrado.' },
  409: { error: 'CONFLICT', message: 'La solicitud entra en conflicto con el estado actual.' },
  413: { error: 'PAYLOAD_TOO_LARGE', message: 'La solicitud supera el tamaño permitido.' },
  429: { error: 'TOO_MANY_REQUESTS', message: 'Hay demasiadas solicitudes. Intentá más tarde.' },
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    if (exception instanceof PublicHttpException && statusCode < 500) {
      const { error, publicMessage: message, fields } = exception;
      response.status(statusCode).json({ statusCode, error, message, ...(fields?.length ? { fields } : {}) });
      return;
    }
    const body = statusCode >= 500
      ? { error: 'INTERNAL_SERVER_ERROR', message: 'Ocurrió un error interno.' }
      : publicErrors[statusCode] ?? { error: 'REQUEST_FAILED', message: 'No se pudo procesar la solicitud.' };

    if (statusCode >= 500) {
      this.logger.error({ event: 'request_failed', statusCode });
    }
    // No raw exception, URL, query string, body, credentials, or stack is returned/logged.
    response.status(statusCode).json({ statusCode, ...body });
  }
}
