import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** SQLite reports a busy/locked database from raw statements as P2010. */
export function isRetryableDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (['P1008', 'P2028', 'P2034'].includes(error.code)) return true;
    if (error.code === 'P2010') {
      const meta = error.meta as { code?: unknown; message?: unknown } | undefined;
      return String(meta?.code) === '5' || /database is locked|SQLITE_BUSY/i.test(String(meta?.message));
    }
  }
  return error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message);
}

/** Retry only transactions containing database work, never external side effects. */
export async function inTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= 7) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(250, 10 * 2 ** attempt)));
    }
  }
}
