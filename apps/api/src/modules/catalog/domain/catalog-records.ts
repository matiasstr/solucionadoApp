/**
 * Registros del catálogo tal como los devuelven los repositorios: decimales como
 * texto y sin entidades Prisma. Los contratos HTTP se definen en P2-02.
 */
import type { BaseUnit, MeasurementUnit, SaleMode } from './units';

export interface CategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
}

export interface CanonicalProductRecord {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly categoryId: string;
  readonly defaultUnit: BaseUnit;
}

export interface ProductRecord {
  readonly id: string;
  readonly ean: string | null;
  readonly name: string;
  readonly normalizedName: string;
  readonly brand: string | null;
  readonly categoryId: string;
  readonly canonicalProductId: string | null;
  /** Contenido total del paquete o base de cotización, como texto decimal. */
  readonly quantity: string;
  readonly unit: MeasurementUnit;
  readonly saleMode: SaleMode;
  readonly packageCount: number;
  readonly isActive: boolean;
}
