import { ValidateIf } from 'class-validator';
import { isPrismaError } from '../database/prisma-errors';
import { PublicHttpException } from './public-http.exception';

/** Error de una regla de dominio: código estable, mensaje para la persona y campos implicados. */
interface RuleError extends Error {
  readonly code: string;
  readonly fields: readonly string[];
}

type RuleErrorClass = abstract new (...args: never[]) => RuleError;

/**
 * Traduce los errores de reglas del dominio a `400` con su código; cualquier otro
 * error sigue su curso (y termina como `500` sin detalles).
 */
export function rethrowRuleErrors(kinds: readonly RuleErrorClass[]): (error: unknown) => never {
  return (error: unknown) => {
    if (kinds.some((kind) => error instanceof kind)) {
      const rule = error as RuleError;
      throw new PublicHttpException(400, rule.code, rule.message, rule.fields);
    }
    throw error;
  };
}

/** Violación de unicidad traducida a un conflicto público; el resto se relanza. */
export function rethrowUniqueAs(conflict: PublicHttpException): (error: unknown) => never {
  return (error: unknown) => {
    if (isPrismaError(error, 'P2002')) throw conflict;
    throw error;
  };
}

/**
 * Campo que se puede omitir pero no enviar como `null` (`@IsOptional` acepta
 * ambos). Sirve para columnas no nulas en un PATCH.
 */
export const IsOptionalNotNull = () => ValidateIf((_object: object, value: unknown) => value !== undefined);
