import { createParamDecorator, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PublicHttpException } from '../../common/public-http.exception';
import { AccessTokenService } from './access-token.service';

export interface AuthenticatedUser {
  readonly id: string;
}

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

const unauthorized = () => new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(request.headers.authorization ?? '');
    const token = match?.[1];
    const userId = token ? await this.tokens.verify(token) : null;
    if (!userId) throw unauthorized();
    request.user = { id: userId };
    return true;
  }
}

/** Usuario del token validado. Nunca usar IDs del cuerpo o la URL para decidir ownership. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw unauthorized();
  return user;
});
