import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../../config/environment';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';

/** 256 bits aleatorios. Solo viaja en la cookie; en DB se guarda su hash. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 alcanza: el token es aleatorio de alta entropía, no una contraseña. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === REFRESH_COOKIE) {
      const value = part.slice(index + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}

function cookieOptions(config: ApiConfig) {
  return {
    httpOnly: true,
    secure: config.auth.secureCookies,
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(response: Response, config: ApiConfig, token: string, expiresAt: Date): void {
  response.cookie(REFRESH_COOKIE, token, { ...cookieOptions(config), expires: expiresAt });
}

export function clearRefreshCookie(response: Response, config: ApiConfig): void {
  response.clearCookie(REFRESH_COOKIE, cookieOptions(config));
}
