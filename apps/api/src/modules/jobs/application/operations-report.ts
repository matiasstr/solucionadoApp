import type { PrismaService } from '../../../database/prisma.service';
import { WEEKLY_PLAN_KEY_PREFIX } from './weekly-plans.job';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ImportSourceStatus {
  readonly kind: 'PRICES' | 'PROMOTIONS';
  readonly source: string;
  /** Última ejecución terminada sin error (puede tener rechazos). */
  readonly lastSuccess: { readonly runId: string; readonly finishedAt: string; readonly status: string } | null;
  /** Última ejecución, sea cual sea su estado. */
  readonly lastRun: { readonly runId: string; readonly startedAt: string; readonly status: string; readonly error: string | null };
}

export interface StaleImportRun {
  readonly runId: string;
  readonly kind: string;
  readonly source: string;
  readonly startedAt: string;
  readonly lastProgressAt: string;
  readonly committedPosition: number;
}

export interface PriceFreshness {
  readonly source: string;
  readonly latestObservedAt: string;
  readonly ageDays: number;
  /** Más viejo que `PRICE_MAX_AGE_DAYS`: los precios de esta fuente se muestran como desactualizados. */
  readonly stale: boolean;
}

export interface OperationsSnapshot {
  readonly imports: readonly ImportSourceStatus[];
  readonly staleImportRuns: readonly StaleImportRun[];
  readonly priceFreshness: readonly PriceFreshness[];
  readonly weeklyPlans: { readonly latestWeekStart: string | null; readonly plans: number; readonly byStatus: Readonly<Record<string, number>> };
}

interface RunRow {
  id: string;
  kind: 'PRICES' | 'PROMOTIONS';
  source: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

/**
 * Estado operativo desde la base (P8-02): último éxito por fuente, ejecuciones abiertas sin
 * avance, frescura de precios por fuente y los últimos planes semanales programados. Solo
 * agregados: ningún dato de usuarios.
 */
export class OperationsReport {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: { readonly staleRunMinutes: number; readonly priceMaxAgeDays: number },
  ) {}

  async snapshot(now = new Date()): Promise<OperationsSnapshot> {
    const [imports, staleImportRuns, priceFreshness, weeklyPlans] = await Promise.all([
      this.imports(),
      this.staleRuns(now),
      this.freshness(now),
      this.weeklyPlans(),
    ]);
    return { imports, staleImportRuns, priceFreshness, weeklyPlans };
  }

  private async imports(): Promise<ImportSourceStatus[]> {
    const [latest, successes] = await Promise.all([
      this.prisma.$queryRaw<RunRow[]>`
        SELECT DISTINCT ON ("kind", "source") "id"::text AS id, "kind", "source", "status", "startedAt", "finishedAt", "error"
        FROM "ImportRun" ORDER BY "kind", "source", "startedAt" DESC, "id" DESC`,
      this.prisma.$queryRaw<RunRow[]>`
        SELECT DISTINCT ON ("kind", "source") "id"::text AS id, "kind", "source", "status", "startedAt", "finishedAt", "error"
        FROM "ImportRun" WHERE "status" IN ('COMPLETED', 'COMPLETED_WITH_REJECTIONS')
        ORDER BY "kind", "source", "finishedAt" DESC, "id" DESC`,
    ]);
    const success = new Map(successes.map((row) => [`${row.kind}:${row.source}`, row]));
    return latest.map((row) => {
      const ok = success.get(`${row.kind}:${row.source}`);
      return {
        kind: row.kind,
        source: row.source,
        lastSuccess: ok && ok.finishedAt ? { runId: ok.id, finishedAt: ok.finishedAt.toISOString(), status: ok.status } : null,
        lastRun: { runId: row.id, startedAt: row.startedAt.toISOString(), status: row.status, error: row.error },
      };
    });
  }

  private async staleRuns(now: Date): Promise<StaleImportRun[]> {
    const rows = await this.prisma.importRun.findMany({
      where: { status: 'RUNNING', updatedAt: { lt: new Date(now.getTime() - this.options.staleRunMinutes * 60_000) } },
      select: { id: true, kind: true, source: true, startedAt: true, updatedAt: true, committedPosition: true },
      orderBy: { startedAt: 'asc' },
      take: 50,
    });
    return rows.map((row) => ({
      runId: row.id,
      kind: row.kind,
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      lastProgressAt: row.updatedAt.toISOString(),
      committedPosition: row.committedPosition,
    }));
  }

  private async freshness(now: Date): Promise<PriceFreshness[]> {
    const rows = await this.prisma.$queryRaw<{ source: string; latest: Date }[]>`
      SELECT "source", max("observedAt") AS latest FROM "ProductPrice" GROUP BY "source" ORDER BY "source"`;
    return rows.map((row) => {
      const ageDays = Math.max(0, Math.floor((now.getTime() - row.latest.getTime()) / DAY_MS));
      return { source: row.source, latestObservedAt: row.latest.toISOString(), ageDays, stale: ageDays > this.options.priceMaxAgeDays };
    });
  }

  private async weeklyPlans(): Promise<OperationsSnapshot['weeklyPlans']> {
    const scheduled = { idempotencyKey: { startsWith: WEEKLY_PLAN_KEY_PREFIX } };
    const latest = await this.prisma.shoppingPlan.findFirst({ where: scheduled, orderBy: { startDate: 'desc' }, select: { startDate: true } });
    if (!latest) return { latestWeekStart: null, plans: 0, byStatus: {} };
    const groups = await this.prisma.shoppingPlan.groupBy({
      by: ['status'],
      where: { ...scheduled, startDate: latest.startDate },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
    return {
      latestWeekStart: latest.startDate.toISOString().slice(0, 10),
      plans: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
    };
  }
}
