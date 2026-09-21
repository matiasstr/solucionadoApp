import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, keysetFilter, toPage } from '../../../common/pagination';
import type { KeysetCursor, PageResult } from '../../../common/pagination';
import { PrismaService } from '../../../database/prisma.service';
import { CatalogValidationError } from '../../catalog/domain/catalog.errors';
import { DecimalValue } from '../../catalog/domain/decimal';
import { toOptionalQuantityString } from '../../catalog/infrastructure/decimal-mapper';
import type { DecimalLike } from '../../catalog/infrastructure/decimal-mapper';
import type { StoreChainRecord, StoreRecord, StoreSummaryRecord } from '../domain/store-records';

/** Store.latitude/longitude son Decimal(9,6). El punto PostGIS lo deriva un trigger. */
const COORDINATE_SCALE = 6;

export interface StoreChainInput {
  readonly id: string;
  readonly name: string;
  readonly logoUrl?: string | null;
}

export interface StoreSearchQuery {
  readonly term?: string;
  readonly chainId?: string;
  readonly city?: string;
  readonly province?: string;
  /** Sucursales concretas (por ejemplo, las que devolvió una consulta espacial). */
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly cursor?: KeysetCursor | null;
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

/** Lecturas de la API: la sucursal siempre viaja con el nombre de su cadena. */
const STORE_SUMMARY_COLUMNS = { ...STORE_COLUMNS, chain: { select: { name: true } } } as const;

const toChainRecord = (row: ChainRow): StoreChainRecord => ({
  id: row.id,
  name: row.name,
  logoUrl: row.logoUrl,
});

const toStoreSummary = (row: StoreRow & { chain: { name: string } }): StoreSummaryRecord => ({
  ...toStoreRecord(row),
  chainName: row.chain.name,
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

  async findById(id: string): Promise<StoreSummaryRecord | null> {
    const row = await this.prisma.store.findUnique({ where: { id }, select: STORE_SUMMARY_COLUMNS });
    return row ? toStoreSummary(row) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<StoreSummaryRecord[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.store.findMany({
      where: { id: { in: [...ids] } },
      select: STORE_SUMMARY_COLUMNS,
      orderBy: { id: 'asc' },
    });
    return rows.map(toStoreSummary);
  }

  async listActive(limit = 100): Promise<StoreSummaryRecord[]> {
    const rows = await this.prisma.store.findMany({
      where: { isActive: true },
      select: STORE_SUMMARY_COLUMNS,
      orderBy: [{ province: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      take: limit,
    });
    return rows.map(toStoreSummary);
  }

  /** Búsqueda aproximada por localidad: no informa distancia ni aplica radio. */
  async listActiveByCity(province: string, city: string, limit = 50): Promise<StoreSummaryRecord[]> {
    const rows = await this.prisma.store.findMany({
      where: { isActive: true, province, city },
      select: STORE_SUMMARY_COLUMNS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toStoreSummary);
  }

  /**
   * Búsqueda paginada por cursor con orden estable `(name, id)`. `ids` permite
   * combinarla con una consulta espacial sin repetir el filtro en SQL crudo.
   */
  async search(query: StoreSearchQuery): Promise<PageResult<StoreSummaryRecord>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const term = query.term?.trim();
    const rows = await this.prisma.store.findMany({
      where: {
        isActive: true,
        ...(query.chainId ? { chainId: query.chainId } : {}),
        ...(query.city ? { city: query.city } : {}),
        ...(query.province ? { province: query.province } : {}),
        ...(query.ids ? { id: { in: [...query.ids] } } : {}),
        ...(term ? { name: { contains: term, mode: 'insensitive' as const } } : {}),
        ...keysetFilter('name', query.cursor ?? null),
      },
      select: STORE_SUMMARY_COLUMNS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return toPage(rows.map(toStoreSummary), limit, (store) => ({ key: store.name, id: store.id }));
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
