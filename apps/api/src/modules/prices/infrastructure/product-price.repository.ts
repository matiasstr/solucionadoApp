import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { isPrismaError } from '../../../database/prisma-errors';
import { PrismaService } from '../../../database/prisma.service';
import type { BaseUnit } from '../../catalog/domain/units';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import type { DecimalLike } from '../../catalog/infrastructure/decimal-mapper';
import type { WindowStats } from '../domain/price-analysis';
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

/** Resultado de un lote de importación: nada se sobrescribe, cada fila se clasifica. */
export interface RecordBatchResult {
  readonly created: number;
  readonly duplicates: number;
  readonly conflicts: number;
}

type ObservationContent = Pick<PriceObservationInput, 'productId' | 'storeId' | 'price' | 'unitPrice' | 'unitPriceUnit' | 'observedAt'> & {
  readonly currency?: string;
};

/** Filas por INSERT: 11 parámetros cada una, lejos del tope de 65.535 de PostgreSQL. */
const INSERT_CHUNK = 1000;

const sameContent = (stored: ObservationContent, input: ObservationContent): boolean =>
  stored.productId === input.productId &&
  stored.storeId === input.storeId &&
  stored.price === input.price &&
  stored.unitPrice === input.unitPrice &&
  stored.unitPriceUnit === input.unitPriceUnit &&
  (stored.currency ?? 'ARS') === (input.currency ?? 'ARS') &&
  stored.observedAt.getTime() === input.observedAt.getTime();

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

/** Precio actual de una serie con el resumen de su ventana base, calculado en la base. */
export interface SeriesWindowRecord {
  readonly latest: PriceObservationRecord;
  /** Null si la serie no tiene cierres en la ventana. */
  readonly stats: WindowStats | null;
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
   * Lote de un importador (P7-01, ADR 0018): `INSERT … ON CONFLICT DO NOTHING RETURNING`
   * dice qué claves insertó este lote. El resto (ya guardado, o ganado por otro lote en
   * paralelo) se compara contra lo guardado: mismo contenido = `duplicate`, distinto =
   * `conflict`. Nunca se sobrescribe. Dentro del lote gana la primera fila de cada clave.
   */
  async recordBatch(inputs: readonly PriceObservationInput[]): Promise<RecordBatchResult> {
    let created = 0;
    let duplicates = 0;
    let conflicts = 0;
    const bySource = new Map<string, PriceObservationInput[]>();
    for (const input of inputs) {
      const group = bySource.get(input.source);
      if (group) group.push(input);
      else bySource.set(input.source, [input]);
    }

    for (const [source, group] of bySource) {
      const firsts = new Map<string, PriceObservationInput>();
      const repeats: PriceObservationInput[] = [];
      for (const input of group) {
        if (firsts.has(input.idempotencyKey)) repeats.push(input);
        else firsts.set(input.idempotencyKey, input);
      }

      const inserted = new Set<string>();
      const pending = [...firsts.values()];
      for (let start = 0; start < pending.length; start += INSERT_CHUNK) {
        const rows = pending.slice(start, start + INSERT_CHUNK).map(
          (input) => Prisma.sql`(gen_random_uuid(), ${input.productId}::uuid, ${input.storeId}::uuid, ${input.price}::numeric,
            ${input.unitPrice}::numeric, ${input.unitPriceUnit}::"BaseUnit", ${input.currency ?? 'ARS'}, ${input.source},
            ${input.idempotencyKey}, ${input.importBatchId ?? null}, ${input.observedAt}::timestamptz)`,
        );
        const returned = await this.prisma.$queryRaw<{ idempotencyKey: string }[]>`
          INSERT INTO "ProductPrice"
            ("id", "productId", "storeId", "price", "unitPrice", "unitPriceUnit", "currency", "source", "idempotencyKey", "importBatchId", "observedAt")
          VALUES ${Prisma.join(rows)}
          ON CONFLICT ("source", "idempotencyKey") DO NOTHING
          RETURNING "idempotencyKey"`;
        for (const row of returned) inserted.add(row.idempotencyKey);
      }
      created += inserted.size;

      const others = pending.filter((input) => !inserted.has(input.idempotencyKey));
      const stored = others.length
        ? new Map(
            (await this.prisma.productPrice.findMany({
              where: { source, idempotencyKey: { in: others.map((input) => input.idempotencyKey) } },
            })).map((row) => [row.idempotencyKey, toRecord(row)]),
          )
        : new Map<string, PriceObservationRecord>();
      for (const input of others) {
        const reference = stored.get(input.idempotencyKey);
        if (reference && sameContent(reference, input)) duplicates += 1;
        else conflicts += 1;
      }
      // Repetidas dentro del lote: se comparan con la guardada o con la primera del lote.
      for (const input of repeats) {
        const reference = stored.get(input.idempotencyKey) ?? firsts.get(input.idempotencyKey);
        if (reference && sameContent(reference, input)) duplicates += 1;
        else conflicts += 1;
      }
    }
    return { created, duplicates, conflicts };
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
    const storeIds = options.storeIds?.length ? [...new Set(options.storeIds)] : null;
    const precedence = [...(options.sourcePrecedence ?? [])];
    const products = [...new Set(productIds)];
    if (storeIds) {
      // Con sucursales conocidas (P10-02): la última observación de cada par por el índice
      // (productId, storeId, observedAt DESC), sin ordenar toda la historia. Mismo orden y desempate.
      const rows = await this.prisma.$queryRaw<CurrentPriceRow[]>`
        SELECT c.*
        FROM unnest(${products}::uuid[]) AS product("id")
        CROSS JOIN unnest(${storeIds}::uuid[]) AS store("id")
        CROSS JOIN LATERAL (
          SELECT
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
          WHERE p."productId" = product."id" AND p."storeId" = store."id"
          ORDER BY
            p."observedAt" DESC,
            array_position(${precedence}::text[], p."source") NULLS LAST,
            p."ingestedAt" DESC,
            p."source" ASC,
            p."id" ASC
          LIMIT 1
        ) c
        ORDER BY c."productId"::uuid, c."storeId"::uuid`;
      return rows.map(toCurrentRecord);
    }
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

  /**
   * Observaciones de uno o varios productos en `[from, until)` para el historial (P6-01),
   * en orden de serie (producto, sucursal, fuente) y fecha. `storeIds: null` = todas.
   * Devuelve hasta `limit + 1` filas: si vienen más de `limit`, quien llama decide.
   */
  async findBetween(
    productIds: readonly string[],
    query: { storeIds: readonly string[] | null; from: Date; until: Date; limit: number },
  ): Promise<PriceObservationRecord[]> {
    if (!productIds.length) return [];
    const rows = await this.prisma.productPrice.findMany({
      where: {
        productId: { in: [...productIds] },
        ...(query.storeIds ? { storeId: { in: [...query.storeIds] } } : {}),
        observedAt: { gte: query.from, lt: query.until },
      },
      orderBy: [{ productId: 'asc' }, { storeId: 'asc' }, { source: 'asc' }, { observedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    return rows.map(toRecord);
  }

  /**
   * Última observación de cada serie (producto + sucursal + fuente), en una consulta.
   * Mismo desempate que el precio actual: fecha observada, ingesta más reciente e id.
   */
  async findLatestPerSeries(
    productIds: readonly string[],
    storeIds: readonly string[] | null,
  ): Promise<PriceObservationRecord[]> {
    if (!productIds.length) return [];
    const products = [...productIds];
    const stores = storeIds ? [...storeIds] : null;
    const rows = await this.prisma.$queryRaw<(Omit<ObservationRow, 'price' | 'unitPrice'> & { price: string; unitPrice: string })[]>`
      SELECT DISTINCT ON (p."productId", p."storeId", p."source")
        p."id"::text AS "id",
        p."productId"::text AS "productId",
        p."storeId"::text AS "storeId",
        p."price"::text AS "price",
        p."unitPrice"::text AS "unitPrice",
        p."unitPriceUnit"::text AS "unitPriceUnit",
        p."currency"::text AS "currency",
        p."source" AS "source",
        p."idempotencyKey" AS "idempotencyKey",
        p."importBatchId" AS "importBatchId",
        p."observedAt" AS "observedAt",
        p."ingestedAt" AS "ingestedAt"
      FROM "ProductPrice" p
      WHERE p."productId" = ANY (${products}::uuid[])
        AND (${stores}::uuid[] IS NULL OR p."storeId" = ANY (${stores}::uuid[]))
      ORDER BY p."productId", p."storeId", p."source", p."observedAt" DESC, p."ingestedAt" DESC, p."id" ASC`;
    return rows.map((row) => ({ ...row, unitPriceUnit: row.unitPriceUnit as BaseUnit }));
  }

  /**
   * Precio actual de cada serie (producto + sucursal + fuente) observado desde `since`, con el
   * resumen de sus cierres diarios en la ventana base (P10-02): los `windowDays` días argentinos
   * anteriores al día de ese precio, dentro de `[windowStart, until)`. Mismo criterio que
   * `dailyCloses` + `summarizeCloses` (día argentino UTC−3, cierre = última observación con
   * desempate por ingesta e id, mínimo con el día más reciente), pero sin traer las
   * observaciones a memoria: una fila por serie, sin tope que deje series sin historia.
   */
  async findCurrentWithWindowStats(
    productIds: readonly string[],
    storeIds: readonly string[],
    query: { since: Date; windowStart: Date; until: Date; windowDays: number },
  ): Promise<SeriesWindowRecord[]> {
    if (!productIds.length || !storeIds.length) return [];
    const products = [...productIds];
    const stores = [...storeIds];
    const rows = await this.prisma.$queryRaw<
      (Omit<ObservationRow, 'price' | 'unitPrice'> & {
        price: string;
        unitPrice: string;
        daysWithData: number | null;
        observations: number | null;
        sum: string | null;
        lowest: string | null;
        lowestDate: string | null;
        highest: string | null;
      })[]
    >`
      WITH latest AS (
        SELECT DISTINCT ON (p."productId", p."storeId", p."source")
          p."id", p."productId", p."storeId", p."source", p."price", p."unitPrice", p."unitPriceUnit", p."currency",
          p."idempotencyKey", p."importBatchId", p."observedAt", p."ingestedAt",
          ((p."observedAt" AT TIME ZONE 'UTC') - interval '3 hours')::date AS "currentDay"
        FROM "ProductPrice" p
        WHERE p."productId" = ANY (${products}::uuid[])
          AND p."storeId" = ANY (${stores}::uuid[])
          AND p."observedAt" >= ${query.since}
        ORDER BY p."productId", p."storeId", p."source", p."observedAt" DESC, p."ingestedAt" DESC, p."id" ASC
      ),
      ranked AS (
        SELECT p."productId", p."storeId", p."source", d."day", p."unitPrice",
          row_number() OVER (
            PARTITION BY p."productId", p."storeId", p."source", d."day"
            ORDER BY p."observedAt" DESC, p."ingestedAt" DESC, p."id" ASC
          ) AS "position",
          count(*) OVER (PARTITION BY p."productId", p."storeId", p."source", d."day") AS "observations"
        FROM "ProductPrice" p
        JOIN latest l ON l."productId" = p."productId" AND l."storeId" = p."storeId" AND l."source" = p."source"
        CROSS JOIN LATERAL (SELECT ((p."observedAt" AT TIME ZONE 'UTC') - interval '3 hours')::date AS "day") d
        WHERE p."productId" = ANY (${products}::uuid[])
          AND p."storeId" = ANY (${stores}::uuid[])
          AND p."observedAt" >= ${query.windowStart}
          AND p."observedAt" < ${query.until}
          AND d."day" BETWEEN l."currentDay" - ${query.windowDays}::int AND l."currentDay" - 1
      ),
      closes AS (
        SELECT "productId", "storeId", "source", "day", "unitPrice", "observations",
          min("unitPrice") OVER (PARTITION BY "productId", "storeId", "source") AS "lowest"
        FROM ranked
        WHERE "position" = 1
      ),
      stats AS (
        SELECT "productId", "storeId", "source",
          count(*)::int AS "daysWithData",
          sum("observations")::int AS "observations",
          sum("unitPrice")::text AS "sum",
          min("unitPrice")::text AS "lowest",
          max("unitPrice")::text AS "highest",
          (max("day") FILTER (WHERE "unitPrice" = "lowest"))::text AS "lowestDate"
        FROM closes
        GROUP BY "productId", "storeId", "source"
      )
      SELECT
        l."id"::text AS "id",
        l."productId"::text AS "productId",
        l."storeId"::text AS "storeId",
        l."price"::text AS "price",
        l."unitPrice"::text AS "unitPrice",
        l."unitPriceUnit"::text AS "unitPriceUnit",
        l."currency"::text AS "currency",
        l."source" AS "source",
        l."idempotencyKey" AS "idempotencyKey",
        l."importBatchId" AS "importBatchId",
        l."observedAt" AS "observedAt",
        l."ingestedAt" AS "ingestedAt",
        s."daysWithData", s."observations", s."sum", s."lowest", s."lowestDate", s."highest"
      FROM latest l
      LEFT JOIN stats s ON s."productId" = l."productId" AND s."storeId" = l."storeId" AND s."source" = l."source"
      ORDER BY l."productId", l."storeId", l."source"`;
    return rows.map(({ daysWithData, observations, sum, lowest, lowestDate, highest, ...row }) => ({
      latest: { ...row, unitPriceUnit: row.unitPriceUnit as BaseUnit },
      stats:
        daysWithData && sum !== null && lowest !== null && lowestDate !== null && highest !== null
          ? { daysWithData, observations: observations ?? 0, sum, lowest, lowestDate, highest }
          : null,
    }));
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
