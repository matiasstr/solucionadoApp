import { Module } from '@nestjs/common';
import { StoreProximityRepository } from './infrastructure/store-proximity.repository';
import { StoreRepository } from './infrastructure/store.repository';

/** Comercios: cadenas, sucursales y consultas espaciales. Endpoints en P2-02. */
@Module({
  providers: [StoreRepository, StoreProximityRepository],
  exports: [StoreRepository, StoreProximityRepository],
})
export class StoresModule {}
