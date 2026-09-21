import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, keysetFilter, toPage } from '../../../common/pagination';
import type { KeysetCursor, PageResult } from '../../../common/pagination';
import { PrismaService } from '../../../database/prisma.service';
import type { CanonicalProductRecord } from '../domain/catalog-records';
import { normalizeName } from '../domain/naming';
import type { BaseUnit } from '../domain/units';

export interface CanonicalProductSearchQuery {
  readonly term?: string;
  readonly categoryId?: string;
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
}

export interface CanonicalProductInput {
  /** Id estable provisto por el seed o el importador. */
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly defaultUnit: BaseUnit;
}

interface CanonicalProductRow {
  id: string;
  name: string;
  normalizedName: string;
  categoryId: string;
  defaultUnit: string;
}

const toRecord = (row: CanonicalProductRow): CanonicalProductRecord => ({
  id: row.id,
  name: row.name,
  normalizedName: row.normalizedName,
  categoryId: row.categoryId,
  defaultUnit: row.defaultUnit as BaseUnit,
});

/**
 * Producto canónico: agrupa alternativas aceptables para una misma necesidad.
 * Pertenecer al mismo canónico no afirma que dos productos sean idénticos.
 */
@Injectable()
export class CanonicalProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<CanonicalProductRecord | null> {
    const row = await this.prisma.canonicalProduct.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listByCategory(categoryId: string, limit = 50): Promise<CanonicalProductRecord[]> {
    const rows = await this.prisma.canonicalProduct.findMany({
      where: { categoryId },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  async searchByName(term: string, limit = 20): Promise<CanonicalProductRecord[]> {
    const normalized = normalizeName(term, 200);
    if (!normalized) return [];
    const rows = await this.prisma.canonicalProduct.findMany({
      where: { normalizedName: { contains: normalized } },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  /** Búsqueda paginada por cursor con orden estable `(normalizedName, id)`. */
  async search(query: CanonicalProductSearchQuery): Promise<PageResult<CanonicalProductRecord>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const term = query.term ? normalizeName(query.term, 200) : '';
    const rows = await this.prisma.canonicalProduct.findMany({
      where: {
        ...(term ? { normalizedName: { contains: term } } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...keysetFilter('normalizedName', query.cursor ?? null),
      },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return toPage(rows.map(toRecord), limit, (canonical) => ({ key: canonical.normalizedName, id: canonical.id }));
  }

  async upsert(input: CanonicalProductInput): Promise<CanonicalProductRecord> {
    const data = {
      name: input.name,
      normalizedName: normalizeName(input.name, 200),
      categoryId: input.categoryId,
      defaultUnit: input.defaultUnit,
    };
    const row = await this.prisma.canonicalProduct.upsert({
      where: { id: input.id },
      create: { id: input.id, ...data },
      update: data,
    });
    return toRecord(row);
  }
}
