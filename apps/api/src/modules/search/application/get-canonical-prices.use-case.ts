import { Inject, Injectable } from '@nestjs/common';
import { MAX_PAGE_LIMIT } from '../../../common/pagination';
import { PublicHttpException } from '../../../common/public-http.exception';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { DecimalValue } from '../../catalog/domain/decimal';
import { CanonicalProductRepository } from '../../catalog/infrastructure/canonical-product.repository';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { toCanonicalProductDto, toProductDto } from '../../catalog/presentation/catalog.mappers';
import { ProductPriceRepository } from '../../prices/infrastructure/product-price.repository';
import type { PriceSortBy } from '../../prices/presentation/price.contracts';
import { PromotionRepository } from '../../promotions/infrastructure/promotion.repository';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import type { StoreScopeQuery } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { OfferPromotionResolver } from './offer-promotion.resolver';
import { buildOffer } from './offer.mapper';
import type { CanonicalOfferDto, CanonicalPricesDto } from '../presentation/search.contracts';

const MONEY_SCALE = 2;
const UNIT_PRICE_SCALE = 6;

export interface CanonicalPricesQuery extends StoreScopeQuery {
  /** Producto por el que se llegó: sus ofertas son coincidencia exacta. */
  readonly productId?: string;
  readonly includeStale?: boolean;
  readonly sortBy?: PriceSortBy;
  readonly limit?: number;
  /** Momento de referencia; los tests lo fijan. */
  readonly now?: Date;
}

/**
 * Comparación de una necesidad: todas las presentaciones del canónico con su
 * precio actual por sucursal, comparables por unidad base.
 *
 * Distingue coincidencia exacta de alternativa, conserva el precio sin promoción
 * y, cuando una promoción automática lo cambia, informa cuántas unidades hay que
 * llevar. El orden no mezcla dimensiones: todas las alternativas de un canónico
 * comparten unidad base (ADR 0002).
 */
@Injectable()
export class GetCanonicalPricesUseCase {
  constructor(
    private readonly canonicalProducts: CanonicalProductRepository,
    private readonly products: ProductRepository,
    private readonly prices: ProductPriceRepository,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    private readonly promotions: PromotionRepository,
    private readonly offerPromotions: OfferPromotionResolver,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(canonicalProductId: string, query: CanonicalPricesQuery = {}): Promise<CanonicalPricesDto> {
    const canonical = await this.canonicalProducts.findById(canonicalProductId);
    if (!canonical) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto canónico.');

    const scope = await this.storeScope.resolve(query);
    const sortBy = query.sortBy ?? 'UNIT_PRICE';
    // Sin coordenadas no hay distancia que ordenar; decirlo es mejor que inventar un orden.
    if (sortBy === 'DISTANCE' && scope.origin !== 'COORDINATES') {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Ordenar por distancia necesita latitud y longitud.', [
        'sortBy',
      ]);
    }
    const now = query.now ?? new Date();
    const includeStale = query.includeStale ?? true;
    const maxAgeDays = this.config.prices.maxAgeDays;
    const limit = Math.min(query.limit ?? MAX_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const alternatives = await this.products.listByCanonicalProduct(canonical.id);
    const emptyScope = scope.storeIds?.length === 0 || alternatives.length === 0;
    const current = emptyScope
      ? []
      : await this.prices.findCurrentByProducts(
          alternatives.map((product) => product.id),
          { storeIds: scope.storeIds ?? undefined, sourcePrecedence: this.config.prices.sourcePrecedence },
        );

    const storesById = new Map(
      (await this.stores.findManyByIds([...new Set(current.map((price) => price.storeId))])).map((store) => [
        store.id,
        store,
      ]),
    );
    const rules = current.length
      ? await this.promotions.findActiveFor({
          instant: now,
          storeIds: [...storesById.keys()],
          chainIds: [...new Set([...storesById.values()].map((store) => store.chainId))],
          productIds: alternatives.map((product) => product.id),
          canonicalProductIds: [canonical.id],
        })
      : [];

    const productsById = new Map(alternatives.map((product) => [product.id, product]));
    const offers: CanonicalOfferDto[] = [];
    for (const price of current) {
      const product = productsById.get(price.productId);
      const store = storesById.get(price.storeId);
      if (!product || !store) continue;
      const offer = buildOffer(price, store, {
        distanceMeters: scope.distances.get(store.id) ?? null,
        freshness: { now, maxAgeDays },
        promotion: this.offerPromotions.resolve(product, price.price, store, rules, now),
      });
      if (!includeStale && offer.freshness.isStale) continue;
      offers.push({
        ...offer,
        product: toProductDto(product),
        matchType: query.productId === product.id ? 'EXACT' : 'ALTERNATIVE',
      });
    }

    return {
      canonicalProduct: toCanonicalProductDto(canonical),
      scope: {
        origin: scope.origin,
        radiusKm: scope.radiusKm,
        distancesAvailable: scope.origin === 'COORDINATES',
        storesConsidered: scope.storeIds?.length ?? storesById.size,
        maxAgeDays,
        includeStale,
      },
      sortBy,
      offers: this.sort(offers, sortBy).slice(0, limit),
    };
  }

  /** Orden estable: el criterio elegido y, ante empate, el id de la sucursal. */
  private sort(offers: CanonicalOfferDto[], sortBy: PriceSortBy): CanonicalOfferDto[] {
    const byStore = (a: CanonicalOfferDto, b: CanonicalOfferDto) =>
      a.store.id < b.store.id ? -1 : a.store.id > b.store.id ? 1 : 0;
    return offers.sort((a, b) => {
      if (sortBy === 'DISTANCE') {
        const distance =
          (a.store.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.store.distanceMeters ?? Number.POSITIVE_INFINITY);
        if (distance !== 0) return distance;
        return byStore(a, b);
      }
      const field = sortBy === 'PRICE' ? 'price' : 'unitPrice';
      const scale = sortBy === 'PRICE' ? MONEY_SCALE : UNIT_PRICE_SCALE;
      const comparison = DecimalValue.parse(a[field])
        .round(scale)
        .compare(DecimalValue.parse(b[field]).round(scale));
      if (comparison !== 0) return comparison;
      return byStore(a, b);
    });
  }
}
