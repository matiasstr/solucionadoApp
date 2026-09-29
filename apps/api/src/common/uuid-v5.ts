import { createHash } from 'node:crypto';

/**
 * UUID v5 (RFC 4122): el mismo nombre en el mismo namespace da siempre el mismo id.
 * Lo usan el seed DEMO y los importadores para escribir de forma idempotente sin
 * agregar unicidades artificiales al schema.
 */
function namespaceBytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new RangeError('Namespace UUID inválido.');
  return Buffer.from(hex, 'hex');
}

export function uuidV5(name: string, namespace: string): string {
  const digest = createHash('sha1').update(namespaceBytes(namespace)).update(name, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // versión 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
