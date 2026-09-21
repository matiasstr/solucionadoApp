/**
 * Clave idempotente de una observación (docs/DOMAIN.md). Se deriva de la identidad
 * estable del evento de origen: producto, sucursal y día observado. No usar solo
 * producto+sucursal: borraría el historial al reintentar una importación.
 */

const MAX_KEY_LENGTH = 200;

export interface ObservationIdentity {
  readonly productKey: string;
  readonly storeKey: string;
  /** Instante observado; la clave usa su fecha UTC. */
  readonly observedAt: Date;
  /** Identificador propio del proveedor, cuando existe. */
  readonly externalId?: string | null;
}

export function utcDateKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function buildIdempotencyKey(identity: ObservationIdentity): string {
  const parts = identity.externalId
    ? [identity.externalId]
    : [identity.productKey, identity.storeKey, utcDateKey(identity.observedAt)];
  const key = parts.map((part) => part.trim()).join(':');
  if (!key || key.length > MAX_KEY_LENGTH) {
    throw new RangeError('La clave idempotente debe tener entre 1 y 200 caracteres.');
  }
  return key;
}
