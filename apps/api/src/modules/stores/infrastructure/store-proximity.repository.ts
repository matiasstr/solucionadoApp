import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface NearbyStore {
  readonly storeId: string;
  readonly distanceMeters: number;
}

/** Consultas espaciales parametrizadas sobre Store.location (PostGIS, no gestionado por Prisma). */
@Injectable()
export class StoreProximityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveWithin(origin: GeoPoint, radiusMeters: number, limit = 50): Promise<NearbyStore[]> {
    const { latitude, longitude } = origin;
    if (!(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90)
      || !(Number.isFinite(longitude) && longitude >= -180 && longitude <= 180)) {
      throw new RangeError('Coordenadas inválidas.');
    }
    if (!(Number.isFinite(radiusMeters) && radiusMeters > 0)) throw new RangeError('Radio inválido.');
    if (!(Number.isInteger(limit) && limit > 0 && limit <= 500)) throw new RangeError('Límite inválido.');

    // ST_MakePoint recibe (longitud, latitud); ST_DWithin sobre geography usa metros.
    return this.prisma.$queryRaw<NearbyStore[]>`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${longitude}::float8, ${latitude}::float8), 4326)::geography AS point
      )
      SELECT s."id"::text AS "storeId", ST_Distance(s."location", origin.point)::float8 AS "distanceMeters"
      FROM "Store" s, origin
      WHERE s."isActive" AND s."location" IS NOT NULL
        AND ST_DWithin(s."location", origin.point, ${radiusMeters}::float8)
      ORDER BY "distanceMeters", s."id"
      LIMIT ${limit}::int`;
  }
}
