import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { CategoryRecord } from '../domain/catalog-records';
import { CatalogValidationError } from '../domain/catalog.errors';

/** Profundidad máxima al recorrer ancestros: evita bucles si hubiera datos corruptos. */
const MAX_TREE_DEPTH = 32;

export interface CategoryInput {
  /** Id estable provisto por el seed o el importador: hace la escritura idempotente. */
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId?: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

const toRecord = (row: CategoryRow): CategoryRecord => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  parentId: row.parentId,
});

/** Árbol de categorías. Los ciclos se evitan en la aplicación: SQL solo impide `parentId = id`. */
@Injectable()
export class CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<CategoryRecord | null> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<CategoryRecord | null> {
    const row = await this.prisma.category.findUnique({ where: { slug } });
    return row ? toRecord(row) : null;
  }

  async listChildren(parentId: string | null): Promise<CategoryRecord[]> {
    const rows = await this.prisma.category.findMany({ where: { parentId }, orderBy: { name: 'asc' } });
    return rows.map(toRecord);
  }

  async upsert(input: CategoryInput): Promise<CategoryRecord> {
    const parentId = input.parentId ?? null;
    if (parentId === input.id) {
      throw new CatalogValidationError('CATEGORY_PARENT_SELF', 'Una categoría no puede ser su propia madre.', ['parentId']);
    }
    if (parentId) await this.assertNoCycle(input.id, parentId);
    const data = { name: input.name, slug: input.slug, parentId };
    const row = await this.prisma.category.upsert({
      where: { id: input.id },
      create: { id: input.id, ...data },
      update: data,
    });
    return toRecord(row);
  }

  /** Recorre los ancestros del futuro padre: si aparece la propia categoría, habría ciclo. */
  private async assertNoCycle(categoryId: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < MAX_TREE_DEPTH; depth += 1) {
      if (cursor === categoryId) {
        throw new CatalogValidationError('CATEGORY_CYCLE', 'La categoría madre elegida crearía un ciclo.', ['parentId']);
      }
      const parent: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (!parent) {
        if (cursor === parentId) {
          throw new CatalogValidationError('CATEGORY_NOT_FOUND', 'La categoría madre no existe.', ['parentId']);
        }
        return;
      }
      cursor = parent.parentId;
    }
    if (cursor) {
      throw new CatalogValidationError('CATEGORY_CYCLE', 'El árbol de categorías excede la profundidad admitida.', ['parentId']);
    }
  }
}
