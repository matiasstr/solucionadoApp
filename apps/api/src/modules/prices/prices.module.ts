import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { StoresModule } from '../stores/stores.module';
import { CurrentPriceAnalysis } from './application/current-price-analysis';
import { GetCurrentPricesUseCase } from './application/get-current-prices.use-case';
import { GetPriceHistoryUseCase } from './application/get-price-history.use-case';
import { GetProductPricesUseCase } from './application/get-product-prices.use-case';
import { RecordPriceObservationUseCase } from './application/record-price-observation.use-case';
import { ProductPriceRepository } from './infrastructure/product-price.repository';
import { ProductPricesController } from './presentation/product-prices.controller';

/**
 * Historia de precios: registro append-only, precio actual con frescura y el
 * endpoint `GET /products/:id/prices`. Importa catálogo y comercios; ninguno de
 * los dos importa este módulo, así la dependencia no forma un ciclo.
 */
@Module({
  imports: [CatalogModule, StoresModule],
  controllers: [ProductPricesController],
  providers: [
    ProductPriceRepository,
    GetPriceHistoryUseCase,
    RecordPriceObservationUseCase,
    GetCurrentPricesUseCase,
    GetProductPricesUseCase,
    CurrentPriceAnalysis,
  ],
  exports: [
    ProductPriceRepository,
    RecordPriceObservationUseCase,
    GetCurrentPricesUseCase,
    GetProductPricesUseCase,
    CurrentPriceAnalysis,
  ],
})
export class PricesModule {}
