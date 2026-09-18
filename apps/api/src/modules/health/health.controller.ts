import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getLiveness(): { status: 'ok'; service: string } {
    // Liveness only. Database/Redis readiness will be added when they are connected.
    return { status: 'ok', service: 'tusofertas-api' };
  }
}
