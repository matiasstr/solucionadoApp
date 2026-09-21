import { Module } from '@nestjs/common';
import { SearchStoresUseCase } from './application/search-stores.use-case';
import { StoreProximityRepository } from './infrastructure/store-proximity.repository';
import { StoreRepository } from './infrastructure/store.repository';
import { StoresController } from './presentation/stores.controller';

/** Comercios: cadenas, sucursales, consultas espaciales y sus endpoints de lectura. */
@Module({
  controllers: [StoresController],
  providers: [StoreRepository, StoreProximityRepository, SearchStoresUseCase],
  exports: [StoreRepository, StoreProximityRepository],
})
export class StoresModule {}
