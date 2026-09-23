import { Controller, Get, Param } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { GetProductUseCase } from '../application/get-product.use-case';
import type { ProductDetailDto } from './catalog.contracts';

/**
 * Ficha de una presentación concreta. La búsqueda (`GET /products`) y los precios
 * (`GET /products/:id/prices`) los sirven los módulos de búsqueda y de precios,
 * que componen más dependencias; las rutas públicas no cambian.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly getProduct: GetProductUseCase) {}

  @Get(':id')
  getOne(@Param('id') id: string): Promise<ProductDetailDto> {
    return this.getProduct.execute(requireUuid(id));
  }
}
