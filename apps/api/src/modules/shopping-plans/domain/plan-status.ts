/**
 * Estados de un plan guardado (P5-03, ADR 0015). Transiciones explícitas:
 *
 * - `DRAFT → ACTIVE`: el usuario decide seguir este plan. Otro plan `ACTIVE` del
 *   mismo usuario cuya ventana se superpone vuelve a `DRAFT`, así nunca hay dos
 *   planes activos para los mismos días (y el ahorro no se cuenta dos veces).
 * - `DRAFT → COMPLETED` y `ACTIVE → COMPLETED`: el usuario dice que ya compró.
 *   No prueba una compra ni un ahorro real: el ahorro sigue siendo estimado.
 * - `EXPIRED` no se pide: un plan en borrador o activo cuya última fecha ya pasó
 *   se informa vencido y no admite cambios. Persistirlo es trabajo de los jobs.
 *
 * Pedir el estado que ya tiene es un no-op: un reintento no falla.
 */
import type { CalendarDate } from '../../routines/domain/routine-rules';

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
export type RequestedPlanStatus = 'ACTIVE' | 'COMPLETED';
export const REQUESTED_PLAN_STATUSES: readonly RequestedPlanStatus[] = ['ACTIVE', 'COMPLETED'];

const TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>> = {
  DRAFT: ['ACTIVE', 'COMPLETED'],
  ACTIVE: ['COMPLETED'],
  COMPLETED: [],
  EXPIRED: [],
};

export type PlanStatusErrorCode = 'PLAN_EXPIRED' | 'PLAN_STATUS_TRANSITION_INVALID';

export class PlanStatusError extends Error {
  constructor(
    readonly code: PlanStatusErrorCode,
    message: string,
    readonly fields: readonly string[] = ['status'],
  ) {
    super(message);
    this.name = 'PlanStatusError';
  }
}

/** Estado a informar: el guardado, salvo un borrador o activo cuya ventana ya terminó. */
export function effectiveStatus(stored: PlanStatus, endDate: CalendarDate, today: CalendarDate): PlanStatus {
  return (stored === 'DRAFT' || stored === 'ACTIVE') && endDate < today ? 'EXPIRED' : stored;
}

/** `true` si hay que escribir; `false` si ya estaba en ese estado. */
export function assertTransition(current: PlanStatus, requested: RequestedPlanStatus): boolean {
  if (current === requested) return false;
  if (current === 'EXPIRED') {
    throw new PlanStatusError('PLAN_EXPIRED', 'Este plan ya venció: generá uno nuevo.');
  }
  if (!TRANSITIONS[current].includes(requested)) {
    throw new PlanStatusError('PLAN_STATUS_TRANSITION_INVALID', 'No se puede cambiar el plan a ese estado.');
  }
  return true;
}
