import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Errores de MariaDB que son choques momentáneos entre dos escrituras, no
 * fallos de verdad:
 *
 * - **1020** `Record has changed since last read`. InnoDB en MariaDB lo
 *   lanza cuando la fila cambió entre la lectura y la escritura de la misma
 *   sentencia. Sale cuando dos conexiones actualizan la misma fila a la vez,
 *   que es justo lo que hacen el progreso del crawler y su latido.
 * - **1213** interbloqueo y **1205** espera de bloqueo agotada.
 *
 * En los tres casos lo correcto es reintentar: el dato que se escribe es el
 * último que se leyó en memoria, no depende de lo que hubiera en la fila.
 */
const RETRYABLE_MYSQL_CODES = ['1020', '1213', '1205'];

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MYSQL_CODES.some((code) => message.includes(`code: ${code}`));
}

/**
 * Reintenta una escritura que chocó con otra concurrente.
 *
 * Sólo debe envolver operaciones idempotentes —fijar un contador o una
 * marca de tiempo—, nunca un incremento relativo, que al repetirse contaría
 * de más.
 */
export async function retryOnConflict<T>(
  operation: () => Promise<T>,
  attempts = 6,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;
      // Espera creciente con azar proporcional, para que dos escritores que
      // chocan no vuelvan a reintentar a la vez.
      const base = 20 * 2 ** attempt;
      const wait = base + Math.random() * base;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  throw lastError;
}

/**
 * Los ids de Page/Link/Issue son BigInt y `JSON.stringify` no los serializa.
 * Convertimos recursivamente a string/number antes de responder desde la API.
 */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}
