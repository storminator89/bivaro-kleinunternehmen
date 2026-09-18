import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

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
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P1008', 'P2028'].includes(error.code);
      if (!retryable || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
