import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';
import { AccountantExportError, parseAccountantExportPeriod } from '@/lib/accountant-export';

export type HandoffAcknowledgementIdentity = { from: string; to: string; sourceFingerprint: string; formatVersion: 1 };
export function parseHandoffAcknowledgement(value: unknown): HandoffAcknowledgementIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountantExportError('Ungültiger Paketstand.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['from', 'to', 'sourceFingerprint', 'formatVersion'].includes(key)) ||
      typeof data.from !== 'string' || typeof data.to !== 'string' || data.formatVersion !== 1 ||
      typeof data.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceFingerprint)) throw new AccountantExportError('Ungültiger Paketstand.');
  const period = parseAccountantExportPeriod(new URLSearchParams({ from: data.from, to: data.to }));
  return { from: period.from, to: period.to, sourceFingerprint: data.sourceFingerprint, formatVersion: 1 };
}
const scope = (userId: string, identity: HandoffAcknowledgementIdentity) => ({
  userId, action: 'REVIEW', entityType: 'AccountantHandoff',
  // Period is in the identity as well as bounded metadata; the lookup never trusts a client tenant ID.
  entityId: `${identity.from}:${identity.to}:${identity.sourceFingerprint}`,
});
export async function readHandoffAcknowledgement(userId: string, identity: HandoffAcknowledgementIdentity) {
  const row = await prisma.auditLog.findFirst({ where: scope(userId, identity), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } });
  return { acknowledgedAt: row?.createdAt.toISOString() ?? null };
}
/** Atomic SQLite insert-if-absent: one write statement owns the duplicate check.
 * No check-then-create window or in-memory mutex is relied on across clients.
 */
export async function recordHandoffAcknowledgementInTransaction(tx: Prisma.TransactionClient, userId: string, identity: HandoffAcknowledgementIdentity) {
  const exact = scope(userId, identity);
  const metadata = JSON.stringify({ operation: 'SELF_RECORDED_RECEIPT', ...identity, acknowledgement: 'USER_RECORDED_NOT_VERIFIED' });
  const inserted = await tx.$executeRaw`
    INSERT INTO "AuditLog" ("userId", "action", "entityType", "entityId", "entityName", "metadata", "createdAt")
    SELECT ${userId}, ${exact.action}, ${exact.entityType}, ${exact.entityId}, ${'Manuelle Empfangsnotiz'}, ${metadata}, ${new Date()}
    WHERE NOT EXISTS (
      SELECT 1 FROM "AuditLog"
      WHERE "userId" = ${userId} AND "action" = ${exact.action}
        AND "entityType" = ${exact.entityType} AND "entityId" = ${exact.entityId}
    )`;
  const row = await tx.auditLog.findFirstOrThrow({ where: exact, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } });
  return { acknowledgedAt: row.createdAt.toISOString(), replayed: inserted === 0 };
}
export async function recordHandoffAcknowledgement(userId: string, identity: HandoffAcknowledgementIdentity) {
  // Only database work is retried. Failed/ambiguous retries preserve the first
  // retained note and never manufacture a newer receipt timestamp.
  return inTransaction(tx => recordHandoffAcknowledgementInTransaction(tx, userId, identity));
}
