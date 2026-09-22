import { Controller, Get, Param, Query } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { GetProductPricesUseCase } from '../application/get-product-prices.use-case';
import type { PriceSortBy, ProductPricesDto } from './price.contracts';
import { ProductPricesQueryDto } from './product-prices.query.dto';

/**
 * `GET /products/:id/prices`. Vive en el módulo de precios (no en catálogo) para que
 * las dependencias entre módulos no formen un ciclo; la ruta pública no cambia.
 */
@Controller('products')
export class ProductPricesController {
  constructor(private readonly getProductPrices: GetProductPricesUseCase) {}

  @Get(':id/prices')
  getPrices(@Param('id') id: string, @Query() query: ProductPricesQueryDto): Promise<ProductPricesDto> {
    return this.getProductPrices.execute(requireUuid(id), {
      ...query,
      sortBy: query.sortBy as PriceSortBy | undefined,
    });
  }
}
