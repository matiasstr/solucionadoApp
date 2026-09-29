/** Errores de entrada del planificador: nombran el campo, como `RoutineRuleError`. */
export type PlanningRuleErrorCode = 'PLAN_WINDOW_INVALID' | 'PLAN_WINDOW_TOO_LONG';

export class PlanningRuleError extends Error {
  constructor(
    readonly code: PlanningRuleErrorCode,
    message: string,
    readonly fields: readonly string[],
  ) {
    super(message);
    this.name = 'PlanningRuleError';
  }
}
