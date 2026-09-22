import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module';
import { GetCanonicalProductUseCase } from './application/get-canonical-product.use-case';
import { GetProductUseCase } from './application/get-product.use-case';
import { SearchProductsUseCase } from './application/search-products.use-case';
import { CanonicalProductRepository } from './infrastructure/canonical-product.repository';
import { CategoryRepository } from './infrastructure/category.repository';
import { ProductRepository } from './infrastructure/product.repository';
import { CanonicalProductsController } from './presentation/canonical-products.controller';
import { ProductsController } from './presentation/products.controller';

/**
 * Catálogo: categorías, canónicos y presentaciones concretas (P2-01) con sus
 * endpoints públicos de lectura (P2-02). Los precios viven en `PricesModule`.
 */
@Module({
  // Los filtros por cercanía y localidad reusan el resolvedor de comercios.
  imports: [StoresModule],
  controllers: [ProductsController, CanonicalProductsController],
  providers: [
    CategoryRepository,
    CanonicalProductRepository,
    ProductRepository,
    GetProductUseCase,
    GetCanonicalProductUseCase,
    SearchProductsUseCase,
  ],
  exports: [CategoryRepository, CanonicalProductRepository, ProductRepository],
})
export class CatalogModule {}
