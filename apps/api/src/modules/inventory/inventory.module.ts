import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/** Despensa privada (P4-01). CRUD sencillo: servicio con ownership, sin capas vacías. */
@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
