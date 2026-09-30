import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { rethrowRuleErrors } from '../../../common/rule-errors';
import { PrismaService } from '../../../database/prisma.service';
import { baseUnitOf } from '../../catalog/domain/units';
import type { BaseUnit } from '../../catalog/domain/units';
import { normalizeBrandList } from '../../routines/domain/routine-rules';
import { ALERT_CURRENCY, AlertRuleError, assertAlertRule, MAX_ALERT_RULES_PER_USER } from '../domain/alert-rules';
import type { AlertRuleShape } from '../domain/alert-rules';
import { alertInclude, toPriceAlertDto } from '../presentation/alert.contracts';
import type { PriceAlertDto } from '../presentation/alert.contracts';
import type { CreatePriceAlertDto, UpdatePriceAlertDto } from '../presentation/alerts.dto';

/** Ajena o inexistente responden igual: no se revela que el id existe. */
const alertNotFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos esa alerta.');
const asRuleError = rethrowRuleErrors([AlertRuleError]);

/**
 * Alertas de precio con ownership (P9-01, ADR 0022). Toda consulta y mutación filtra por el
 * usuario del token. Cada edición sube la revisión (el job no aplica una evaluación hecha sobre
 * una versión anterior) y vuelve a habilitar el aviso.
 */
@Injectable()
export class PriceAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<PriceAlertDto[]> {
    const rows = await this.prisma.priceAlertRule.findMany({
      where: { userId },
      include: alertInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toPriceAlertDto);
  }

  async create(userId: string, dto: CreatePriceAlertDto): Promise<PriceAlertDto> {
    const canonical = await this.prisma.canonicalProduct.findUnique({ where: { id: dto.canonicalProductId }, select: { id: true, defaultUnit: true } });
    if (!canonical) {
      throw new PublicHttpException(400, 'CANONICAL_NOT_FOUND', 'Ese producto no existe en el catálogo.', ['canonicalProductId']);
    }
    const shape: AlertRuleShape = {
      condition: dto.condition,
      targetUnitPrice: dto.targetUnitPrice ?? null,
      targetUnit: dto.targetUnit ?? null,
      currency: dto.currency ?? ALERT_CURRENCY,
      allowSubstitutes: dto.allowSubstitutes ?? true,
      productId: dto.productId ?? null,
      radiusKm: dto.radiusKm ?? null,
    };
    this.validate(shape, canonical.defaultUnit);
    if (shape.productId) await this.assertProduct(shape.productId, canonical);

    const row = await this.prisma.$transaction(async (tx) => {
      // Bloquea la fila del usuario para que dos altas simultáneas no pasen el límite.
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if ((await tx.priceAlertRule.count({ where: { userId } })) >= MAX_ALERT_RULES_PER_USER) {
        throw new PublicHttpException(409, 'ALERT_LIMIT', `Podés tener hasta ${MAX_ALERT_RULES_PER_USER} alertas.`);
      }
      return tx.priceAlertRule.create({
        data: {
          userId,
          canonicalProductId: canonical.id,
          productId: shape.productId,
          allowSubstitutes: shape.allowSubstitutes,
          excludedBrands: normalizeBrandList(dto.excludedBrands ?? []),
          condition: shape.condition,
          targetUnitPrice: shape.targetUnitPrice,
          targetUnit: shape.targetUnit,
          currency: ALERT_CURRENCY,
          radiusKm: shape.radiusKm,
          active: dto.active ?? true,
        },
        include: alertInclude,
      });
    });
    return toPriceAlertDto(row);
  }

  /** Las reglas se evalúan sobre el resultado: no se puede, por ejemplo, quitar el objetivo de una alerta de precio. */
  async update(userId: string, alertId: string, dto: UpdatePriceAlertDto): Promise<PriceAlertDto> {
    const current = await this.prisma.priceAlertRule.findFirst({
      where: { id: alertId, userId },
      include: { canonicalProduct: { select: { id: true, defaultUnit: true } } },
    });
    if (!current) throw alertNotFound();
    const shape: AlertRuleShape = {
      condition: dto.condition ?? current.condition,
      targetUnitPrice: dto.targetUnitPrice === undefined ? (current.targetUnitPrice?.toFixed(2) ?? null) : dto.targetUnitPrice,
      targetUnit: dto.targetUnit === undefined ? current.targetUnit : dto.targetUnit,
      currency: dto.currency ?? current.currency,
      allowSubstitutes: dto.allowSubstitutes ?? current.allowSubstitutes,
      productId: dto.productId === undefined ? current.productId : dto.productId,
      radiusKm: dto.radiusKm === undefined ? (current.radiusKm?.toString() ?? null) : dto.radiusKm,
    };
    this.validate(shape, current.canonicalProduct.defaultUnit);
    if (dto.productId) await this.assertProduct(dto.productId, current.canonicalProduct);

    // Solo si la regla sigue siendo de este usuario; `revision` avisa al job que la versión cambió.
    const { count } = await this.prisma.priceAlertRule.updateMany({
      where: { id: alertId, userId },
      data: {
        productId: shape.productId,
        allowSubstitutes: shape.allowSubstitutes,
        excludedBrands: dto.excludedBrands === undefined ? undefined : normalizeBrandList(dto.excludedBrands),
        condition: shape.condition,
        targetUnitPrice: shape.targetUnitPrice,
        targetUnit: shape.targetUnit,
        radiusKm: shape.radiusKm,
        active: dto.active,
        revision: { increment: 1 },
        notifiedUnitPrice: null,
      },
    });
    if (count === 0) throw alertNotFound();
    return this.get(userId, alertId);
  }

  /** Los avisos ya emitidos quedan en la bandeja, sin la regla. */
  async remove(userId: string, alertId: string): Promise<void> {
    const { count } = await this.prisma.priceAlertRule.deleteMany({ where: { id: alertId, userId } });
    if (count === 0) throw alertNotFound();
  }

  private async get(userId: string, alertId: string): Promise<PriceAlertDto> {
    const row = await this.prisma.priceAlertRule.findFirst({ where: { id: alertId, userId }, include: alertInclude });
    if (!row) throw alertNotFound();
    return toPriceAlertDto(row);
  }

  private validate(shape: AlertRuleShape, canonicalUnit: BaseUnit): void {
    try {
      assertAlertRule(shape, canonicalUnit);
    } catch (error: unknown) {
      asRuleError(error);
    }
  }

  private async assertProduct(productId: string, canonical: { id: string; defaultUnit: BaseUnit }): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { canonicalProductId: true, unit: true, isActive: true } });
    if (!product || !product.isActive || product.canonicalProductId !== canonical.id || baseUnitOf(product.unit) !== canonical.defaultUnit) {
      throw new PublicHttpException(
        400,
        'PREFERRED_PRODUCT_INVALID',
        'La presentación tiene que ser un producto disponible de ese mismo genérico.',
        ['productId'],
      );
    }
  }
}
