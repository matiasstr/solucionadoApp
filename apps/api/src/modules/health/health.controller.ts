import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';

const service = 'tusofertas-api';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getLiveness(): { status: 'ok'; service: string } {
    // Liveness only: no depende de la base de datos.
    return { status: 'ok', service };
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response: Response) {
    const database = (await this.prisma.isReady()) ? 'up' : 'down';
    if (database === 'down') response.status(503);
    return { status: database === 'up' ? 'ok' : 'unavailable', service, checks: { database } };
  }
}
