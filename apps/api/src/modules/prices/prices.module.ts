import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { GetCurrentPricesUseCase } from './application/get-current-prices.use-case';
import { RecordPriceObservationUseCase } from './application/record-price-observation.use-case';
import { ProductPriceRepository } from './infrastructure/product-price.repository';

/** Historia de precios: registro append-only y precio actual con frescura. Endpoints en P2-02. */
@Module({
  imports: [CatalogModule],
  providers: [ProductPriceRepository, RecordPriceObservationUseCase, GetCurrentPricesUseCase],
  exports: [ProductPriceRepository, RecordPriceObservationUseCase, GetCurrentPricesUseCase],
})
export class PricesModule {}
