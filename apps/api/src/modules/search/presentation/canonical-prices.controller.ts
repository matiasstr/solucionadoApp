import { Controller, Get, Param, Query } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { CanonicalPricesQueryDto } from '../../prices/presentation/product-prices.query.dto';
import type { PriceSortBy } from '../../prices/presentation/price.contracts';
import { GetCanonicalPricesUseCase } from '../application/get-canonical-prices.use-case';
import type { CanonicalPricesDto } from './search.contracts';

/**
 * `GET /canonical-products/:id/prices`: comparación de todas las presentaciones
 * de una misma necesidad. Vive en el módulo de búsqueda, que compone catálogo,
 * precios, comercios y promociones; la ruta pública no cambia.
 */
@Controller('canonical-products')
export class CanonicalPricesController {
  constructor(private readonly getCanonicalPrices: GetCanonicalPricesUseCase) {}

  @Get(':id/prices')
  getPrices(@Param('id') id: string, @Query() query: CanonicalPricesQueryDto): Promise<CanonicalPricesDto> {
    return this.getCanonicalPrices.execute(requireUuid(id), {
      ...query,
      sortBy: query.sortBy as PriceSortBy | undefined,
    });
  }
}
