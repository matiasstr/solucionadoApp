import type { CanonicalProductRecord, CategoryRecord, ProductRecord } from '../domain/catalog-records';
import type { CanonicalProductDto, CategoryDto, ProductDto } from './catalog.contracts';

export const toCategoryDto = (category: CategoryRecord): CategoryDto => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  parentId: category.parentId,
});

export const toCanonicalProductDto = (canonical: CanonicalProductRecord): CanonicalProductDto => ({
  id: canonical.id,
  name: canonical.name,
  categoryId: canonical.categoryId,
  defaultUnit: canonical.defaultUnit,
});

/** `normalizedName` es interno (búsqueda): no forma parte del contrato público. */
export const toProductDto = (product: ProductRecord): ProductDto => ({
  id: product.id,
  ean: product.ean,
  name: product.name,
  brand: product.brand,
  categoryId: product.categoryId,
  canonicalProductId: product.canonicalProductId,
  quantity: product.quantity,
  unit: product.unit,
  saleMode: product.saleMode,
  packageCount: product.packageCount,
});
