import { createHash } from 'node:crypto';

/**
 * Identificadores deterministas del dataset demo (UUID v5, RFC 4122).
 * La misma clave produce siempre el mismo id: el seed puede correr dos veces
 * sin duplicar filas y sin agregar unicidades artificiales al schema.
 */
const DEMO_NAMESPACE = '3f2a6d5e-7c41-4a19-9b8d-2c5e1f0a6b73';

function namespaceBytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new RangeError('Namespace UUID inválido.');
  return Buffer.from(hex, 'hex');
}

export function uuidV5(name: string, namespace: string = DEMO_NAMESPACE): string {
  const digest = createHash('sha1').update(namespaceBytes(namespace)).update(name, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // versión 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Id estable por tipo de entidad: `producto:arroz-pampa-1kg` nunca choca con `tienda:...`. */
export const demoId = (kind: string, key: string): string => uuidV5(`${kind}:${key}`);

/** Entero de 32 bits estable: variación de precios reproducible sin azar real. */
export function stableHash32(value: string): number {
  return createHash('sha1').update(value, 'utf8').digest().readUInt32BE(0);
}
