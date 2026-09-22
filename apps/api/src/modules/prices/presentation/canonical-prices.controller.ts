import { Controller, Get, Param, Query } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { GetCanonicalPricesUseCase } from '../application/get-canonical-prices.use-case';
import type { CanonicalPricesDto, PriceSortBy } from './price.contracts';
import { CanonicalPricesQueryDto } from './product-prices.query.dto';

/**
 * `GET /canonical-products/:id/prices`: comparación de todas las presentaciones
 * de una misma necesidad. Vive en el módulo de precios para que las dependencias
 * entre módulos no formen un ciclo; la ruta pública no cambia.
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
