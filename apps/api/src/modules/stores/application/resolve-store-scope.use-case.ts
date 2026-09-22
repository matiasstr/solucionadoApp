import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { DEFAULT_RADIUS_KM, MAX_NEARBY_STORES, radiusToMeters } from '../domain/geo';
import { StoreProximityRepository } from '../infrastructure/store-proximity.repository';
import { StoreRepository } from '../infrastructure/store.repository';

/** Cómo se acotaron las sucursales de una consulta. */
export type StoreScopeOrigin = 'COORDINATES' | 'LOCALITY' | 'ALL';

export interface StoreScopeQuery {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly radiusKm?: number;
  readonly city?: string;
  readonly province?: string;
}

export interface ResolvedStoreScope {
  readonly origin: StoreScopeOrigin;
  readonly radiusKm: number | null;
  /** Sucursales alcanzadas; `null` significa todas. */
  readonly storeIds: string[] | null;
  /** Distancias en metros; vacío salvo que la consulta traiga coordenadas. */
  readonly distances: Map<string, number>;
}

/**
 * Traduce una consulta de ubicación en un conjunto de sucursales.
 *
 * Un radio solo tiene sentido con coordenadas; por localidad se listan las
 * sucursales de esa ciudad **sin** afirmar distancia, porque no se puede medir
 * (docs/DOMAIN.md). Lo comparten la búsqueda de productos y las de precios.
 */
@Injectable()
export class StoreScopeResolver {
  constructor(
    private readonly stores: StoreRepository,
    private readonly proximity: StoreProximityRepository,
  ) {}

  async resolve(query: StoreScopeQuery): Promise<ResolvedStoreScope> {
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
}
