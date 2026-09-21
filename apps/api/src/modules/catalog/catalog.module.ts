import { Module } from '@nestjs/common';
import { CanonicalProductRepository } from './infrastructure/canonical-product.repository';
import { CategoryRepository } from './infrastructure/category.repository';
import { ProductRepository } from './infrastructure/product.repository';

/**
 * Catálogo: categorías, canónicos y presentaciones concretas. Sin controladores
 * todavía: los endpoints públicos llegan en P2-02.
 */
@Module({
  providers: [CategoryRepository, CanonicalProductRepository, ProductRepository],
  exports: [CategoryRepository, CanonicalProductRepository, ProductRepository],
})
export class CatalogModule {}
