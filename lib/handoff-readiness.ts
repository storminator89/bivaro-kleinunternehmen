import { prisma } from '@/lib/prisma';
import type { AccountantExportPeriod } from '@/lib/accountant-export';

/** Inbox is intentionally outside the accountant ZIP. No accounting totals are recomputed. */
export async function readHandoffReadiness(userId: string, period: AccountantExportPeriod) {
  return prisma.$transaction(async tx => {
    const dated = { userId, reviewStatus: 'REVIEW', invoiceDate: { gte: period.start, lt: period.endExclusive } };
    const undated = { userId, reviewStatus: 'REVIEW', invoiceDate: null };
    const sample = { id: true, originalFileName: true } as const;
    const datedCount = await tx.purchaseDocument.count({ where: dated });
    const undatedCount = await tx.purchaseDocument.count({ where: undated });
    const undatedUploadedInPeriod = await tx.purchaseDocument.count({ where: { ...undated, uploadedAt: { gte: period.start, lt: period.endExclusive } } });
    return {
      period: { from: period.from, to: period.to }, checkedAt: new Date().toISOString(),
      incoming: {
        datedCount, undatedCount, undatedUploadedInPeriod,
        datedExamples: await tx.purchaseDocument.findMany({ where: dated, select: sample, orderBy: { id: 'asc' }, take: 5 }),
        undatedExamples: await tx.purchaseDocument.findMany({ where: undated, select: sample, orderBy: { id: 'asc' }, take: 5 }),
      },
    };
  });
}
