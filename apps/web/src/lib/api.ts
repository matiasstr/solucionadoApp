import type { ApiErrorBody } from '@tusofertas/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
  }
}

const unavailable = (status: number) =>
  new ApiError(status, 'SERVICE_UNAVAILABLE', 'No pudimos conectar con el servicio. Probá de nuevo en unos minutos.');

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null
    && typeof (value as ApiErrorBody).error === 'string' && typeof (value as ApiErrorBody).message === 'string';
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  accessToken?: string;
  /** Para cancelar una consulta que quedó vieja (búsqueda mientras se escribe). */
  signal?: AbortSignal;
  /** Cabeceras propias del pedido, por ejemplo `Idempotency-Key` al generar un plan. */
  headers?: Record<string, string>;
}

/**
 * Cliente de la API en el mismo origen (/api, vía rewrite de Next). El header
 * X-Requested-With es la protección CSRF que exige /auth (ADR 0003).
 */
export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, accessToken, signal, headers }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...headers,
        'X-Requested-With': 'tusofertas-web',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // Una consulta cancelada no es una falla del servicio: la propaga tal cual.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw unavailable(0);
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;
  if (response.status < 500 && isErrorBody(data)) {
    throw new ApiError(response.status, data.error, data.message, data.fields ?? []);
  }
  throw unavailable(response.status);
}
