import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT } from '../../../common/pagination';
import type { KeysetCursor } from '../../../common/pagination';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { DecimalValue } from '../../catalog/domain/decimal';
import type { ProductRecord } from '../../catalog/domain/catalog-records';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { toProductDto } from '../../catalog/presentation/catalog.mappers';
import { ProductPriceRepository } from '../../prices/infrastructure/product-price.repository';
import type { CurrentPriceRecord } from '../../prices/domain/price-records';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import type { StoreScopeQuery } from '../../stores/application/resolve-store-scope.use-case';
import { OfferPromotionResolver } from './offer-promotion.resolver';
import { buildOffer } from './offer.mapper';
import type { ProductSearchItemDto, SearchProductsResultDto } from '../presentation/search.contracts';

export interface SearchProductsQuery extends StoreScopeQuery {
  readonly search?: string;
  readonly categoryId?: string;
  readonly canonicalProductId?: string;
  readonly brand?: string;
  readonly chainId?: string;
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
  /** Momento de referencia para vigencia y frescura; los tests lo fijan. */
  readonly now?: Date;
}

/**
 * Búsqueda de productos con su mejor oferta dentro del alcance consultado.
 *
 * Con ubicación solo devuelve productos con precio observado en esas sucursales:
 * listar algo que no se consigue cerca sería peor que no listarlo. Los precios de
 * toda la página se resuelven en una consulta, y las promociones en otra.
 */
@Injectable()
export class SearchProductsUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly prices: ProductPriceRepository,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    private readonly promotions: PromotionRepository,
    private readonly offerPromotions: OfferPromotionResolver,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(query: SearchProductsQuery): Promise<SearchProductsResultDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const now = query.now ?? new Date();
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

    const cheapest = await this.cheapestByProduct(page.items, scope.storeIds, query.chainId);
    const storesById = new Map(
      (await this.stores.findManyByIds([...new Set([...cheapest.values()].map((price) => price.storeId))])).map(
        (store) => [store.id, store],
      ),
    );
    const rules = storesById.size
      ? await this.promotions.findActiveFor({
          instant: now,
          storeIds: [...storesById.keys()],
          chainIds: [...new Set([...storesById.values()].map((store) => store.chainId))],
          productIds: page.items.map((product) => product.id),
          canonicalProductIds: page.items.flatMap((product) =>
            product.canonicalProductId ? [product.canonicalProductId] : [],
          ),
        })
      : [];

    const items: ProductSearchItemDto[] = page.items.map((product) => {
      const price = cheapest.get(product.id);
      const store = price ? storesById.get(price.storeId) : undefined;
      return {
        ...toProductDto(product),
        bestOffer:
          price && store
            ? buildOffer(price, store, {
                distanceMeters: scope.distances.get(store.id) ?? null,
                freshness: { now, maxAgeDays: this.config.prices.maxAgeDays },
                promotion: this.offerPromotions.resolve(product, price.price, store, rules, now),
              })
            : null,
      };
    });

    return {
      items,
      page: { limit, nextCursor: page.nextCursor },
      scope: {
        origin: scope.origin,
        radiusKm: scope.radiusKm,
        storesConsidered: scope.storeIds?.length ?? null,
      },
    };
  }

  /** La oferta más barata por unidad base de cada producto; desempata la sucursal. */
  private async cheapestByProduct(
    products: readonly ProductRecord[],
    storeIds: readonly string[] | null,
    chainId: string | undefined,
  ): Promise<Map<string, CurrentPriceRecord>> {
    if (!products.length) return new Map();
    // Filtrar por cadena sin coordenadas exige resolver sus sucursales primero.
    const chainStores = chainId && !storeIds ? await this.stores.search({ chainId, limit: 50 }) : null;
    const scopedStoreIds = storeIds ?? chainStores?.items.map((store) => store.id) ?? undefined;
    const current = await this.prices.findCurrentByProducts(
      products.map((product) => product.id),
      { storeIds: scopedStoreIds, sourcePrecedence: this.config.prices.sourcePrecedence },
    );
    const cheapest = new Map<string, CurrentPriceRecord>();
    for (const price of current) {
      const previous = cheapest.get(price.productId);
      if (!previous) {
        cheapest.set(price.productId, price);
        continue;
      }
      const comparison = DecimalValue.parse(price.unitPrice).compare(DecimalValue.parse(previous.unitPrice));
      if (comparison < 0 || (comparison === 0 && price.storeId < previous.storeId)) {
        cheapest.set(price.productId, price);
      }
    }
    return cheapest;
  }
}
