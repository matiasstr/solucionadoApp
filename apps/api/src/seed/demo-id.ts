import { createHash } from 'node:crypto';
import { uuidV5 as baseUuidV5 } from '../common/uuid-v5';

/**
 * Identificadores deterministas del dataset demo (UUID v5, RFC 4122).
 * La misma clave produce siempre el mismo id: el seed puede correr dos veces
 * sin duplicar filas y sin agregar unicidades artificiales al schema.
 */
const DEMO_NAMESPACE = '3f2a6d5e-7c41-4a19-9b8d-2c5e1f0a6b73';

export function uuidV5(name: string, namespace: string = DEMO_NAMESPACE): string {
  return baseUuidV5(name, namespace);
}

/** Id estable por tipo de entidad: `producto:arroz-pampa-1kg` nunca choca con `tienda:...`. */
export const demoId = (kind: string, key: string): string => uuidV5(`${kind}:${key}`);

/** Entero de 32 bits estable: variación de precios reproducible sin azar real. */
export function stableHash32(value: string): number {
  return createHash('sha1').update(value, 'utf8').digest().readUInt32BE(0);
}
