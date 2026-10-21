import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { parseBusinessDate } from '@/lib/business-date';
import { parseMoneyEUR, formatMoneyEUR } from '@/lib/money';
import { withProcessingSlot } from '@/lib/processing-limit';
import { supplierSelect, supplierSnapshot } from '@/lib/suppliers';
import { findPurchaseDuplicateHints } from './duplicates';
import { canonicalPhotoJson, isPhotoMedia, type ManualPhotoSnapshot } from './manual-photo-contract';
import { buildManualPhotoSnapshot, stableManualPhotoSnapshot, validateManualPhotoSnapshot } from './manual-photo-review';
import { detectPurchaseContainer } from './original';
import { buildAiApprovedSnapshot, closedSourceAiExtractionState } from './ai-provenance';
import { PurchaseDocumentError } from './errors';
import { readPurchaseOriginal } from './original';
import { parsePurchaseBytes, PURCHASE_PARSER_VERSION } from './parser';
import { assertSourceState, expectedRevision, parseUploadRequestId, purchaseDocumentDetail, requirePurchaseDocument } from './service';
import type { PurchaseExpenseApprovalResponse } from './types';

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 255 || /[\u0000-\u001f\u007f]/.test(value)) throw new PurchaseDocumentError(`${label} ist erforderlich (1–255 Zeichen).`);
  return value.trim();
}
function approvalMoney(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value) || value.length > 100) throw new PurchaseDocumentError('Betrag muss als positive EUR-Dezimalzeichenfolge mit höchstens zwei Nachkommastellen angegeben werden.');
  try {
    const cents = parseMoneyEUR(value, { mode: 'strict' });
    if (cents <= BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER) || parseMoneyEUR(Number(cents) / 100, { mode: 'strict' }) !== cents) throw new Error();
    return cents;
  } catch { throw new PurchaseDocumentError('Betrag ist nicht sicher centgenau als Ausgabe darstellbar.'); }
}
export function normalizePurchaseApproval(input: Record<string, unknown>) {
  const requestId = parseUploadRequestId(input.approvalRequestId), revision = expectedRevision(input.expectedRevision);
  const description = text(input.description, 'Beschreibung'), category = text(input.category, 'Kategorie');
  if (input.confirmPaymentDate !== true || input.confirmReviewedOriginal !== true || input.confirmBuyerBelongsToBusiness !== true) throw new PurchaseDocumentError('Original, richtiger Käufer/betriebliche Zugehörigkeit und tatsächliche Zahlung samt Datum müssen ausdrücklich bestätigt werden.', 400, 'CONFIRMATION_REQUIRED');
  let date: Date;
  try { date = parseBusinessDate(input.expenseDate); } catch { throw new PurchaseDocumentError('Tatsächliches Zahlungsdatum muss ein gültiges Datum im Format YYYY-MM-DD sein.'); }
  const cents = approvalMoney(input.amount);
  if (typeof input.taxRelevant !== 'boolean') throw new PurchaseDocumentError('Steuerrelevanz muss ausdrücklich gewählt werden.');
  if (typeof input.taxDeductiblePercentage !== 'string' || !/^\d{1,3}(?:\.\d{1,2})?$/.test(input.taxDeductiblePercentage)) throw new PurchaseDocumentError('Abzugsanteil muss ausdrücklich als Wert von 0 bis 100 angegeben werden.');
  const deductible = Number(input.taxDeductiblePercentage);
  if (deductible > 100) throw new PurchaseDocumentError('Abzugsanteil muss zwischen 0 und 100 liegen.');
  const depreciation = input.depreciationYears;
  if (depreciation !== null && (typeof depreciation !== 'number' || !Number.isSafeInteger(depreciation) || depreciation < 1 || depreciation > 2_147_483_647)) throw new PurchaseDocumentError('Abschreibungsdauer muss null oder eine positive ganze Jahreszahl sein.');
  if (!Array.isArray(input.acknowledgedDuplicates) || input.acknowledgedDuplicates.length > 50) throw new PurchaseDocumentError('Aktuelle Dublettenhinweise müssen ausdrücklich geprüft werden.');
  const duplicates = input.acknowledgedDuplicates.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PurchaseDocumentError('Ungültige Dublettenbestätigung.');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 1 || item.id > 2_147_483_647) throw new PurchaseDocumentError('Ungültige Dublettenbestätigung.');
    return { id: item.id, revision: expectedRevision(item.revision) };
  }).sort((a, b) => a.id - b.id);
  if (new Set(duplicates.map(item => item.id)).size !== duplicates.length) throw new PurchaseDocumentError('Dublettenbestätigung enthält doppelte IDs.');
  return { requestId, revision, values: { description, category, amount: Number(cents) / 100, date, taxRelevant: input.taxRelevant, taxDeductiblePercentage: deductible, depreciationYears: depreciation as number | null }, cents, duplicates };
}
export async function selectPurchaseSupplier(userId: string, id: number, revision: number, supplierId: unknown) {
  if (supplierId !== null && (typeof supplierId !== 'number' || !Number.isSafeInteger(supplierId) || supplierId < 1 || supplierId > 2_147_483_647)) throw new PurchaseDocumentError('Lieferanten-ID ist ungültig.');
  await inTransaction(async tx => {
    const document = await tx.purchaseDocument.findFirst({ where: { userId, id } });
    if (!document) throw new PurchaseDocumentError('Eingangsbeleg nicht gefunden.', 404, 'NOT_FOUND');
    assertSourceState(document);
    if (document.reviewStatus !== 'REVIEW') throw new PurchaseDocumentError('Lieferanten können nur offenen Belegen zugeordnet werden.', 409, 'SOURCE_LINKED');
    const supplier = supplierId === null ? null : await tx.supplier.findFirst({ where: { userId, id: supplierId as number }, select: supplierSelect });
    if (supplierId !== null && !supplier) throw new PurchaseDocumentError('Lieferant nicht gefunden.', 404, 'NOT_FOUND');
    const snapshot = supplier ? supplierSnapshot(supplier) : null;
    const changed = await tx.purchaseDocument.updateMany({ where: { userId, id, revision, reviewStatus: 'REVIEW', expenseId: null }, data: { supplierId: supplier?.id ?? null, selectedSupplierSnapshot: snapshot ? snapshot as Prisma.InputJsonValue : Prisma.DbNull, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    await createFinancialAuditLog({ userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: id, oldValues: { supplierId: document.supplierId, selectedSupplierSnapshot: document.selectedSupplierSnapshot }, newValues: { supplierId: supplier?.id ?? null, selectedSupplierSnapshot: snapshot }, metadata: { actorId: userId, tenantId: userId, operation: 'purchase-document.supplier', originalReference: document.originalSha256, reason: 'explicit supplier selection; original seller and buyer snapshots unchanged' } }, tx);
  });
  return purchaseDocumentDetail(userId, id);
}
export async function approvePurchaseExpense(userId: string, id: number, input: Record<string, unknown>): Promise<PurchaseExpenseApprovalResponse> {
  const normalized = normalizePurchaseApproval(input);
  const original = await requirePurchaseDocument(userId, id);
  // Cached or restored previews can never authorize a financial mutation.
  const bytes = await readPurchaseOriginal(original);
  const manual = isPhotoMedia(original.mediaType);
  if (!manual && input.manualPhotoReview !== undefined) throw new PurchaseDocumentError('Manuelle Foto-Freigabe ist für dieses Original nicht vorgesehen.', 409, 'UNSUPPORTED_APPROVAL');
  let manualSnapshot: ManualPhotoSnapshot | null = null;
  const reparsed = manual ? null : await withProcessingSlot(userId, () => parsePurchaseBytes(original.mediaType, bytes), normalized.requestId);
  if (manual) {
    await withProcessingSlot(userId, () => detectPurchaseContainer({ name: original.mediaType === 'image/jpeg' ? 'original.jpg' : 'original.png', type: original.mediaType, size: bytes.length }, bytes), normalized.requestId);
    manualSnapshot = buildManualPhotoSnapshot(original, normalized.revision, input.manualPhotoReview, normalized.values);
  } else {
    if (!reparsed?.preview?.approvalSupported || reparsed.preview.currency !== 'EUR' || reparsed.preview.documentType !== 'INVOICE' || !reparsed.preview.grossAmount) throw new PurchaseDocumentError('Dieses Original unterstützt keine Ausgabenerfassung. Nur positive, centgenaue EUR-Rechnungen ohne Vorauszahlung, Gutschrift oder Teilbetrag sind unterstützt.', 409, 'UNSUPPORTED_APPROVAL');
    if (parseMoneyEUR(reparsed.preview.grossAmount, { mode: 'strict' }) !== normalized.cents) throw new PurchaseDocumentError('Der bestätigte Betrag stimmt nicht mit dem Original-Bruttobetrag überein.', 400, 'AMOUNT_MISMATCH');
  }
  const outcome = await inTransaction(async tx => {
    const document = await tx.purchaseDocument.findFirst({ where: { userId, id }, include: { expense: true } });
    if (!document) throw new PurchaseDocumentError('Eingangsbeleg nicht gefunden.', 404, 'NOT_FOUND');
    assertSourceState(document);
    if (['storedFileName', 'originalSha256', 'originalByteCount', 'mediaType', 'originalFileName'].some(key => document[key as keyof typeof document] !== original[key as keyof typeof original])) throw new PurchaseDocumentError('Originalreferenz wurde inzwischen geändert.', 409, 'ORIGINAL_INTEGRITY');
    if (!document.supplierId || !document.selectedSupplierSnapshot || typeof document.selectedSupplierSnapshot !== 'object' || Array.isArray(document.selectedSupplierSnapshot) || document.selectedSupplierSnapshot.id !== document.supplierId || !await tx.supplier.findFirst({ where: { id: document.supplierId, userId }, select: { id: true } })) throw new PurchaseDocumentError('Ein Lieferant muss ausdrücklich ausgewählt und dem Beleg zugeordnet werden.', 409, 'SUPPLIER_REQUIRED');
    // Fingerprints use immutable source identity and historical contact content,
    // never local surrogate IDs which are deliberately remapped on restore.
    const historicalSupplier = Object.fromEntries(Object.keys(supplierSelect).filter(key => key !== 'id').map(key => [key, (document.selectedSupplierSnapshot as Prisma.JsonObject)[key]]));
    const acknowledgedSources = normalized.duplicates.length ? await tx.purchaseDocument.findMany({ where: { userId, id: { in: normalized.duplicates.map(item => item.id) } }, select: { id: true, originalSha256: true } }) : [];
    if (acknowledgedSources.length !== normalized.duplicates.length) throw new PurchaseDocumentError('Dublettenhinweise konnten nicht zugeordnet werden. Bitte neu laden.', 409, 'DUPLICATE_REVIEW_REQUIRED');
    const duplicateIdentities = normalized.duplicates.map(item => ({ originalSha256: acknowledgedSources.find(source => source.id === item.id)!.originalSha256, revision: item.revision })).sort((a, b) => a.originalSha256.localeCompare(b.originalSha256));
    const checkedManual = manual ? buildManualPhotoSnapshot(document, normalized.revision, input.manualPhotoReview, normalized.values) : null;
    if (checkedManual && canonicalPhotoJson(checkedManual) !== canonicalPhotoJson(manualSnapshot)) throw new PurchaseDocumentError('Prüfentwurf wurde inzwischen geändert.', 409, 'PHOTO_DRAFT_CHANGED');
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...(checkedManual ? { manualSource: stableManualPhotoSnapshot(checkedManual) } : {}), policy: 'purchase-approval-v1', originalSha256: document.originalSha256, ...normalized.values, amount: formatMoneyEUR(normalized.cents), date: normalized.values.date.toISOString(), supplierSnapshot: historicalSupplier, acknowledgedDuplicates: duplicateIdentities, reviewedOriginal: true, buyerBelongsToBusinessAttested: true, paymentDateConfirmed: true })).digest('hex');
    if (document.reviewStatus === 'BOOKED') {
      if (!document.expense || document.expense.userId !== userId || document.expense.storedReceiptFileName !== document.storedFileName) throw new PurchaseDocumentError('Quellenverknüpfung ist inkonsistent.', 409, 'SOURCE_STATE');
      if (manual) validateManualPhotoSnapshot(document.reviewedSourceSnapshot, document, document.expense);
      if (document.approvalRequestId === normalized.requestId && document.approvalFingerprint === fingerprint) return { expense: document.expense, replayed: true };
      throw new PurchaseDocumentError('Dieser Beleg wurde bereits als Ausgabe erfasst. Geänderte Bestätigungen erzeugen keine weitere Ausgabe.', 409, 'APPROVAL_CONFLICT');
    }
    if (document.reviewStatus !== 'REVIEW' || document.revision !== normalized.revision) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    if (!manual && (document.parseStatus !== 'PARSED' || document.parserVersion !== PURCHASE_PARSER_VERSION || !document.parsedData)) throw new PurchaseDocumentError('Das Original muss vor der Bestätigung erneut ausgelesen und die aktuelle Vorschau geprüft werden.', 409, 'REPARSE_REQUIRED');
    const seller = checkedManual?.supplierName ?? reparsed!.preview!.sellerInfo.name, number = checkedManual?.invoiceNumber ?? reparsed!.preview!.invoiceNumber;
    const duplicates = (await findPurchaseDuplicateHints(tx, userId, id, seller, number)).map(({ id: duplicateId, revision }) => ({ id: duplicateId, revision }));
    if (duplicates.length > 50 || JSON.stringify(duplicates) !== JSON.stringify(normalized.duplicates)) throw new PurchaseDocumentError('Dublettenhinweise haben sich geändert. Bitte aktuellen Beleg erneut prüfen und bestätigen.', 409, 'DUPLICATE_REVIEW_REQUIRED');
    const frozenAiExtraction = closedSourceAiExtractionState(document.aiExtraction,document.originalSha256,'AI_SOURCE_APPROVED');
    const aiApprovedSnapshot = checkedManual ? buildAiApprovedSnapshot(document) : null;
    const expense = await tx.expense.create({ data: { ...normalized.values, userId, receiptFileName: document.originalFileName, storedReceiptFileName: document.storedFileName } });
    const changed = await tx.purchaseDocument.updateMany({ where: { id, userId, reviewStatus: 'REVIEW', revision: normalized.revision, expenseId: null, originalSha256: original.originalSha256, storedFileName: original.storedFileName }, data: { ...(frozenAiExtraction ? { aiExtraction: frozenAiExtraction as unknown as Prisma.InputJsonValue } : {}), ...(aiApprovedSnapshot ? { aiApprovedSnapshot: aiApprovedSnapshot as unknown as Prisma.InputJsonValue } : {}), ...(checkedManual ? { reviewedSourceSnapshot: checkedManual as unknown as Prisma.InputJsonValue } : {}), reviewStatus: 'BOOKED', expenseId: expense.id, approvalRequestId: normalized.requestId, approvalFingerprint: fingerprint, approvedAt: new Date(), revision: { increment: 1 } } });
    if (changed.count !== 1) throw new PurchaseDocumentError('Beleg wurde gleichzeitig erfasst. Bitte neu laden oder mit demselben Schlüssel wiederholen.', 409, 'REVISION_CONFLICT');
    const confirmed = { ...(aiApprovedSnapshot ? { aiApprovedSnapshot } : {}), ...(checkedManual ? { reviewedSourceSnapshot: checkedManual } : {}), expenseId: expense.id, purchaseDocumentId: id, approvalRequestId: normalized.requestId, originalSha256: document.originalSha256, supplierId: document.supplierId, selectedSupplierSnapshot: document.selectedSupplierSnapshot, confirmedValues: normalized.values, acknowledgedDuplicates: normalized.duplicates, buyerBelongsToBusinessAttested: true, paymentDateConfirmed: true, originalReviewed: true };
    const metadata = { actorId: userId, tenantId: userId, operation: 'purchase-document.approve-expense', originalReference: document.originalSha256, reason: 'explicit reviewed original, buyer/belonging attestation and actual payment date; no external identity or bank verification' };
    await createFinancialAuditLog({ userId, action: 'CREATE', entityType: 'Expense', entityId: expense.id, entityName: expense.description, newValues: { ...expense, sourceApproval: confirmed }, metadata }, tx);
    await createFinancialAuditLog({ userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: id, oldValues: { reviewStatus: 'REVIEW', revision: document.revision }, newValues: { ...confirmed, reviewStatus: 'BOOKED', revision: document.revision + 1 }, metadata }, tx);
    return { expense, replayed: false };
  });
  return { document: await purchaseDocumentDetail(userId, id), ...outcome };
}
