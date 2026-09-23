import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../common/public-http.exception';
import { rethrowRuleErrors, rethrowUniqueAs } from '../../common/rule-errors';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NeedQuantityError, toCanonicalQuantity } from '../catalog/domain/need-quantity';
import type { CanonicalQuantity } from '../catalog/domain/need-quantity';
import { toQuantityString } from '../catalog/infrastructure/decimal-mapper';
import type { BaseUnit } from '../catalog/domain/units';
import type { CanonicalSummaryDto } from '../routines/presentation/routine.contracts';
import type { CreateInventoryDto, SetInventoryQuantityDto } from './inventory.dto';

/** Contrato reflejado en `packages/shared`. */
export interface InventoryItemDto {
  id: string;
  canonicalProduct: CanonicalSummaryDto;
  /** Saldo aproximado en la unidad del canónico; no son lotes ni vencimientos. */
  quantity: string;
  unit: BaseUnit;
  updatedAt: string;
}

export interface InventoryListDto {
  items: InventoryItemDto[];
}

const include = { canonicalProduct: true } satisfies Prisma.UserInventoryInclude;
type InventoryRow = Prisma.UserInventoryGetPayload<{ include: typeof include }>;

const notFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto en tu despensa.');
const asRuleError = rethrowRuleErrors([NeedQuantityError]);

const toDto = (row: InventoryRow): InventoryItemDto => ({
  id: row.id,
  canonicalProduct: {
    id: row.canonicalProduct.id,
    name: row.canonicalProduct.name,
    defaultUnit: row.canonicalProduct.defaultUnit,
  },
  quantity: toQuantityString(row.quantity),
  unit: row.unit,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Despensa del usuario (P4-01): una fila por canónico, en su unidad. Registrar
 * un saldo no consume ni acredita nada; el consumo entre registros no se asume.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<InventoryItemDto[]> {
    const rows = await this.prisma.userInventory.findMany({
      where: { userId },
      include,
      orderBy: [{ canonicalProduct: { normalizedName: 'asc' } }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(userId: string, dto: CreateInventoryDto): Promise<InventoryItemDto> {
    const canonical = await this.prisma.canonicalProduct.findUnique({
      where: { id: dto.canonicalProductId },
      select: { id: true, defaultUnit: true },
    });
    if (!canonical) {
      throw new PublicHttpException(400, 'CANONICAL_NOT_FOUND', 'Ese producto no existe en el catálogo.', [
        'canonicalProductId',
      ]);
    }
    const normalized = normalize(dto, canonical.defaultUnit);
    const row = await this.prisma.userInventory.create({
      data: { userId, canonicalProductId: canonical.id, ...normalized },
      include,
    }).catch(rethrowUniqueAs(new PublicHttpException(
      409,
      'INVENTORY_DUPLICATE',
      'Ese producto ya está en tu despensa: actualizá la cantidad existente.',
      ['canonicalProductId'],
    )));
    return toDto(row);
  }

  async update(userId: string, id: string, dto: SetInventoryQuantityDto): Promise<InventoryItemDto> {
    const current = await this.prisma.userInventory.findFirst({
      where: { id, userId },
      select: { id: true, canonicalProduct: { select: { defaultUnit: true } } },
    });
    if (!current) throw notFound();
    const row = await this.prisma.userInventory.update({
      where: { id: current.id },
      data: normalize(dto, current.canonicalProduct.defaultUnit),
      include,
    });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.userInventory.deleteMany({ where: { id, userId } });
    if (count === 0) throw notFound();
  }
}

function normalize(dto: SetInventoryQuantityDto, canonicalUnit: BaseUnit): CanonicalQuantity {
  try {
    return toCanonicalQuantity(dto, canonicalUnit, { allowZero: true });
  } catch (error: unknown) {
    return asRuleError(error);
  }
}
