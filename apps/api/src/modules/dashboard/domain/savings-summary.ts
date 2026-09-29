/**
 * Ahorro estimado del dashboard (P6-02, ADR 0017). Función pura.
 *
 * Solo cuentan planes que la persona eligió seguir: `COMPLETED` siempre y
 * `ACTIVE` mientras su ventana siga abierta. Un borrador, un plan reemplazado o
 * uno activo que venció sin completarse no suman. Si dos planes elegibles se
 * superponen, cuenta uno solo: el completado antes que el activo y, entre
 * iguales, el generado más recientemente (la versión vigente del período).
 *
 * Todo es **estimado**: no hay registro de compras, así que nunca se presenta
 * como ahorro real.
 */
import { DecimalValue } from '../../catalog/domain/decimal';

export type CalendarDate = string;
export type SavingsPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'EXPIRED';

export interface PlanForSavings {
  readonly id: string;
  /** Estado informado (un activo vencido llega como `EXPIRED`). */
  readonly status: SavingsPlanStatus;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  readonly generatedAt: Date;
  /** Null si el plan no tuvo base comparable: no suma, pero se cuenta aparte. */
  readonly estimatedSavings: string | null;
}

export interface SavingsBucket {
  readonly amount: string;
  readonly plans: number;
}

export interface SavingsSummary {
  readonly week: SavingsBucket;
  readonly month: SavingsBucket;
  readonly total: SavingsBucket;
  /** Planes elegidos que no suman por no tener base comparable. */
  readonly plansWithoutBaseline: number;
  /** Ids de los planes que cuentan, en orden de inicio. */
  readonly countedPlanIds: readonly string[];
}

const MONEY_SCALE = 2;
const MS_PER_DAY = 86_400_000;

const overlaps = (a: PlanForSavings, b: PlanForSavings) => a.startDate <= b.endDate && b.startDate <= a.endDate;

/** Un plan por período: completados primero, después el más nuevo; desempate por id. */
export function selectPlansForSavings(plans: readonly PlanForSavings[]): PlanForSavings[] {
  const eligible = plans
    .filter((plan) => plan.status === 'COMPLETED' || plan.status === 'ACTIVE')
    .sort(
      (a, b) =>
        Number(b.status === 'COMPLETED') - Number(a.status === 'COMPLETED') ||
        b.generatedAt.getTime() - a.generatedAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const selected: PlanForSavings[] = [];
  for (const plan of eligible) {
    if (!selected.some((chosen) => overlaps(chosen, plan))) selected.push(plan);
  }
  return selected.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

/** Lunes de la semana ISO (lunes a domingo) de una fecha de calendario. */
export function weekStart(date: CalendarDate): CalendarDate {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  const isoWeekday = ((new Date(time).getUTCDay() + 6) % 7) + 1;
  return new Date(time - (isoWeekday - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}

function bucket(plans: readonly PlanForSavings[]): SavingsBucket {
  const counted = plans.filter((plan) => plan.estimatedSavings !== null);
  const amount = counted.reduce(
    (total, plan) => total.add(DecimalValue.parse(plan.estimatedSavings as string)),
    DecimalValue.zero(MONEY_SCALE),
  );
  return { amount: amount.toFixed(MONEY_SCALE), plans: counted.length };
}

/**
 * Semana y mes se asignan por la fecha de **inicio** del plan (semana ISO y mes
 * calendario de hoy, en Argentina): cada plan cae en un solo período.
 */
export function summarizeSavings(plans: readonly PlanForSavings[], today: CalendarDate): SavingsSummary {
  const selected = selectPlansForSavings(plans);
  const monday = weekStart(today);
  const sunday = new Date(Date.parse(`${monday}T00:00:00.000Z`) + 6 * MS_PER_DAY).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  return {
    week: bucket(selected.filter((plan) => plan.startDate >= monday && plan.startDate <= sunday)),
    month: bucket(selected.filter((plan) => plan.startDate.slice(0, 7) === month)),
    total: bucket(selected),
    plansWithoutBaseline: selected.filter((plan) => plan.estimatedSavings === null).length,
    countedPlanIds: selected.map((plan) => plan.id),
  };
}
