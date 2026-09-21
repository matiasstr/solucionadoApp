import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, keysetFilter, toPage } from '../../../common/pagination';
import type { KeysetCursor, PageResult } from '../../../common/pagination';
import { PrismaService } from '../../../database/prisma.service';
import type { ProductRecord } from '../domain/catalog-records';
import { CatalogValidationError } from '../domain/catalog.errors';
import { DecimalValue } from '../domain/decimal';
import { normalizeName } from '../domain/naming';
import { baseUnitOf } from '../domain/units';
import type { MeasurementUnit, SaleMode } from '../domain/units';
import { toQuantityString } from './decimal-mapper';
import type { DecimalLike } from './decimal-mapper';

/** Product.quantity es Decimal(14,4): más decimales los truncaría la base. */
const QUANTITY_SCALE = 4;
const EAN_PATTERN = /^[0-9]{8,14}$/;

export interface ProductSearchQuery {
  readonly term?: string;
  readonly categoryId?: string;
  readonly canonicalProductId?: string;
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
}

export interface ProductInput {
  /** Id estable provisto por el seed o el importador. */
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly quantity: string;
  readonly unit: MeasurementUnit;
  readonly ean?: string | null;
  readonly brand?: string | null;
  readonly canonicalProductId?: string | null;
  readonly saleMode?: SaleMode;
  readonly packageCount?: number;
  readonly isActive?: boolean;
}

interface ProductRow {
  id: string;
  ean: string | null;
  name: string;
  normalizedName: string;
  brand: string | null;
  categoryId: string;
  canonicalProductId: string | null;
  quantity: DecimalLike;
  unit: string;
  saleMode: string;
  packageCount: number;
  isActive: boolean;
}

const toRecord = (row: ProductRow): ProductRecord => ({
  id: row.id,
  ean: row.ean,
  name: row.name,
  normalizedName: row.normalizedName,
  brand: row.brand,
  categoryId: row.categoryId,
  canonicalProductId: row.canonicalProductId,
  quantity: toQuantityString(row.quantity),
  unit: row.unit as MeasurementUnit,
  saleMode: row.saleMode as SaleMode,
  packageCount: row.packageCount,
  isActive: row.isActive,
});

/**
 * Producto: una presentación concreta (marca, contenido neto y modalidad de venta).
 * Cambiar contenido o modalidad crea otro producto para no reinterpretar precios viejos.
 */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByEan(ean: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findUnique({ where: { ean } });
    return row ? toRecord(row) : null;
  }

  /** Alternativas del mismo canónico: la UI debe seguir distinguiendo exacto de alternativa. */
  async listByCanonicalProduct(canonicalProductId: string, limit = 50): Promise<ProductRecord[]> {
    const rows = await this.prisma.product.findMany({
      where: { canonicalProductId, isActive: true },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  async searchByName(term: string, limit = 20): Promise<ProductRecord[]> {
    const normalized = normalizeName(term);
    if (!normalized) return [];
    const rows = await this.prisma.product.findMany({
      where: { isActive: true, normalizedName: { contains: normalized } },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  /**
   * Búsqueda paginada por cursor. Orden estable `(normalizedName, id)`: el mismo
   * que usa el índice `Product_normalizedName_idx`.
   */
  async search(query: ProductSearchQuery): Promise<PageResult<ProductRecord>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const term = query.term ? normalizeName(query.term) : '';
    const rows = await this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(term ? { normalizedName: { contains: term } } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.canonicalProductId ? { canonicalProductId: query.canonicalProductId } : {}),
        ...keysetFilter('normalizedName', query.cursor ?? null),
      },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      // Una fila extra indica si hay página siguiente sin contar toda la tabla.
      take: limit + 1,
    });
    return toPage(rows.map(toRecord), limit, (product) => ({ key: product.normalizedName, id: product.id }));
  }

  async upsert(input: ProductInput): Promise<ProductRecord> {
    const quantity = this.validateQuantity(input.quantity);
    const packageCount = input.packageCount ?? 1;
    if (!Number.isInteger(packageCount) || packageCount < 1) {
      throw new CatalogValidationError('PACKAGE_COUNT_INVALID', 'El envase debe ser un entero positivo.', [
        'packageCount',
      ]);
    }
    if (input.ean != null && !EAN_PATTERN.test(input.ean)) {
      // El dígito de control se valida en el importador (fase 7), no acá.
      throw new CatalogValidationError('EAN_INVALID', 'El EAN debe tener entre 8 y 14 dígitos.', ['ean']);
    }
    if (input.canonicalProductId) await this.assertCompatibleCanonical(input.canonicalProductId, input.unit);

    const data = {
      ean: input.ean ?? null,
      name: input.name,
      normalizedName: normalizeName(input.name),
      brand: input.brand ?? null,
      categoryId: input.categoryId,
      canonicalProductId: input.canonicalProductId ?? null,
      quantity,
      unit: input.unit,
      saleMode: input.saleMode ?? 'PACKAGED',
      packageCount,
      isActive: input.isActive ?? true,
    };
    const row = await this.prisma.product.upsert({
      where: { id: input.id },
      create: { id: input.id, ...data },
      update: data,
    });
    return toRecord(row);
  }

  private validateQuantity(value: string): string {
    const quantity = DecimalValue.parse(value);
    if (!quantity.isPositive()) {
      throw new CatalogValidationError('QUANTITY_INVALID', 'El contenido debe ser mayor que cero.', ['quantity']);
    }
    if (!quantity.equals(quantity.round(QUANTITY_SCALE))) {
      throw new CatalogValidationError('QUANTITY_INVALID', 'El contenido admite como máximo cuatro decimales.', [
        'quantity',
      ]);
    }
    return quantity.toString();
  }

  /** Un producto solo se agrupa con un canónico de su misma dimensión (ADR 0002). */
  private async assertCompatibleCanonical(canonicalProductId: string, unit: MeasurementUnit): Promise<void> {
    const canonical = await this.prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
      select: { defaultUnit: true },
    });
    if (!canonical) {
      throw new CatalogValidationError('CANONICAL_NOT_FOUND', 'El producto canónico no existe.', [
        'canonicalProductId',
      ]);
    }
    if (canonical.defaultUnit !== baseUnitOf(unit)) {
      throw new CatalogValidationError(
        'DIMENSION_MISMATCH',
        `El producto se mide en ${baseUnitOf(unit)} y su canónico en ${canonical.defaultUnit}.`,
        ['unit'],
      );
    }
  }
}
