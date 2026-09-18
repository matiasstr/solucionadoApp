import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { API_CONFIG } from '../../config/environment';
import type { ApiConfig } from '../../config/environment';
import type { UserProfile } from '../users/user-profile';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';
import type { IssuedSession } from './auth.service';
import { OriginGuard } from './origin.guard';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-token';

interface SessionResponse {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly user: UserProfile;
}

/** Rate limit por IP antes de todo; luego CSRF (Origin + header). */
@Controller('auth')
@UseGuards(ThrottlerGuard, OriginGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response): Promise<SessionResponse> {
    return this.respond(response, await this.auth.register(dto));
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response): Promise<SessionResponse> {
    return this.respond(response, await this.auth.login(dto));
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<SessionResponse> {
    try {
      return this.respond(response, await this.auth.refresh(readRefreshCookie(request)));
    } catch (error) {
      clearRefreshCookie(response, this.config);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(request));
    clearRefreshCookie(response, this.config);
  }

  private respond(response: Response, session: IssuedSession): SessionResponse {
    setRefreshCookie(response, this.config, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken, tokenType: 'Bearer', expiresIn: session.expiresIn, user: session.user };
  }
}
