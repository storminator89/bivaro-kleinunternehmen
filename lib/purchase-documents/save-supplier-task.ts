import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { PurchaseDocumentError } from './errors';
import { parseSupplierTask, supplierTaskDto } from './supplier-task';
import { assertSourceState, purchaseDocumentDetail } from './service';

/** Independent internal task. Only this source and its mandatory REVIEW audit are written. */
export async function saveSupplierTask(userId: string, id: number, revision: number, value: unknown) {
  const task = parseSupplierTask(value);
  await inTransaction(async tx => {
    const document = await tx.purchaseDocument.findFirst({ where: { userId, id } });
    if (!document) throw new PurchaseDocumentError('Eingangsbeleg nicht gefunden.', 404, 'NOT_FOUND');
    assertSourceState(document);
    if (document.revision !== revision) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte Serverstand lesen; Ihre Eingabe bleibt erhalten.', 409, 'REVISION_CONFLICT');
    if (document.reviewStatus !== 'REVIEW') throw new PurchaseDocumentError('Nur offene Belege haben eine aktive bearbeitbare Vormerkung.', 409, 'STATE_CONFLICT');
    const changed = await tx.purchaseDocument.updateMany({
      where: { userId, id, revision, reviewStatus: 'REVIEW', expenseId: null },
      data: { supplierTaskKind: task?.kind ?? null, supplierTaskFollowUpDate: task?.followUpDate ?? null, supplierTaskConfirmationRequired: false, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte Serverstand lesen.', 409, 'REVISION_CONFLICT');
    await createFinancialAuditLog({ userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: id,
      oldValues: { supplierTask: supplierTaskDto(document), revision },
      newValues: { supplierTask: task ? { ...task, confirmationRequired: false } : null, revision: revision + 1 },
      metadata: { actorId: userId, tenantId: userId, operation: 'purchase-document.supplier-task', originalReference: document.originalSha256,
        reason: 'explicit internal supplier task only; not paid or bank-verified; no payment, posting, numbering or notification' } }, tx);
  });
  return purchaseDocumentDetail(userId, id);
}
