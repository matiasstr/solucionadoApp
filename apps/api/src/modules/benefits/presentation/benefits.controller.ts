import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { CurrentUser, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { BenefitUsageService } from '../application/benefit-usage.service';
import type { BenefitUsageEntryDto, InformedUsageDto } from '../application/benefit-usage.service';
import { EvaluateBenefitsUseCase } from '../application/evaluate-benefits.use-case';
import type { BenefitsEvaluationDto } from '../application/evaluate-benefits.use-case';
import { BenefitUsageDto, BenefitUsageQueryDto, EvaluateBenefitsDto } from './benefits.dto';

/** Evaluación de beneficios de una canasta (P10-01): privada, con las preferencias del token. */
@Controller('benefits')
@UseGuards(JwtAuthGuard)
export class BenefitsController {
  constructor(private readonly evaluate: EvaluateBenefitsUseCase) {}

  @Post('evaluate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  run(@CurrentUser() user: AuthenticatedUser, @Body() dto: EvaluateBenefitsDto): Promise<BenefitsEvaluationDto> {
    return this.evaluate.execute(user.id, dto);
  }
}

/** Lo usado de cada tope fuera de la app, informado por la persona (P10-01). */
@Controller('benefit-usage')
@UseGuards(JwtAuthGuard)
export class BenefitUsageController {
  constructor(private readonly usage: BenefitUsageService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<{ items: BenefitUsageEntryDto[] }> {
    return { items: await this.usage.list(user.id) };
  }

  @Put(':promotionId')
  @Header('Cache-Control', 'no-store')
  inform(@CurrentUser() user: AuthenticatedUser, @Param('promotionId') promotionId: string, @Body() dto: BenefitUsageDto): Promise<InformedUsageDto> {
    return this.usage.inform(user.id, requireUuid(promotionId, 'promotionId'), dto.consumed, dto.date);
  }

  @Delete(':promotionId')
  @HttpCode(204)
  forget(@CurrentUser() user: AuthenticatedUser, @Param('promotionId') promotionId: string, @Query() query: BenefitUsageQueryDto): Promise<void> {
    return this.usage.forget(user.id, requireUuid(promotionId, 'promotionId'), query.date);
  }
}
