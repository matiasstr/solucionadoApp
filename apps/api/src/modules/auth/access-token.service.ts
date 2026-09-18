import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { API_CONFIG } from '../../config/environment';
import type { ApiConfig } from '../../config/environment';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Access JWT HS256 de vida corta. El cliente lo guarda solo en memoria. */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  sign(userId: string): Promise<string> {
    const { accessSecret, issuer, audience, accessTtlSeconds } = this.config.auth;
    return this.jwt.signAsync({ typ: 'access' }, {
      secret: accessSecret, algorithm: 'HS256', subject: userId, issuer, audience, expiresIn: accessTtlSeconds,
    });
  }

  /** Devuelve el userId si firma, algoritmo, issuer, audience y expiración son válidos. */
  async verify(token: string): Promise<string | null> {
    const { accessSecret, issuer, audience } = this.config.auth;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown; typ?: unknown }>(token, {
        secret: accessSecret, algorithms: ['HS256'], issuer, audience,
      });
      return payload.typ === 'access' && typeof payload.sub === 'string' && uuid.test(payload.sub)
        ? payload.sub
        : null;
    } catch {
      return null;
    }
  }
}
