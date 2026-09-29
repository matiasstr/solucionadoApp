import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { GetDashboardUseCase } from '../application/get-dashboard.use-case';
import type { DashboardDto } from './dashboard.contracts';

/** `GET /dashboard`: resumen privado del usuario del token. */
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: GetDashboardUseCase) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthenticatedUser): Promise<DashboardDto> {
    return this.dashboard.execute(user.id);
  }
}
