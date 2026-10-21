import { createHash } from 'node:crypto';
import { parseMoneyEUR } from '@/lib/money';
import { formatBusinessDate } from '@/lib/business-date';
import { PurchaseDocumentError } from './errors';
import { canonicalPhotoJson, completePhotoDraft, isPhotoMedia, parseManualPhotoConfirmation, type ManualPhotoSnapshot } from './manual-photo-contract';
import type { PurchaseReviewDraft } from './types';

export function photoDraftFingerprint(draft: PurchaseReviewDraft, savedAt: string): string {
  return createHash('sha256').update(canonicalPhotoJson({ draft: completePhotoDraft(draft), savedAt })).digest('hex');
}
type Binding = { userId: string; uploadRequestId: string; originalSha256: string; originalByteCount: number; mediaType: string; revision: number; reviewDraft: unknown; reviewDraftSavedAt: Date | string | null; reviewedSourceSnapshot?: unknown };
export function buildManualPhotoSnapshot(document: Binding, revision: number, confirmation: unknown, values: { amount: number; date: Date; description: string }): ManualPhotoSnapshot {
  const input = parseManualPhotoConfirmation(confirmation);
  const draft = completePhotoDraft(document.reviewDraft);
  const savedAt = document.reviewDraftSavedAt instanceof Date ? document.reviewDraftSavedAt.toISOString() : document.reviewDraftSavedAt;
  if (!isPhotoMedia(document.mediaType) || !savedAt || savedAt !== input.expectedDraftSavedAt || canonicalPhotoJson(draft) !== canonicalPhotoJson(input.expectedDraft)) throw new PurchaseDocumentError('Gespeicherter Prüfentwurf hat sich geändert. Neu laden, speichern und erneut bestätigen.', 409, 'PHOTO_DRAFT_CHANGED');
  if (parseMoneyEUR(draft.amount, { mode: 'strict' }) !== parseMoneyEUR(values.amount, { mode: 'strict' }) || draft.paymentDate !== formatBusinessDate(values.date) || values.date.toISOString() !== `${draft.paymentDate}T00:00:00.000Z`) throw new PurchaseDocumentError('Betrag und Zahlungsdatum müssen mit dem ausdrücklich gespeicherten Fotoentwurf übereinstimmen.', 400, 'AMOUNT_MISMATCH');
  const prior = document.reviewedSourceSnapshot as ManualPhotoSnapshot | null | undefined;
  return { version: 1, provenance: 'MANUAL_PHOTO_REVIEW', ownerId: document.userId, reviewedByTenantId: prior?.reviewedByTenantId ?? document.userId,
    sourceUploadRequestId: document.uploadRequestId, originalSha256: document.originalSha256, originalByteCount: document.originalByteCount, mediaType: document.mediaType,
    reviewedDocumentRevision: revision, reviewDraftSavedAt: savedAt, reviewDraftFingerprint: photoDraftFingerprint(draft, savedAt),
    supplierName: draft.supplierName, invoiceNumber: draft.invoiceNumber, invoiceDate: draft.invoiceDate, paymentDate: draft.paymentDate, grossAmount: draft.amount,
    currency: 'EUR', documentType: 'INVOICE', buyerName: input.buyerName, businessPurpose: values.description,
    attestations: { sourceOwned: true, exactDraftValues: true, ordinaryInvoice: true, originalReviewed: true, buyerBelongsToBusiness: true, fullPayment: true } };
}
/** Runtime tenant binding remaps during restore; all historical/manual values stay stable. */
export function stableManualPhotoSnapshot(snapshot: ManualPhotoSnapshot) { const { ownerId: _owner, ...stable } = snapshot; void _owner; return JSON.parse(canonicalPhotoJson(stable)) as Omit<ManualPhotoSnapshot, 'ownerId'>; }
export function validateManualPhotoSnapshot(value: unknown, document: Binding, expense: { amount: number; date: Date | string; description: string }): ManualPhotoSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PurchaseDocumentError('Manueller Quellen-Snapshot fehlt.', 409, 'SOURCE_STATE');
  const snapshot = value as ManualPhotoSnapshot;
  const reviewedRevision = document.revision - 1;
  const built = buildManualPhotoSnapshot({ ...document, reviewedSourceSnapshot: snapshot }, reviewedRevision, {
    expectedDraft: document.reviewDraft, expectedDraftSavedAt: document.reviewDraftSavedAt instanceof Date ? document.reviewDraftSavedAt.toISOString() : document.reviewDraftSavedAt,
    buyerName: snapshot.buyerName, currency: snapshot.currency, documentType: snapshot.documentType, confirmSourceOwnership: true, confirmExactDraftValues: true, confirmOrdinaryInvoice: true,
  }, { amount: expense.amount, date: expense.date instanceof Date ? expense.date : new Date(expense.date), description: expense.description });
  if (!Number.isSafeInteger(reviewedRevision) || reviewedRevision < 0 || typeof snapshot.reviewedByTenantId !== 'string' || !snapshot.reviewedByTenantId || snapshot.reviewedByTenantId.length > 200 || canonicalPhotoJson(built) !== canonicalPhotoJson(snapshot)) throw new PurchaseDocumentError('Manuelle Quelle und Ausgabe stimmen nicht überein.', 409, 'SOURCE_STATE');
  return snapshot;
}
