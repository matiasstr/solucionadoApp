import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../common/public-http.exception';
import { API_CONFIG } from '../../config/environment';
import type { ApiConfig } from '../../config/environment';
import { isPrismaError } from '../../database/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { toUserProfile } from '../users/user-profile';
import type { UserProfile } from '../users/user-profile';
import { AccessTokenService } from './access-token.service';
import type { LoginDto, RegisterDto } from './auth.dto';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password-hasher';
import { hashRefreshToken, newRefreshToken } from './refresh-token';

export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly user: UserProfile;
  /** Solo para la cookie HttpOnly; nunca en el cuerpo de la respuesta ni en logs. */
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

const invalidCredentials = () =>
  new PublicHttpException(401, 'INVALID_CREDENTIALS', 'El email o la contraseña no son correctos.');
const invalidSession = () =>
  new PublicHttpException(401, 'SESSION_EXPIRED', 'Tu sesión terminó. Volvé a iniciar sesión.');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async register(dto: RegisterDto): Promise<IssuedSession> {
    const passwordHash = await hashPassword(dto.password);
    // La carrera entre dos registros se resuelve con el índice único (lower(email)).
    const user = await this.prisma.user.create({ data: { email: dto.email, passwordHash } }).catch((error: unknown) => {
      if (isPrismaError(error, 'P2002')) {
        throw new PublicHttpException(409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese email.');
      }
      throw error;
    });
    return this.openSession(user.id);
  }

  async login(dto: LoginDto): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = user ? await verifyPassword(user.passwordHash, dto.password) : await verifyAgainstDummy(dto.password);
    if (!user || !valid) throw invalidCredentials();
    return this.openSession(user.id);
  }

  /**
   * Rotación atómica: solo un pedido puede consumir un refresh vigente (UPDATE condicional).
   * Presentar un token ya rotado es reutilización: se revoca toda la familia. Dos refresh
   * simultáneos con el mismo token cuentan como reutilización; el cliente debe serializarlos.
   */
  async refresh(rawToken: string | undefined): Promise<IssuedSession> {
    if (!rawToken) throw invalidSession();
    const tokenHash = hashRefreshToken(rawToken);
    const now = new Date();
    const next = newRefreshToken();
    const refreshExpiresAt = this.refreshExpiry(now);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshSession.updateMany({
        where: { tokenHash, rotatedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { rotatedAt: now },
      });
      if (consumed.count !== 1) return null;
      const current = await tx.refreshSession.findUniqueOrThrow({ where: { tokenHash } });
      const successor = await tx.refreshSession.create({
        data: {
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: hashRefreshToken(next),
          expiresAt: refreshExpiresAt,
          createdAt: now,
        },
      });
      await tx.refreshSession.update({ where: { id: current.id }, data: { replacedById: successor.id } });
      return tx.user.findUniqueOrThrow({ where: { id: current.userId } });
    });

    if (!rotated) {
      const existing = await this.prisma.refreshSession.findUnique({ where: { tokenHash } });
      if (existing?.rotatedAt) await this.revokeFamily(existing.familyId, now);
      throw invalidSession();
    }
    return this.issue(rotated.id, toUserProfile(rotated), next, refreshExpiresAt);
  }

  /** Revoca la familia del token presentado. Idempotente: sin cookie o token desconocido no falla. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash: hashRefreshToken(rawToken) } });
    if (session) await this.revokeFamily(session.familyId, new Date());
  }

  private async openSession(userId: string): Promise<IssuedSession> {
    const now = new Date();
    const token = newRefreshToken();
    const refreshExpiresAt = this.refreshExpiry(now);
    await this.prisma.refreshSession.create({
      data: { userId, tokenHash: hashRefreshToken(token), expiresAt: refreshExpiresAt, createdAt: now },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.issue(userId, toUserProfile(user), token, refreshExpiresAt);
  }

  private async issue(userId: string, user: UserProfile, refreshToken: string, refreshExpiresAt: Date) {
    return {
      accessToken: await this.accessTokens.sign(userId),
      expiresIn: this.config.auth.accessTtlSeconds,
      user,
      refreshToken,
      refreshExpiresAt,
    };
  }

  private refreshExpiry(now: Date): Date {
    return new Date(now.getTime() + this.config.auth.refreshTtlDays * 86_400_000);
  }

  private async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
  }
}
