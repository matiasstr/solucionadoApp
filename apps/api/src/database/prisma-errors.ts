import { Prisma } from '../generated/prisma/client';

/** P2002 = violación de unicidad; P2025 = registro inexistente. */
export function isPrismaError(error: unknown, code: 'P2002' | 'P2025'): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
