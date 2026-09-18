import * as argon2 from 'argon2';

// Parámetros mínimos recomendados por OWASP para Argon2id (19 MiB, t=2, p=1).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Verificación contra un hash descartable: iguala el tiempo de respuesta si el email no existe. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('tusofertas-timing-equalizer');
  await verifyPassword(await dummyHash, password);
  return false;
}
