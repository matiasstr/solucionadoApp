import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CatalogValidationError } from '../../catalog/domain/catalog.errors';
import { DecimalValue } from '../../catalog/domain/decimal';
import { toOptionalQuantityString } from '../../catalog/infrastructure/decimal-mapper';
import type { DecimalLike } from '../../catalog/infrastructure/decimal-mapper';
import type { StoreChainRecord, StoreRecord } from '../domain/store-records';

/** Store.latitude/longitude son Decimal(9,6). El punto PostGIS lo deriva un trigger. */
const COORDINATE_SCALE = 6;

export interface StoreChainInput {
  readonly id: string;
  readonly name: string;
  readonly logoUrl?: string | null;
}

export interface StoreInput {
  /** Id estable provisto por el seed o el importador. */
  readonly id: string;
  readonly chainId: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly province: string;
  /** Latitud y longitud van juntas o no van: sin ambas no hay distancia verificable. */
  readonly latitude?: string | null;
  readonly longitude?: string | null;
  readonly isActive?: boolean;
}

interface ChainRow {
  id: string;
  name: string;
  logoUrl: string | null;
}

interface StoreRow {
  id: string;
  chainId: string;
  name: string;
  address: string;
  city: string;
  province: string;
  latitude: DecimalLike | null;
  longitude: DecimalLike | null;
  isActive: boolean;
}

const STORE_COLUMNS = {
  id: true,
  chainId: true,
  name: true,
  address: true,
  city: true,
  province: true,
  latitude: true,
  longitude: true,
  isActive: true,
} as const;

const toChainRecord = (row: ChainRow): StoreChainRecord => ({
  id: row.id,
  name: row.name,
  logoUrl: row.logoUrl,
});

const toStoreRecord = (row: StoreRow): StoreRecord => ({
  id: row.id,
  chainId: row.chainId,
  name: row.name,
  address: row.address,
  city: row.city,
  province: row.province,
  latitude: toOptionalQuantityString(row.latitude),
  longitude: toOptionalQuantityString(row.longitude),
  isActive: row.isActive,
});

/** Cadenas y sucursales. Las consultas espaciales viven en StoreProximityRepository. */
@Injectable()
export class StoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<StoreRecord | null> {
    const row = await this.prisma.store.findUnique({ where: { id }, select: STORE_COLUMNS });
    return row ? toStoreRecord(row) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<StoreRecord[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.store.findMany({
      where: { id: { in: [...ids] } },
      select: STORE_COLUMNS,
      orderBy: { id: 'asc' },
    });
    return rows.map(toStoreRecord);
  }

  async listActive(limit = 100): Promise<StoreRecord[]> {
    const rows = await this.prisma.store.findMany({
      where: { isActive: true },
      select: STORE_COLUMNS,
      orderBy: [{ province: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      take: limit,
    });
    return rows.map(toStoreRecord);
  }

  /** Búsqueda aproximada por localidad: no informa distancia ni aplica radio. */
  async listActiveByCity(province: string, city: string, limit = 50): Promise<StoreRecord[]> {
    const rows = await this.prisma.store.findMany({
      where: { isActive: true, province, city },
      select: STORE_COLUMNS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toStoreRecord);
  }

  async listChains(): Promise<StoreChainRecord[]> {
    const rows = await this.prisma.storeChain.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toChainRecord);
  }

  async upsertChain(input: StoreChainInput): Promise<StoreChainRecord> {
    const data = { name: input.name, logoUrl: input.logoUrl ?? null };
    const row = await this.prisma.storeChain.upsert({
      where: { id: input.id },
      create: { id: input.id, ...data },
      update: data,
    });
    return toChainRecord(row);
  }

  async upsert(input: StoreInput): Promise<StoreRecord> {
    const { latitude, longitude } = this.validateCoordinates(input.latitude ?? null, input.longitude ?? null);
    const data = {
      chainId: input.chainId,
      name: input.name,
      address: input.address,
      city: input.city,
      province: input.province,
      latitude,
      longitude,
      isActive: input.isActive ?? true,
    };
    const row = await this.prisma.store.upsert({
      where: { id: input.id },
      create: { id: input.id, ...data },
      update: data,
      select: STORE_COLUMNS,
    });
    return toStoreRecord(row);
  }

  private validateCoordinates(
    latitude: string | null,
    longitude: string | null,
  ): { latitude: string | null; longitude: string | null } {
    if ((latitude === null) !== (longitude === null)) {
      throw new CatalogValidationError('STORE_COORDINATES', 'Latitud y longitud deben informarse juntas.', [
        'latitude',
        'longitude',
      ]);
    }
    if (latitude === null || longitude === null) return { latitude: null, longitude: null };
    const lat = DecimalValue.parse(latitude);
    const lon = DecimalValue.parse(longitude);
    if (lat.compare(DecimalValue.parse('-90')) < 0 || lat.compare(DecimalValue.parse('90')) > 0) {
      throw new CatalogValidationError('STORE_COORDINATES', 'La latitud debe estar entre -90 y 90.', ['latitude']);
    }
    if (lon.compare(DecimalValue.parse('-180')) < 0 || lon.compare(DecimalValue.parse('180')) > 0) {
      throw new CatalogValidationError('STORE_COORDINATES', 'La longitud debe estar entre -180 y 180.', ['longitude']);
    }
    return { latitude: lat.toFixed(COORDINATE_SCALE), longitude: lon.toFixed(COORDINATE_SCALE) };
  }
}
