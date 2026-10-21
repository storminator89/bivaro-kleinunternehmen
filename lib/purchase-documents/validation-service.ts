import { randomUUID } from 'node:crypto';
import { Prisma, type PurchaseValidationReport } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { withProcessingSlot } from '@/lib/processing-limit';
import { requirePurchaseDocument } from './service';
import { readPurchaseOriginal } from './original';
import { PurchaseDocumentError } from './errors';
import { validatePurchaseOriginal } from './validation-runtime';
import { isCurrentPurchaseValidation, PURCHASE_RULES_VERSION, PURCHASE_VALIDATION_VERSION, type PurchaseValidationRecord, type PurchaseValidationResponse } from './validation-contract';
import { technicalReportFingerprint, validateTechnicalReport, validationRequestId } from './validation-evidence';

function dto(row: PurchaseValidationReport, hash: string): PurchaseValidationRecord {
  const report = validateTechnicalReport(row.report, hash);
  if (technicalReportFingerprint(report) !== row.fingerprint || !['LOCAL', 'IMPORTED_HISTORIC'].includes(row.provenance)) throw new PurchaseDocumentError('Prüfbericht ist inkonsistent. Bitte das Original erneut prüfen.', 409, 'VALIDATION_INTEGRITY');
  const evidence = { id: row.stableKey, provenance: row.provenance as PurchaseValidationRecord['provenance'], report };
  return { ...evidence, current: isCurrentPurchaseValidation(evidence, hash) };
}
async function history(userId: string, hash: string): Promise<PurchaseValidationResponse> {
  const rows = await prisma.purchaseValidationReport.findMany({ where: { userId, originalSha256: hash }, orderBy: [{ provenance: 'desc' }, { checkedAt: 'desc' }, { id: 'desc' }], take: 20 });
  return { reports: rows.map(row => dto(row, hash)) };
}
/** An arbitrary hash is never a history authorization token. Verify an owned original first. */
export async function purchaseValidationHistory(userId: string, id: number): Promise<PurchaseValidationResponse> {
  const document = await requirePurchaseDocument(userId, id);
  await readPurchaseOriginal(document);
  return history(userId, document.originalSha256);
}
export async function validateIncomingPurchase(userId: string, id: number, input: { expectedRevision: number; expectedSha256: unknown; requestId: unknown; checkerVersion: unknown; rulesVersion: unknown }): Promise<PurchaseValidationResponse> {
  let requestId: string;
  try { requestId = validationRequestId(input.requestId); }
  catch { throw new PurchaseDocumentError('Ein gültiger Prüfschlüssel ist erforderlich.'); }
  const document = await requirePurchaseDocument(userId, id);
  if (input.expectedSha256 !== document.originalSha256) throw new PurchaseDocumentError('Originalreferenz hat sich geändert. Bitte neu laden.', 409, 'ORIGINAL_CONFLICT');
  if (input.checkerVersion !== PURCHASE_VALIDATION_VERSION || input.rulesVersion !== PURCHASE_RULES_VERSION) throw new PurchaseDocumentError('Die Prüfversion hat sich geändert. Bitte neu laden und die Prüfung bewusst erneut starten.', 409, 'VALIDATION_VERSION_CHANGED');
  const bytes = await readPurchaseOriginal(document);
  const replay = await prisma.purchaseValidationReport.findUnique({ where: { userId_requestId: { userId, requestId } } });
  if (replay) {
    if (replay.originalSha256 !== document.originalSha256 || !isCurrentPurchaseValidation(dto(replay, document.originalSha256), document.originalSha256)) throw new PurchaseDocumentError('Prüfschlüssel gehört zu einem anderen Original oder Prüfstand.', 409, 'VALIDATION_REQUEST_CONFLICT');
    return { ...(await history(userId, document.originalSha256)), replayed: true };
  }
  if (input.expectedRevision !== document.revision) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
  return withProcessingSlot(userId, async () => {
    const report = validateTechnicalReport(await validatePurchaseOriginal({ bytes, expectedSha256: document.originalSha256, mediaType: document.mediaType }), document.originalSha256);
    const fingerprint = technicalReportFingerprint(report);
    let replayed = false;
    await inTransaction(async tx => {
      const current = await tx.purchaseDocument.findFirst({ where: { userId, id, originalSha256: document.originalSha256, originalByteCount: document.originalByteCount, storedFileName: document.storedFileName } });
      if (!current) throw new PurchaseDocumentError('Das Original wurde inzwischen geändert oder wiederhergestellt. Bitte neu laden.', 409, 'ORIGINAL_CONFLICT');
      const winner = await tx.purchaseValidationReport.findUnique({ where: { userId_requestId: { userId, requestId } } });
      if (winner) {
        if (winner.originalSha256 !== document.originalSha256 || !isCurrentPurchaseValidation(dto(winner, document.originalSha256), document.originalSha256)) throw new PurchaseDocumentError('Prüfschlüssel wurde bereits anders verwendet.', 409, 'VALIDATION_REQUEST_CONFLICT');
        replayed = true; return;
      }
      const stableKey = randomUUID();
      await tx.purchaseValidationReport.create({ data: { id: stableKey, stableKey, userId, originalSha256: document.originalSha256, sourceDocumentIdAtCheck: id, requestId, fingerprint, provenance: 'LOCAL', report: report as unknown as Prisma.InputJsonValue, checkedAt: new Date(report.checkedAt) } });
      await createFinancialAuditLog({ userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: id,
        newValues: { technicalReportId: stableKey, status: report.status, rulesVersion: report.rulesVersion },
        metadata: { actorId: userId, tenantId: userId, operation: 'purchase-document.validate', originalReference: document.originalSha256, reason: 'technical evidence only; no posting or accounting approval' } }, tx);
    });
    return { ...(await history(userId, document.originalSha256)), replayed };
  });
}
