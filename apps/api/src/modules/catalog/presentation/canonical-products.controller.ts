import { Controller, Get, Param, Query } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, toPaginatedDto } from '../../../common/pagination';
import type { PaginatedDto } from '../../../common/pagination';
import { parseCursorOrFail, requireUuid } from '../../../common/query';
import { GetCanonicalProductUseCase } from '../application/get-canonical-product.use-case';
import { CanonicalProductRepository } from '../infrastructure/canonical-product.repository';
import type { CanonicalProductDetailDto, CanonicalProductDto } from './catalog.contracts';
import { toCanonicalProductDto } from './catalog.mappers';
import { ListCanonicalProductsQueryDto } from './catalog.query.dto';

/** Necesidades equivalentes: agrupan alternativas comparables por unidad base. */
@Controller('canonical-products')
export class CanonicalProductsController {
  constructor(
    private readonly canonicalProducts: CanonicalProductRepository,
    private readonly getCanonicalProduct: GetCanonicalProductUseCase,
  ) {}

  @Get()
  async list(@Query() query: ListCanonicalProductsQueryDto): Promise<PaginatedDto<CanonicalProductDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const page = await this.canonicalProducts.search({
      term: query.search,
      categoryId: query.categoryId,
      limit,
      cursor: parseCursorOrFail(query.cursor),
    });
    return toPaginatedDto(page, limit, toCanonicalProductDto);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<CanonicalProductDetailDto> {
    return this.getCanonicalProduct.execute(requireUuid(id));
  }
}
