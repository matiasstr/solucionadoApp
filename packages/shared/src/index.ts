/** Importes decimales transportados como texto; el cálculo ocurre en el dominio. */
export type DecimalString = string;

export interface MoneyDto {
  amount: DecimalString;
  currency: 'ARS';
}

/** Contrato público: nunca agregar hashes, tokens ni entidades Prisma. */
export interface HealthResponse {
  status: 'ok';
  service: string;
}
