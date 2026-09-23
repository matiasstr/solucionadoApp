import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoutinesService } from './application/routines.service';
import { RoutinesController } from './presentation/routines.controller';

/**
 * Rutinas de compra privadas (P4-01), servidas en `/shopping-routines`. El
 * cálculo de necesidad por período llega con el planificador (P5-01).
 */
@Module({
  imports: [AuthModule],
  controllers: [RoutinesController],
  providers: [RoutinesService],
})
export class RoutinesModule {}
