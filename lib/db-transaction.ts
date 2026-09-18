import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// SQLite permits only one writer at a time. Prisma's transaction retry loop
// handles short-lived busy errors, but several concurrent write transactions
// can otherwise wait long enough to hit the test/request timeout before the
// retry is observable. Keep transactions on the same client in a FIFO queue;
// separate Prisma clients (for example isolated test databases) remain
// independent.
const transactionTails = new WeakMap<object, Promise<void>>();

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
  const client = prisma as object;
  const previous = transactionTails.get(client) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  transactionTails.set(client, current);

  await previous;
  try {
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
  } finally {
    release();
    if (transactionTails.get(client) === current) transactionTails.delete(client);
  }
}
