import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { CurrentUser, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { NotificationsService } from '../application/notifications.service';
import { PriceAlertsService } from '../application/price-alerts.service';
import { MAX_ALERT_RULES_PER_USER } from '../domain/alert-rules';
import type { NotificationDto, NotificationPageDto, PriceAlertDto, PriceAlertListDto } from './alert.contracts';
import { CreatePriceAlertDto, ListNotificationsQueryDto, UpdatePriceAlertDto } from './alerts.dto';

/** Alertas de precio privadas (P9-01): requieren sesión y solo ven las del usuario del token. */
@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alerts: PriceAlertsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<PriceAlertListDto> {
    return { items: await this.alerts.list(user.id), limit: MAX_ALERT_RULES_PER_USER };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePriceAlertDto): Promise<PriceAlertDto> {
    return this.alerts.create(user.id, dto);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePriceAlertDto): Promise<PriceAlertDto> {
    return this.alerts.update(user.id, requireUuid(id), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.alerts.remove(user.id, requireUuid(id));
  }
}

/** Bandeja de avisos dentro de la app (P9-01). Ningún aviso sale de la app todavía. */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto): Promise<NotificationPageDto> {
    return this.notifications.list(user.id, query);
  }

  @Patch(':id/read')
  @Header('Cache-Control', 'no-store')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<NotificationDto> {
    return this.notifications.markRead(user.id, requireUuid(id));
  }
}
