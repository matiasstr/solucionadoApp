import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { StoresModule } from '../stores/stores.module';
import { GetCanonicalPricesUseCase } from './application/get-canonical-prices.use-case';
import { GetCurrentPricesUseCase } from './application/get-current-prices.use-case';
import { GetProductPricesUseCase } from './application/get-product-prices.use-case';
import { RecordPriceObservationUseCase } from './application/record-price-observation.use-case';
import { ProductPriceRepository } from './infrastructure/product-price.repository';
import { CanonicalPricesController } from './presentation/canonical-prices.controller';
import { ProductPricesController } from './presentation/product-prices.controller';

/**
 * Historia de precios: registro append-only, precio actual con frescura y el
 * endpoint `GET /products/:id/prices`. Importa catálogo y comercios; ninguno de
 * los dos importa este módulo, así la dependencia no forma un ciclo.
 */
@Module({
  imports: [CatalogModule, StoresModule, PromotionsModule],
  controllers: [ProductPricesController, CanonicalPricesController],
  providers: [
    ProductPriceRepository,
    RecordPriceObservationUseCase,
    GetCurrentPricesUseCase,
    GetProductPricesUseCase,
    GetCanonicalPricesUseCase,
  ],
  exports: [
    ProductPriceRepository,
    RecordPriceObservationUseCase,
    GetCurrentPricesUseCase,
    GetProductPricesUseCase,
    GetCanonicalPricesUseCase,
  ],
})
export class PricesModule {}
