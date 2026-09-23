import { Controller, Get, Query } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT } from '../../../common/pagination';
import { parseCursorOrFail } from '../../../common/query';
import { ListProductsQueryDto } from '../../catalog/presentation/catalog.query.dto';
import { SearchProductsUseCase } from '../application/search-products.use-case';
import type { SearchProductsResultDto } from './search.contracts';

/**
 * `GET /products`: búsqueda con la mejor oferta de cada producto. Vive en el
 * módulo de búsqueda porque compone catálogo, precios, comercios y promociones;
 * la ficha (`GET /products/:id`) sigue en catálogo y la ruta pública no cambia.
 */
@Controller('products')
export class ProductsSearchController {
  constructor(private readonly searchProducts: SearchProductsUseCase) {}

  @Get()
  list(@Query() query: ListProductsQueryDto): Promise<SearchProductsResultDto> {
    return this.searchProducts.execute({
      ...query,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: parseCursorOrFail(query.cursor),
    });
  }
}
