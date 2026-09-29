import { Controller, Get, Param, Query } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { GetPriceHistoryUseCase } from '../application/get-price-history.use-case';
import { GetProductPricesUseCase } from '../application/get-product-prices.use-case';
import type { PriceHistoryDto } from './price-history.contracts';
import type { PriceSortBy, ProductPricesDto } from './price.contracts';
import { PriceHistoryQueryDto, ProductPricesQueryDto } from './product-prices.query.dto';

/**
 * `GET /products/:id/prices`. Vive en el módulo de precios (no en catálogo) para que
 * las dependencias entre módulos no formen un ciclo; la ruta pública no cambia.
 */
@Controller('products')
export class ProductPricesController {
  constructor(
    private readonly getProductPrices: GetProductPricesUseCase,
    private readonly getPriceHistory: GetPriceHistoryUseCase,
  ) {}

  @Get(':id/prices')
  getPrices(@Param('id') id: string, @Query() query: ProductPricesQueryDto): Promise<ProductPricesDto> {
    return this.getProductPrices.execute(requireUuid(id), {
      ...query,
      sortBy: query.sortBy as PriceSortBy | undefined,
    });
  }

  /** Historial por sucursal y fuente, un punto por día, con el análisis del precio actual (P6-01). */
  @Get(':id/price-history')
  getHistory(@Param('id') id: string, @Query() query: PriceHistoryQueryDto): Promise<PriceHistoryDto> {
    return this.getPriceHistory.execute(requireUuid(id), query);
  }
}
