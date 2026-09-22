import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, toPaginatedDto } from '../../../common/pagination';
import type { KeysetCursor, PaginatedDto } from '../../../common/pagination';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import type { StoreScopeOrigin } from '../../stores/application/resolve-store-scope.use-case';
import { ProductRepository } from '../infrastructure/product.repository';
import type { ProductDto } from '../presentation/catalog.contracts';
import { toProductDto } from '../presentation/catalog.mappers';

export interface SearchProductsQuery {
  readonly search?: string;
  readonly categoryId?: string;
  readonly canonicalProductId?: string;
  readonly brand?: string;
  readonly chainId?: string;
  readonly city?: string;
  readonly province?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly radiusKm?: number;
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
}

/** Cómo se acotó la búsqueda: la UI necesita poder explicarlo. */
export interface SearchProductsScopeDto {
  origin: StoreScopeOrigin;
  radiusKm: number | null;
  /** Sucursales consideradas; null cuando la búsqueda no se acotó por ubicación. */
  storesConsidered: number | null;
}

export interface SearchProductsResultDto extends PaginatedDto<ProductDto> {
  scope: SearchProductsScopeDto;
}

/**
 * Búsqueda de productos por texto y disponibilidad. Con ubicación solo devuelve
 * productos con precio observado en esas sucursales: listar algo que no se
 * consigue cerca sería peor que no listarlo.
 */
@Injectable()
export class SearchProductsUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly storeScope: StoreScopeResolver,
  ) {}

  async execute(query: SearchProductsQuery): Promise<SearchProductsResultDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const scope = await this.storeScope.resolve(query);
    const page = await this.products.search({
      term: query.search,
      categoryId: query.categoryId,
      canonicalProductId: query.canonicalProductId,
      brand: query.brand,
      chainId: query.chainId,
      storeIds: scope.storeIds,
      limit,
      cursor: query.cursor,
    });
    return {
      ...toPaginatedDto(page, limit, toProductDto),
      scope: {
        origin: scope.origin,
        radiusKm: scope.radiusKm,
        storesConsidered: scope.storeIds?.length ?? null,
      },
    };
  }
}
