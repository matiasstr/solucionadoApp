import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { PrismaService } from '../../../database/prisma.service';
import { DecimalValue } from '../../catalog/domain/decimal';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import { capKeyOf, capPeriodKey } from '../../promotions/domain/benefit-engine';
import type { PromotionRule } from '../../promotions/domain/promotion.types';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import { argentineToday, parseCalendarDate, RoutineRuleError } from '../../routines/domain/routine-rules';
import { argentineNoon } from '../../shopping-plans/domain/plan-calendar';

export interface BenefitUsageEntryDto {
  readonly capKey: string;
  readonly periodKey: string;
  readonly consumed: string;
  readonly updatedAt: string;
}

export interface InformedUsageDto extends BenefitUsageEntryDto {
  readonly promotion: { readonly id: string; readonly name: string; readonly capGroup: string | null };
  readonly limit: string;
  /** Lo que queda del tope después de lo informado (nunca negativo). */
  readonly remaining: string;
}

const promotionNotFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos esa promoción.');

/**
 * Consumo de topes informado por la persona (P10-01, ADR 0023). Un tope de semana, mes o
 * campaña se comparte con compras hechas fuera de la app: sin este dato el beneficio queda
 * condicionado. Borrar el dato vuelve a "desconocido". Solo pesos usados, nunca datos de la tarjeta.
 */
@Injectable()
export class BenefitUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionRepository,
  ) {}

  async list(userId: string): Promise<BenefitUsageEntryDto[]> {
    const rows = await this.prisma.benefitCapUsage.findMany({ where: { userId }, orderBy: [{ capKey: 'asc' }, { periodKey: 'desc' }] });
    return rows.map((row) => ({ capKey: row.capKey, periodKey: row.periodKey, consumed: toAmountString(row.consumed, 2), updatedAt: row.updatedAt.toISOString() }));
  }

  async inform(userId: string, promotionId: string, consumed: string, date: string | undefined, now = new Date()): Promise<InformedUsageDto> {
    const { rule, capKey, periodKey } = await this.locate(promotionId, date, now);
    const row = await this.prisma.benefitCapUsage.upsert({
      where: { userId_capKey_periodKey: { userId, capKey, periodKey } },
      create: { userId, capKey, periodKey, consumed },
      update: { consumed },
    });
    const remaining = DecimalValue.parse(rule.discountCap as string).subtract(DecimalValue.parse(toAmountString(row.consumed, 2)));
    return {
      capKey,
      periodKey,
      consumed: toAmountString(row.consumed, 2),
      updatedAt: row.updatedAt.toISOString(),
      promotion: { id: rule.id, name: rule.name, capGroup: rule.capGroup },
      limit: rule.discountCap as string,
      remaining: remaining.isNegative() ? '0.00' : remaining.toFixed(2),
    };
  }

  /** Idempotente: borrar un dato que no estaba también deja el tope como desconocido. */
  async forget(userId: string, promotionId: string, date: string | undefined, now = new Date()): Promise<void> {
    const { capKey, periodKey } = await this.locate(promotionId, date, now);
    await this.prisma.benefitCapUsage.deleteMany({ where: { userId, capKey, periodKey } });
  }

  private async locate(promotionId: string, date: string | undefined, now: Date): Promise<{ rule: PromotionRule; capKey: string; periodKey: string }> {
    const day = date ?? argentineToday(now);
    try {
      parseCalendarDate(day, 'date');
    } catch (error: unknown) {
      if (error instanceof RoutineRuleError) throw new PublicHttpException(400, 'DATE_INVALID', 'La fecha debe ser un día real con formato AAAA-MM-DD.', ['date']);
      throw error;
    }
    const rule = await this.promotions.findById(promotionId);
    if (!rule) throw promotionNotFound();
    if (!rule.discountCap || !rule.capPeriod || rule.capPeriod === 'PURCHASE') {
      throw new PublicHttpException(400, 'CAP_NOT_TRACKABLE', 'Esa promoción no tiene un tope que se comparta entre compras.', ['promotionId']);
    }
    return { rule, capKey: capKeyOf(rule), periodKey: capPeriodKey(rule, argentineNoon(day), 'informado') };
  }
}
