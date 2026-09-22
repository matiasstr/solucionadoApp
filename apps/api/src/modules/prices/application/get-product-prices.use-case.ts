import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { toProductDto } from '../../catalog/presentation/catalog.mappers';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import type { ResolvedStoreScope } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { toStoreDto } from '../../stores/presentation/store.contracts';
import type { StoreSummaryRecord } from '../../stores/domain/store-records';
import type { CurrentPriceView } from '../domain/price-records';
import type { PriceSortBy, ProductPricesDto, StorePriceDto } from '../presentation/price.contracts';
import { DecimalValue } from '../../catalog/domain/decimal';
import { GetCurrentPricesUseCase } from './get-current-prices.use-case';

export interface ProductPricesQuery {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly radiusKm?: number;
  readonly city?: string;
  readonly province?: string;
  readonly includeStale?: boolean;
  readonly sortBy?: PriceSortBy;
  /** Momento de referencia; los tests lo fijan. */
  readonly now?: Date;
}

/**
 * Precios actuales de un producto por sucursal, acotados por proximidad o localidad.
 * Un radio solo se aplica con coordenadas; por localidad se listan sucursales sin
 * afirmar distancia (docs/DOMAIN.md).
 */
@Injectable()
export class GetProductPricesUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    private readonly currentPrices: GetCurrentPricesUseCase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(productId: string, query: ProductPricesQuery = {}): Promise<ProductPricesDto> {
    const product = await this.products.findById(productId);
    if (!product) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto.');

    const scope: ResolvedStoreScope = await this.storeScope.resolve(query);
    const includeStale = query.includeStale ?? true;
    const maxAgeDays = this.config.prices.maxAgeDays;
    const sortBy = query.sortBy ?? 'UNIT_PRICE';
    // Sin coordenadas no hay distancia que ordenar; decirlo es mejor que inventar un orden.
    if (sortBy === 'DISTANCE' && scope.origin !== 'COORDINATES') {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Ordenar por distancia necesita latitud y longitud.', [
        'sortBy',
      ]);
    }

    // Alcance vacío: no hay sucursales que evaluar, y eso no es lo mismo que "sin precios".
    const views = scope.storeIds?.length === 0
      ? []
      : await this.currentPrices.execute(productId, {
          storeIds: scope.storeIds ?? undefined,
          now: query.now,
          includeStale,
        });

    const stores = new Map(
      (await this.stores.findManyByIds(views.map((view) => view.storeId))).map((store) => [store.id, store]),
    );

    return {
      product: toProductDto(product),
      scope: {
        origin: scope.origin,
        radiusKm: scope.radiusKm,
        distancesAvailable: scope.origin === 'COORDINATES',
        storesConsidered: scope.storeIds?.length ?? stores.size,
        maxAgeDays,
        includeStale,
      },
      sortBy,
      prices: this.sort(
        views.flatMap((view) => {
          const store = stores.get(view.storeId);
          // Una sucursal desactivada después de la observación deja de listarse.
          return store ? [this.toStorePriceDto(view, store, scope.distances.get(view.storeId) ?? null)] : [];
        }),
        sortBy,
      ),
    };
  }

  /** Orden estable: el criterio elegido y, ante empate, el id de la sucursal. */
  private sort(prices: StorePriceDto[], sortBy: PriceSortBy): StorePriceDto[] {
    return prices.sort((a, b) => {
      if (sortBy === 'DISTANCE') {
        const distance =
          (a.store.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.store.distanceMeters ?? Number.POSITIVE_INFINITY);
        if (distance !== 0) return distance;
      } else {
        const field = sortBy === 'PRICE' ? 'price' : 'unitPrice';
        const comparison = DecimalValue.parse(a[field]).compare(DecimalValue.parse(b[field]));
        if (comparison !== 0) return comparison;
      }
      return a.store.id < b.store.id ? -1 : a.store.id > b.store.id ? 1 : 0;
    });
  }

  private toStorePriceDto(
    view: CurrentPriceView,
    store: StoreSummaryRecord,
    distanceMeters: number | null,
  ): StorePriceDto {
    return {
      store: toStoreDto(store, distanceMeters),
      price: view.price,
      currency: view.currency,
      unitPrice: view.unitPrice,
      unitPriceUnit: view.unitPriceUnit,
      unitPricePer100g: view.unitPricePer100g,
      source: view.source,
      freshness: {
        observedAt: view.freshness.observedAt.toISOString(),
        ageDays: view.freshness.ageDays,
        maxAgeDays: view.freshness.maxAgeDays,
        isStale: view.freshness.isStale,
      },
    };
  }
}
