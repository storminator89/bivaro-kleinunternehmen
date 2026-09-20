import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';

/** Records an SMTP acknowledgement; this does not make SMTP itself idempotent. */
export async function recordDocumentDelivery(input: {
  userId: string;
  invoiceId: number;
  documentType: 'invoice' | 'quote';
  expectedStatus: string;
  messageId: string;
}) {
  if (!input.messageId || input.messageId.length > 998) throw new Error('Ungültige SMTP-Nachrichtenreferenz');
  return inTransaction(async tx => {
    const current = await tx.invoice.findFirst({ where: {
      id: input.invoiceId, userId: input.userId,
      type: input.documentType === 'quote' ? 'QUOTE' : { not: 'QUOTE' },
    } });
    if (!current) throw new Error('Dokument nicht gefunden');
    const entityType = input.documentType === 'quote' ? 'Quote' : 'Invoice';
    // Transaction serialization makes repeated acknowledgements harmless.
    // Different SMTP message IDs represent different actual send attempts.
    const previous = await tx.auditLog.findMany({ where: {
      userId: input.userId, entityType, entityId: String(current.id), action: 'EMAIL_SENT',
      metadata: { contains: JSON.stringify(input.messageId) },
    }, select: { metadata: true } });
    if (previous.some(event => {
      try {
        const metadata = JSON.parse(event.metadata ?? '{}');
        return metadata.operation === 'document.delivery-acknowledged' && metadata.messageId === input.messageId;
      } catch { return false; }
    })) return { recorded: false };

    const advance = input.expectedStatus === 'DRAFT' && current.status === 'DRAFT' && current.issuanceState === 'ISSUED';
    if (advance) {
      await tx.invoice.update({ where: { id: current.id, userId: input.userId, status: 'DRAFT' }, data: { status: 'SENT' } });
      await createFinancialAuditLog({
        userId: input.userId, action: 'STATUS_CHANGED', entityType, entityId: current.id,
        oldValues: { status: current.status }, newValues: { status: 'SENT' },
        metadata: { actorId: input.userId, tenantId: input.userId, operation: 'invoice.issued', originalReference: `invoice:${current.id}`, reason: 'SMTP acknowledged delivery', messageId: input.messageId },
      }, tx);
    }
    await createFinancialAuditLog({
      userId: input.userId, action: 'EMAIL_SENT', entityType, entityId: current.id,
      metadata: {
        actorId: input.userId, tenantId: input.userId,
        operation: 'document.delivery-acknowledged', originalReference: `invoice:${current.id}`,
        reason: 'SMTP acknowledged delivery', messageId: input.messageId,
        expectedStatus: input.expectedStatus, observedStatus: current.status,
        statusConflict: current.status !== input.expectedStatus && current.status !== 'SENT',
        resultingStatus: advance ? 'SENT' : current.status,
      },
    }, tx);
    return { recorded: true };
  });
}
