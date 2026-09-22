import { Controller, Get, Param, Query } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, toPaginatedDto } from '../../../common/pagination';
import type { PaginatedDto } from '../../../common/pagination';
import { PublicHttpException } from '../../../common/public-http.exception';
import { parseCursorOrFail, requireUuid } from '../../../common/query';
import { PromotionRepository } from '../infrastructure/promotion.repository';
import type { PromotionType } from '../domain/promotion.types';
import { toPromotionDto } from './promotion.contracts';
import type { PromotionDto } from './promotion.contracts';
import { ListPromotionsQueryDto } from './promotions.query.dto';

/**
 * Promociones visibles. Aplicarlas a una canasta es trabajo del planificador
 * (fase 5): acá solo se informan, con su vigencia y sus condiciones.
 */
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionRepository) {}

  @Get()
  async list(@Query() query: ListPromotionsQueryDto): Promise<PaginatedDto<PromotionDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const page = await this.promotions.search({
      storeId: query.storeId,
      chainId: query.chainId,
      productId: query.productId,
      canonicalProductId: query.canonicalProductId,
      type: query.type as PromotionType | undefined,
      // Por defecto solo lo vigente ahora; `includeInactive` muestra también vencidas y futuras.
      activeAt: query.includeInactive ? undefined : new Date(query.activeAt ?? Date.now()),
      limit,
      cursor: parseCursorOrFail(query.cursor),
    });
    return toPaginatedDto(page, limit, toPromotionDto);
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<PromotionDto> {
    const promotion = await this.promotions.findById(requireUuid(id));
    if (!promotion) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos esa promoción.');
    return toPromotionDto(promotion);
  }
}
