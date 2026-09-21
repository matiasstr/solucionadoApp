/**
 * Contrato público de comercios (P2-02). Se refleja en `packages/shared/src/index.ts`.
 * `distanceMeters` solo existe cuando la consulta trajo coordenadas y la sucursal
 * también las tiene: sin ubicación precisa no se informa distancia (docs/DOMAIN.md).
 */
import type { DecimalString } from '../../catalog/presentation/catalog.contracts';
import type { StoreSummaryRecord } from '../domain/store-records';

export interface StoreDto {
  id: string;
  chainId: string;
  chainName: string;
  name: string;
  address: string;
  city: string;
  province: string;
  latitude: DecimalString | null;
  longitude: DecimalString | null;
  /** Distancia en línea recta desde el origen consultado; null si no se pudo calcular. */
  distanceMeters: number | null;
}

export const toStoreDto = (store: StoreSummaryRecord, distanceMeters: number | null = null): StoreDto => ({
  id: store.id,
  chainId: store.chainId,
  chainName: store.chainName,
  name: store.name,
  address: store.address,
  city: store.city,
  province: store.province,
  latitude: store.latitude,
  longitude: store.longitude,
  distanceMeters,
});
