import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/** Cliente Prisma 7 con adaptador pg. Conecta de forma diferida: el proceso arranca sin DB. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(databaseUrl: string) {
    super({
      adapter: new PrismaPg({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 3_000 }),
    });
  }

  /** Readiness: una consulta real con tope de tiempo. Nunca propaga detalles de conexión. */
  async isReady(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([this.$queryRaw`SELECT 1`.then(() => true as const), timeout]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
