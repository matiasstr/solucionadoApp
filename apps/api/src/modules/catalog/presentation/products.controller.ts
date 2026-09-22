import { Controller, Get, Param, Query } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT } from '../../../common/pagination';
import { parseCursorOrFail, requireUuid } from '../../../common/query';
import { GetProductUseCase } from '../application/get-product.use-case';
import { SearchProductsUseCase } from '../application/search-products.use-case';
import type { SearchProductsResultDto } from '../application/search-products.use-case';
import type { ProductDetailDto } from './catalog.contracts';
import { ListProductsQueryDto } from './catalog.query.dto';

/**
 * Catálogo público de presentaciones concretas. `GET /products/:id/prices` lo sirve
 * `ProductPricesController` (módulo de precios). La historia de precios llega en fase 6.
 */
@Controller('products')
export class ProductsController {
  constructor(
    private readonly searchProducts: SearchProductsUseCase,
    private readonly getProduct: GetProductUseCase,
  ) {}

  @Get()
  list(@Query() query: ListProductsQueryDto): Promise<SearchProductsResultDto> {
    return this.searchProducts.execute({
      ...query,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: parseCursorOrFail(query.cursor),
    });
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<ProductDetailDto> {
    return this.getProduct.execute(requireUuid(id));
  }
}
