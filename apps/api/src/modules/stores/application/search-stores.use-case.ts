import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, toPaginatedDto } from '../../../common/pagination';
import type { KeysetCursor, PaginatedDto } from '../../../common/pagination';
import { PublicHttpException } from '../../../common/public-http.exception';
import { DEFAULT_RADIUS_KM, MAX_NEARBY_STORES, radiusToMeters } from '../domain/geo';
import type { StoreSummaryRecord } from '../domain/store-records';
import { StoreProximityRepository } from '../infrastructure/store-proximity.repository';
import { StoreRepository } from '../infrastructure/store.repository';
import { toStoreDto } from '../presentation/store.contracts';
import type { StoreDto } from '../presentation/store.contracts';

export interface SearchStoresQuery {
  readonly search?: string;
  readonly chainId?: string;
  readonly city?: string;
  readonly province?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly radiusKm?: number;
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
}

/**
 * Listado de sucursales. Con coordenadas ordena por distancia real (PostGIS, metros)
 * y sin cursor; sin coordenadas pagina por cursor con orden alfabético estable.
 */
@Injectable()
export class SearchStoresUseCase {
  constructor(
    private readonly stores: StoreRepository,
    private readonly proximity: StoreProximityRepository,
  ) {}

  async execute(query: SearchStoresQuery): Promise<PaginatedDto<StoreDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const hasLatitude = query.latitude !== undefined;
    if (hasLatitude !== (query.longitude !== undefined)) {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Latitud y longitud se envían juntas.', [
        'latitude',
        'longitude',
      ]);
    }
    if (!hasLatitude) {
      if (query.radiusKm !== undefined) {
        throw new PublicHttpException(400, 'VALIDATION_FAILED', 'Un radio necesita latitud y longitud.', ['radiusKm']);
      }
      const page = await this.stores.search({
        term: query.search,
        chainId: query.chainId,
        city: query.city,
        province: query.province,
        limit,
        cursor: query.cursor,
      });
      return toPaginatedDto(page, limit, (store) => toStoreDto(store));
    }

    if (query.cursor) {
      // El orden por distancia no es un keyset: paginar acá daría resultados repetidos.
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'La búsqueda por cercanía no admite cursor.', ['cursor']);
    }
    const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;
    const nearby = await this.proximity.findActiveWithin(
      { latitude: query.latitude as number, longitude: query.longitude as number },
      radiusToMeters(radiusKm),
      MAX_NEARBY_STORES,
    );
    const summaries = new Map(
      (await this.stores.findManyByIds(nearby.map((store) => store.storeId))).map((store) => [store.id, store]),
    );
    const items: StoreDto[] = [];
    for (const { storeId, distanceMeters } of nearby) {
      const store = summaries.get(storeId);
      if (store && this.matches(store, query)) items.push(toStoreDto(store, distanceMeters));
      if (items.length === limit) break;
    }
    return { items, page: { limit, nextCursor: null } };
  }

  private matches(store: StoreSummaryRecord, query: SearchStoresQuery): boolean {
    if (query.chainId && store.chainId !== query.chainId) return false;
    if (query.city && store.city !== query.city) return false;
    if (query.province && store.province !== query.province) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      if (!store.name.toLowerCase().includes(term) && !store.chainName.toLowerCase().includes(term)) return false;
    }
    return true;
  }
}
