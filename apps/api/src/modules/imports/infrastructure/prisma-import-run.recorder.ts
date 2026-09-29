/**
 * Ejecuciones de importación y cuarentena en la base (P7-02, ADR 0019). Cada escritura
 * es chica: la ejecución se crea al empezar, sus contadores se actualizan después de
 * cada lote confirmado y los rechazos se agregan por tandas.
 */
import type { PrismaService } from '../../../database/prisma.service';
import type { ImportRunSummary, Rejection } from '../domain/import.types';
import type { ImportKind, ImportProgress, ImportRunRecorder, StoredImportRun } from '../application/ports';

const KIND = { prices: 'PRICES', promotions: 'PROMOTIONS' } as const;
const FROM_KIND = { PRICES: 'prices', PROMOTIONS: 'promotions' } as const;

type Counters = Pick<
  ImportRunSummary,
  | 'read' | 'created' | 'duplicates' | 'conflicts' | 'updated' | 'rejected' | 'storesCreated' | 'productsCreated'
  | 'productsPendingCanonical' | 'eansDiscarded' | 'batches' | 'retries' | 'committedPosition'
>;

/** Lo cumplen el resumen en memoria y la fila guardada. */
const counters = (summary: Counters): Counters => ({
  read: summary.read,
  created: summary.created,
  duplicates: summary.duplicates,
  conflicts: summary.conflicts,
  updated: summary.updated,
  rejected: summary.rejected,
  storesCreated: summary.storesCreated,
  productsCreated: summary.productsCreated,
  productsPendingCanonical: summary.productsPendingCanonical,
  eansDiscarded: summary.eansDiscarded,
  batches: summary.batches,
  retries: summary.retries,
  committedPosition: summary.committedPosition,
});

export interface ImportRunReport {
  readonly run: StoredImportRun & {
    readonly startedAt: string;
    readonly finishedAt: string | null;
    readonly resumedFromId: string | null;
    readonly error: string | null;
    readonly counters: Counters;
  };
  readonly quarantine: {
    readonly total: number;
    readonly byReason: Record<string, number>;
    readonly first: readonly Rejection[];
  };
}

export class PrismaImportRunRecorder implements ImportRunRecorder {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: { kind: ImportKind; source: string; startedAt: Date; resumedFromId: string | null }): Promise<string> {
    const run = await this.prisma.importRun.create({
      data: { kind: KIND[input.kind], source: input.source, startedAt: input.startedAt, resumedFromId: input.resumedFromId },
      select: { id: true },
    });
    return run.id;
  }

  async quarantine(runId: string, rejections: readonly Rejection[]): Promise<void> {
    if (!rejections.length) return;
    await this.prisma.quarantinedRecord.createMany({
      data: rejections.map((rejection) => ({
        runId,
        position: rejection.position,
        reason: rejection.reason,
        detail: rejection.detail.slice(0, 300),
        ref: rejection.ref?.slice(0, 200) ?? null,
      })),
    });
  }

  async progress(runId: string, progress: ImportProgress): Promise<void> {
    await this.prisma.importRun.update({ where: { id: runId }, data: counters(progress.summary) });
  }

  async finish(runId: string, summary: ImportRunSummary): Promise<void> {
    await this.prisma.importRun.update({
      where: { id: runId },
      data: {
        ...counters(summary),
        status: summary.status,
        finishedAt: new Date(summary.finishedAt),
        error: summary.error?.slice(0, 300) ?? null,
      },
    });
  }

  async find(runId: string): Promise<StoredImportRun | null> {
    const run = await this.prisma.importRun.findUnique({
      where: { id: runId },
      select: { id: true, kind: true, source: true, status: true, committedPosition: true },
    });
    return run ? { ...run, kind: FROM_KIND[run.kind] } : null;
  }

  /** Ejecución y cuarentena para diagnosticar: contadores por motivo y las primeras filas. */
  async report(runId: string, limit = 20): Promise<ImportRunReport | null> {
    const run = await this.prisma.importRun.findUnique({ where: { id: runId } });
    if (!run) return null;
    const [byReason, first] = await Promise.all([
      this.prisma.quarantinedRecord.groupBy({ by: ['reason'], where: { runId }, _count: { _all: true } }),
      this.prisma.quarantinedRecord.findMany({ where: { runId }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: limit }),
    ]);
    const grouped = Object.fromEntries(byReason.map((row) => [row.reason, row._count._all]));
    return {
      run: {
        id: run.id,
        kind: FROM_KIND[run.kind],
        source: run.source,
        status: run.status,
        committedPosition: run.committedPosition,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        resumedFromId: run.resumedFromId,
        error: run.error,
        counters: counters(run),
      },
      quarantine: {
        total: Object.values(grouped).reduce((total, value) => total + value, 0),
        byReason: grouped,
        first: first.map((row) => ({ position: row.position, reason: row.reason as Rejection['reason'], detail: row.detail, ref: row.ref })),
      },
    };
  }
}
