import { Prisma } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { PurchaseDocumentError } from './errors';
import { parsePurchaseReviewDraft } from './review-draft';
import { purchaseDocumentDetail, requirePurchaseDocument } from './service';

export async function savePurchaseReviewDraft(userId: string, id: number, revision: number, value: unknown) {
  const draft = parsePurchaseReviewDraft(value);
  const document = await requirePurchaseDocument(userId, id);
  if (document.reviewStatus !== 'REVIEW') throw new PurchaseDocumentError('Nur offene Belege haben einen bearbeitbaren Prüfentwurf.', 409, 'STATE_CONFLICT');
  await inTransaction(async tx => {
    const changed = await tx.purchaseDocument.updateMany({ where: { id, userId, revision, reviewStatus: 'REVIEW', expenseId: null }, data: { ...(document.aiDraftProvenance && typeof document.aiDraftProvenance === 'object' && !Array.isArray(document.aiDraftProvenance) ? { aiDraftProvenance: { ...document.aiDraftProvenance, provenance: 'AI_USER_EDITED' } as Prisma.InputJsonValue } : {}), reviewDraft: draft as Prisma.InputJsonValue, reviewDraftSearch: [draft.supplierName, draft.invoiceNumber].filter(Boolean).join(' · '), reviewDraftSavedAt: new Date(), revision: { increment: 1 } } });
    if (changed.count !== 1) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    await createFinancialAuditLog({ userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: id,
      newValues: { reviewDraft: draft, revision: revision + 1 },
      metadata: { actorId: userId, tenantId: userId, operation: 'purchase-document.save-review-draft', originalReference: document.originalSha256, reason: 'explicitly saved unposted review draft; no payment or ledger entry' } }, tx);
  });
  return purchaseDocumentDetail(userId, id);
}
