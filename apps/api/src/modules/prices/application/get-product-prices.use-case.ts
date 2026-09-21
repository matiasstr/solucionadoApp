import { Inject, Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { toProductDto } from '../../catalog/presentation/catalog.mappers';
import { DEFAULT_RADIUS_KM, MAX_NEARBY_STORES, radiusToMeters } from '../../stores/domain/geo';
import { StoreProximityRepository } from '../../stores/infrastructure/store-proximity.repository';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { toStoreDto } from '../../stores/presentation/store.contracts';
import type { StoreSummaryRecord } from '../../stores/domain/store-records';
import type { CurrentPriceView } from '../domain/price-records';
import type { PriceScopeOrigin, ProductPricesDto, StorePriceDto } from '../presentation/price.contracts';
import { GetCurrentPricesUseCase } from './get-current-prices.use-case';

export interface ProductPricesQuery {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly radiusKm?: number;
  readonly city?: string;
  readonly province?: string;
  readonly includeStale?: boolean;
  /** Momento de referencia; los tests lo fijan. */
  readonly now?: Date;
}

interface StoreScope {
  readonly origin: PriceScopeOrigin;
  readonly radiusKm: number | null;
  readonly storeIds: string[] | null;
  readonly distances: Map<string, number>;
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
    private readonly proximity: StoreProximityRepository,
    private readonly currentPrices: GetCurrentPricesUseCase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(productId: string, query: ProductPricesQuery = {}): Promise<ProductPricesDto> {
    const product = await this.products.findById(productId);
    if (!product) throw new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto.');

    const scope = await this.resolveScope(query);
    const includeStale = query.includeStale ?? true;
    const maxAgeDays = this.config.prices.maxAgeDays;

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
      prices: views.flatMap((view) => {
        const store = stores.get(view.storeId);
        // Una sucursal desactivada después de la observación deja de listarse.
        return store ? [this.toStorePriceDto(view, store, scope.distances.get(view.storeId) ?? null)] : [];
      }),
    };
  }

  private async resolveScope(query: ProductPricesQuery): Promise<StoreScope> {
    const hasLatitude = query.latitude !== undefined;
    if (hasLatitude !== (query.longitude !== undefined)) {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Latitud y longitud se envían juntas.', [
        'latitude',
        'longitude',
      ]);
    }
    if (query.latitude !== undefined && query.longitude !== undefined) {
      const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;
      const nearby = await this.proximity.findActiveWithin(
        { latitude: query.latitude, longitude: query.longitude },
        radiusToMeters(radiusKm),
        MAX_NEARBY_STORES,
      );
      return {
        origin: 'COORDINATES',
        radiusKm,
        storeIds: nearby.map((store) => store.storeId),
        distances: new Map(nearby.map((store) => [store.storeId, store.distanceMeters])),
      };
    }
    if (query.radiusKm !== undefined) {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Un radio necesita latitud y longitud.', ['radiusKm']);
    }
    if (query.city || query.province) {
      if (!query.city || !query.province) {
        throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Indicá ciudad y provincia juntas.', [
          'city',
          'province',
        ]);
      }
      const local = await this.stores.listActiveByCity(query.province, query.city, MAX_NEARBY_STORES);
      return { origin: 'LOCALITY', radiusKm: null, storeIds: local.map((store) => store.id), distances: new Map() };
    }
    return { origin: 'ALL', radiusKm: null, storeIds: null, distances: new Map() };
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
