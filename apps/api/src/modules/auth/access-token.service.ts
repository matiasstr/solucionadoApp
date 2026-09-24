import { Inject, Injectable } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { API_CONFIG } from '../../config/environment';
import type { ApiConfig } from '../../config/environment';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Access JWT HS256 de vida corta. El cliente lo guarda solo en memoria.
 * Usa `jsonwebtoken` directamente (la misma biblioteca que envolvía `@nestjs/jwt`):
 * `@nestjs/jwt` 12 solo se publica como ES Module y el runtime de Vercel no lo
 * carga con `require` (ADR 0010).
 */
@Injectable()
export class AccessTokenService {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  sign(userId: string): Promise<string> {
    const { accessSecret, issuer, audience, accessTtlSeconds } = this.config.auth;
    return Promise.resolve(sign({ typ: 'access' }, accessSecret, {
      algorithm: 'HS256', subject: userId, issuer, audience, expiresIn: accessTtlSeconds,
    }));
  }

  /** Devuelve el userId si firma, algoritmo, issuer, audience y expiración son válidos. */
  verify(token: string): Promise<string | null> {
    const { accessSecret, issuer, audience } = this.config.auth;
    try {
      const payload = verify(token, accessSecret, { algorithms: ['HS256'], issuer, audience }) as JwtPayload | string;
      if (typeof payload === 'string') return Promise.resolve(null);
      return Promise.resolve(
        payload.typ === 'access' && typeof payload.sub === 'string' && uuid.test(payload.sub) ? payload.sub : null,
      );
    } catch {
      return Promise.resolve(null);
    }
  }
}
