import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PricesModule } from '../prices/prices.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { StoresModule } from '../stores/stores.module';
import { GetCanonicalPricesUseCase } from './application/get-canonical-prices.use-case';
import { OfferPromotionResolver } from './application/offer-promotion.resolver';
import { SearchProductsUseCase } from './application/search-products.use-case';
import { CanonicalPricesController } from './presentation/canonical-prices.controller';
import { ProductsSearchController } from './presentation/products-search.controller';

/**
 * Búsqueda y comparación (P3-01): compone catálogo, precios, comercios y
 * promociones. Ningún otro módulo depende de este, así las dependencias no
 * forman ciclos y las rutas públicas quedan donde el usuario las espera.
 */
@Module({
  imports: [CatalogModule, PricesModule, StoresModule, PromotionsModule],
  controllers: [ProductsSearchController, CanonicalPricesController],
  providers: [SearchProductsUseCase, GetCanonicalPricesUseCase, OfferPromotionResolver],
  exports: [SearchProductsUseCase, GetCanonicalPricesUseCase],
})
export class SearchModule {}
