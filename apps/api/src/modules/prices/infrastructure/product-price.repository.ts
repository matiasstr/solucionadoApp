import { Injectable } from '@nestjs/common';
import { isPrismaError } from '../../../database/prisma-errors';
import { PrismaService } from '../../../database/prisma.service';
import type { BaseUnit } from '../../catalog/domain/units';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import type { DecimalLike } from '../../catalog/infrastructure/decimal-mapper';
import type { CurrentPriceRecord, PriceObservationRecord } from '../domain/price-records';
import { PRICE_SCALE, UNIT_PRICE_SCALE } from '../domain/price-normalizer';

export interface PriceObservationInput {
  readonly productId: string;
  readonly storeId: string;
  /** Importes ya normalizados (normalizePrice): el repositorio no recalcula. */
  readonly price: string;
  readonly unitPrice: string;
  readonly unitPriceUnit: BaseUnit;
  readonly source: string;
  readonly idempotencyKey: string;
  readonly observedAt: Date;
  readonly importBatchId?: string | null;
  readonly currency?: string;
}

/**
 * `created`: observación nueva. `duplicate`: misma clave y mismo contenido (reintento).
 * `conflict`: misma clave con contenido distinto; no se sobrescribe y se devuelve lo guardado.
 */
export type RecordObservationStatus = 'created' | 'duplicate' | 'conflict';

export interface RecordObservationResult {
  readonly status: RecordObservationStatus;
  readonly observation: PriceObservationRecord;
}

export interface HistoryQuery {
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
}

interface ObservationRow {
  id: string;
  productId: string;
  storeId: string;
  price: DecimalLike;
  unitPrice: DecimalLike;
  unitPriceUnit: string;
  currency: string;
  source: string;
  idempotencyKey: string;
  importBatchId: string | null;
  observedAt: Date;
  ingestedAt: Date;
}

interface CurrentPriceRow {
  id: string;
  productId: string;
  storeId: string;
  price: string;
  unitPrice: string;
  unitPriceUnit: string;
  currency: string;
  source: string;
  observedAt: Date;
  ingestedAt: Date;
}

const toRecord = (row: ObservationRow): PriceObservationRecord => ({
  id: row.id,
  productId: row.productId,
  storeId: row.storeId,
  price: toAmountString(row.price, PRICE_SCALE),
  unitPrice: toAmountString(row.unitPrice, UNIT_PRICE_SCALE),
  unitPriceUnit: row.unitPriceUnit as BaseUnit,
  currency: row.currency,
  source: row.source,
  idempotencyKey: row.idempotencyKey,
  importBatchId: row.importBatchId,
  observedAt: row.observedAt,
  ingestedAt: row.ingestedAt,
});

const toCurrentRecord = (row: CurrentPriceRow): CurrentPriceRecord => ({
  id: row.id,
  productId: row.productId,
  storeId: row.storeId,
  price: row.price,
  unitPrice: row.unitPrice,
  unitPriceUnit: row.unitPriceUnit as BaseUnit,
  currency: row.currency,
  source: row.source,
  observedAt: row.observedAt,
  ingestedAt: row.ingestedAt,
});

/**
 * Historia de precios: solo inserta. Un trigger de la base rechaza UPDATE y DELETE,
 * así que un reintento nunca reescribe una observación anterior (docs/DOMAIN.md).
 */
@Injectable()
export class ProductPriceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: PriceObservationInput): Promise<RecordObservationResult> {
    const data = {
      productId: input.productId,
      storeId: input.storeId,
      price: input.price,
      unitPrice: input.unitPrice,
      unitPriceUnit: input.unitPriceUnit,
      currency: input.currency ?? 'ARS',
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      importBatchId: input.importBatchId ?? null,
      observedAt: input.observedAt,
    };
    try {
      const row = await this.prisma.productPrice.create({ data });
      return { status: 'created', observation: toRecord(row) };
    } catch (error: unknown) {
      if (!isPrismaError(error, 'P2002')) throw error;
      const existing = await this.prisma.productPrice.findUnique({
        where: { source_idempotencyKey: { source: input.source, idempotencyKey: input.idempotencyKey } },
      });
      // Carrera improbable: otro proceso pudo insertar y la fila ya no está visible acá.
      if (!existing) throw error;
      const observation = toRecord(existing);
      const sameContent =
        observation.productId === data.productId &&
        observation.storeId === data.storeId &&
        observation.price === data.price &&
        observation.unitPrice === data.unitPrice &&
        observation.unitPriceUnit === data.unitPriceUnit &&
        observation.currency === data.currency &&
        observation.observedAt.getTime() === data.observedAt.getTime();
      return { status: sameContent ? 'duplicate' : 'conflict', observation };
    }
  }

  /**
   * Carga masiva idempotente para el seed: omite claves ya presentes.
   * No detecta conflictos de contenido; los importadores (fase 7) usan `record`.
   */
  async recordMany(inputs: readonly PriceObservationInput[]): Promise<number> {
    if (!inputs.length) return 0;
    const result = await this.prisma.productPrice.createMany({
      data: inputs.map((input) => ({
        productId: input.productId,
        storeId: input.storeId,
        price: input.price,
        unitPrice: input.unitPrice,
        unitPriceUnit: input.unitPriceUnit,
        currency: input.currency ?? 'ARS',
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        importBatchId: input.importBatchId ?? null,
        observedAt: input.observedAt,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Precio actual por sucursal: la observación más reciente de cada una.
   * El desempate replica `compareObservations` (ADR 0008); `sourcePrecedence`
   * ordena fuentes con la misma fecha observada y las no listadas quedan al final.
   */
  async findCurrentByProduct(
    productId: string,
    options: { storeIds?: readonly string[]; sourcePrecedence?: readonly string[] } = {},
  ): Promise<CurrentPriceRecord[]> {
    return this.findCurrentByProducts([productId], options);
  }

  /**
   * Igual que `findCurrentByProduct` para varios productos en **una** consulta:
   * comparar alternativas de un canónico no debe disparar una consulta por producto.
   */
  async findCurrentByProducts(
    productIds: readonly string[],
    options: { storeIds?: readonly string[]; sourcePrecedence?: readonly string[] } = {},
  ): Promise<CurrentPriceRecord[]> {
    if (!productIds.length) return [];
    // Sin sucursales (o lista vacía) devuelve el precio actual de todas.
    const storeIds = options.storeIds?.length ? [...options.storeIds] : null;
    const precedence = [...(options.sourcePrecedence ?? [])];
    const products = [...productIds];
    const rows = await this.prisma.$queryRaw<CurrentPriceRow[]>`
      SELECT DISTINCT ON (p."productId", p."storeId")
        p."id"::text AS "id",
        p."productId"::text AS "productId",
        p."storeId"::text AS "storeId",
        p."price"::text AS "price",
        p."unitPrice"::text AS "unitPrice",
        p."unitPriceUnit"::text AS "unitPriceUnit",
        p."currency"::text AS "currency",
        p."source" AS "source",
        p."observedAt" AS "observedAt",
        p."ingestedAt" AS "ingestedAt"
      FROM "ProductPrice" p
      WHERE p."productId" = ANY (${products}::uuid[])
        AND (${storeIds}::uuid[] IS NULL OR p."storeId" = ANY (${storeIds}::uuid[]))
      ORDER BY
        p."productId",
        p."storeId",
        p."observedAt" DESC,
        array_position(${precedence}::text[], p."source") NULLS LAST,
        p."ingestedAt" DESC,
        p."source" ASC,
        p."id" ASC`;
    return rows.map(toCurrentRecord);
  }

  /** Historia de un producto en una sucursal, de la más reciente a la más antigua. */
  async findHistory(productId: string, storeId: string, query: HistoryQuery = {}): Promise<PriceObservationRecord[]> {
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) throw new RangeError('Límite inválido.');
    const rows = await this.prisma.productPrice.findMany({
      where: {
        productId,
        storeId,
        ...(query.from || query.to
          ? { observedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
      },
      orderBy: [{ observedAt: 'desc' }, { ingestedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  async countByProduct(productId: string): Promise<number> {
    return this.prisma.productPrice.count({ where: { productId } });
  }
}
