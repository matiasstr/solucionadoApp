import { Body, Controller, Get, Header, Headers, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { requireUuid } from '../../../common/query';
import { CurrentUser, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { ShoppingPlansService } from '../application/shopping-plans.service';
import type { ShoppingPlanDto, ShoppingPlanListDto } from './shopping-plan.contracts';
import { GeneratePlanDto, ListPlansQueryDto, UpdatePlanStatusDto } from './shopping-plans.dto';

/** Planes de compra privados: requieren sesión y solo ven los del usuario del token. */
@Controller('shopping-plans')
@UseGuards(JwtAuthGuard)
export class ShoppingPlansController {
  constructor(private readonly plans: ShoppingPlansService) {}

  /**
   * Genera y guarda un plan. `Idempotency-Key` es obligatoria: un reintento con la
   * misma clave devuelve el plan ya guardado con 200 en vez de crear otro (201).
   */
  @Post('generate')
  @Header('Cache-Control', 'no-store')
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GeneratePlanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ShoppingPlanDto> {
    const result = await this.plans.generate(user.id, dto, idempotencyKey);
    response.status(result.created ? 201 : 200);
    return result.plan;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPlansQueryDto): Promise<ShoppingPlanListDto> {
    return { items: await this.plans.list(user.id, query.limit) };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ShoppingPlanDto> {
    return this.plans.get(user.id, requireUuid(id));
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlanStatusDto,
  ): Promise<ShoppingPlanDto> {
    return this.plans.updateStatus(user.id, requireUuid(id), dto.status);
  }
}
