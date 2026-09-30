import { PublicHttpException } from '../../../common/public-http.exception';
import type { PrismaService } from '../../../database/prisma.service';
import type { ShoppingPlansService } from '../../shopping-plans/application/shopping-plans.service';
import { addDays } from '../../shopping-plans/domain/plan-calendar';
import { resolveWeekStart } from '../domain/job-contracts';
import type { WeeklyPlansPayload } from '../domain/job-contracts';
import { JobFailedError } from './job-context';

/** Prefijo de la clave de idempotencia: la web usa UUID, así que no se cruzan. */
export const WEEKLY_PLAN_KEY_PREFIX = 'job-weekly-';
const USERS_PAGE = 100;

export interface WeeklyPlansResult {
  readonly weekStart: string;
  readonly weekEnd: string;
  /** Usuarios con rutinas que tienen productos. */
  readonly users: number;
  readonly created: number;
  /** Ya tenían el plan de esa semana (reintento o job repetido): no se duplica. */
  readonly replayed: number;
  /** Sin necesidades en la semana: no se guarda un plan vacío. */
  readonly withoutNeeds: number;
  /** Rechazos esperables del planificador, por código (por ejemplo, sin ubicación). */
  readonly skipped: Readonly<Record<string, number>>;
}

/**
 * Job `GENERATE_WEEKLY_PLANS` (P8-01): un borrador por usuario y semana con el mismo servicio
 * que usa `POST /shopping-plans/generate` (ADR 0015) y la clave `job-weekly-<lunes>`, así que
 * repetir el job o reintentarlo devuelve los planes ya guardados. Un error inesperado de un
 * usuario no frena a los demás, pero hace fallar el intento para reintentarlo.
 */
export class WeeklyPlansJobRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: ShoppingPlansService,
  ) {}

  /** `scheduledFor` resuelve la semana de una programación (`weekStart: null`). */
  async run(payload: WeeklyPlansPayload, scheduledFor: Date): Promise<WeeklyPlansResult> {
    const weekStart = resolveWeekStart(payload.weekStart, scheduledFor);
    const weekEnd = addDays(weekStart, 6);
    const key = `${WEEKLY_PLAN_KEY_PREFIX}${weekStart}`;
    let users = 0;
    let created = 0;
    let replayed = 0;
    let withoutNeeds = 0;
    let failed = 0;
    const skipped: Record<string, number> = {};
    for await (const userId of this.eligibleUsers(payload.userId)) {
      users += 1;
      try {
        const result = await this.plans.generateScheduled(userId, { startDate: weekStart, endDate: weekEnd }, key);
        if (!result) withoutNeeds += 1;
        else if (result.created) created += 1;
        else replayed += 1;
      } catch (error: unknown) {
        if (error instanceof PublicHttpException && error.getStatus() < 500) {
          skipped[error.error] = (skipped[error.error] ?? 0) + 1;
        } else {
          failed += 1;
        }
      }
    }
    if (failed > 0) {
      throw new JobFailedError(`No se pudo generar el plan de ${failed} de ${users} usuarios; al reintentar, los ya generados no se duplican.`);
    }
    return { weekStart, weekEnd, users, created, replayed, withoutNeeds, skipped };
  }

  /** Por páginas y en orden de id: no carga todos los usuarios en memoria. */
  private async *eligibleUsers(only: string | null): AsyncGenerator<string> {
    let after: string | null = null;
    for (;;) {
      const idFilter: { equals: string } | { gt: string } | undefined = only ? { equals: only } : after ? { gt: after } : undefined;
      const rows: { id: string }[] = await this.prisma.user.findMany({
        where: { id: idFilter, shoppingRoutines: { some: { items: { some: {} } } } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: USERS_PAGE,
      });
      for (const row of rows) yield row.id;
      if (only || rows.length < USERS_PAGE) return;
      after = rows[rows.length - 1]!.id;
    }
  }
}
