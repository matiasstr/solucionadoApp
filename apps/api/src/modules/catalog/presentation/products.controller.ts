import { Controller, Get, Param, Query } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, toPaginatedDto } from '../../../common/pagination';
import type { PaginatedDto } from '../../../common/pagination';
import { parseCursorOrFail, requireUuid } from '../../../common/query';
import { GetProductUseCase } from '../application/get-product.use-case';
import { ProductRepository } from '../infrastructure/product.repository';
import type { ProductDetailDto, ProductDto } from './catalog.contracts';
import { toProductDto } from './catalog.mappers';
import { ListProductsQueryDto } from './catalog.query.dto';

/**
 * Catálogo público de presentaciones concretas. `GET /products/:id/prices` lo sirve
 * `ProductPricesController` (módulo de precios). La historia de precios llega en fase 6.
 */
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductRepository,
    private readonly getProduct: GetProductUseCase,
  ) {}

  @Get()
  async list(@Query() query: ListProductsQueryDto): Promise<PaginatedDto<ProductDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const page = await this.products.search({
      term: query.search,
      categoryId: query.categoryId,
      canonicalProductId: query.canonicalProductId,
      limit,
      cursor: parseCursorOrFail(query.cursor),
    });
    return toPaginatedDto(page, limit, toProductDto);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<ProductDetailDto> {
    return this.getProduct.execute(requireUuid(id));
  }
}
