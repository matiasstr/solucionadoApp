/**
 * Contrato público del catálogo (P2-02). Se refleja en `packages/shared/src/index.ts`
 * para la web; si cambia uno, cambia el otro. No exponer entidades Prisma.
 * Decimales como texto (ADR 0002) y fechas como ISO 8601 en UTC.
 */
import type { BaseUnit, MeasurementUnit, SaleMode } from '../domain/units';

export type DecimalString = string;

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface CanonicalProductDto {
  id: string;
  name: string;
  categoryId: string;
  /** Unidad en la que se comparan sus alternativas. */
  defaultUnit: BaseUnit;
}

export interface ProductDto {
  id: string;
  ean: string | null;
  name: string;
  brand: string | null;
  categoryId: string;
  canonicalProductId: string | null;
  /** Contenido total del paquete o base de cotización para venta por peso. */
  quantity: DecimalString;
  unit: MeasurementUnit;
  saleMode: SaleMode;
  packageCount: number;
}

export interface ProductDetailDto extends ProductDto {
  category: CategoryDto;
  /** Null cuando el producto todavía no está agrupado con equivalentes. */
  canonicalProduct: CanonicalProductDto | null;
}

export interface CanonicalProductDetailDto extends CanonicalProductDto {
  category: CategoryDto;
  /** Alternativas aceptables: pertenecer al mismo canónico no las hace idénticas. */
  products: ProductDto[];
}
