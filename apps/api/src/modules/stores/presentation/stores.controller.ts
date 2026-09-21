import { Controller, Get, Param, Query } from '@nestjs/common';
import type { PaginatedDto } from '../../../common/pagination';
import { parseCursorOrFail, requireUuid } from '../../../common/query';
import { PublicHttpException } from '../../../common/public-http.exception';
import { SearchStoresUseCase } from '../application/search-stores.use-case';
import { StoreRepository } from '../infrastructure/store.repository';
import { ListStoresQueryDto } from './stores.query.dto';
import { toStoreDto } from './store.contracts';
import type { StoreDto } from './store.contracts';

/** Sucursales públicas. Con coordenadas informa distancia; sin ellas, nunca la inventa. */
@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoreRepository,
    private readonly searchStores: SearchStoresUseCase,
  ) {}

  @Get()
  list(@Query() query: ListStoresQueryDto): Promise<PaginatedDto<StoreDto>> {
    return this.searchStores.execute({ ...query, cursor: parseCursorOrFail(query.cursor) });
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<StoreDto> {
    const store = await this.stores.findById(requireUuid(id));
    if (!store || !store.isActive) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos esa sucursal.');
    return toStoreDto(store);
  }
}
