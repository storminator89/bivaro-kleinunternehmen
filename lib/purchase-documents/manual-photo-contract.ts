import { parsePurchaseReviewDraft } from './review-draft';
import { PurchaseDocumentError } from './errors';
import type { PurchaseReviewDraft } from './types';

export type ManualPhotoConfirmation = {
  expectedDraft: PurchaseReviewDraft; expectedDraftSavedAt: string;
  buyerName: string; currency: 'EUR'; documentType: 'INVOICE';
  confirmSourceOwnership: true; confirmExactDraftValues: true; confirmOrdinaryInvoice: true;
};
export type ManualPhotoSnapshot = {
  version: 1; provenance: 'MANUAL_PHOTO_REVIEW'; ownerId: string; reviewedByTenantId: string;
  sourceUploadRequestId: string; originalSha256: string; originalByteCount: number; mediaType: 'image/jpeg' | 'image/png';
  reviewedDocumentRevision: number; reviewDraftSavedAt: string; reviewDraftFingerprint: string;
  supplierName: string; invoiceNumber: string; invoiceDate: string; paymentDate: string; grossAmount: string;
  currency: 'EUR'; documentType: 'INVOICE'; buyerName: string; businessPurpose: string;
  attestations: { sourceOwned: true; exactDraftValues: true; ordinaryInvoice: true; originalReviewed: true; buyerBelongsToBusiness: true; fullPayment: true };
};
export function canonicalPhotoJson(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : item;
  return JSON.stringify(stable(value));
}
export function isPhotoMedia(media: string): media is 'image/jpeg' | 'image/png' { return media === 'image/jpeg' || media === 'image/png'; }
export function completePhotoDraft(value: unknown): PurchaseReviewDraft {
  const draft = parsePurchaseReviewDraft(value);
  if (!draft.supplierName || !draft.invoiceNumber || !draft.invoiceDate || !draft.paymentDate || !draft.amount) throw new PurchaseDocumentError('Für die manuelle Foto-Freigabe bitte Lieferant, Rechnungsnummer, Rechnungsdatum, tatsächliches Zahlungsdatum und EUR-Bruttobetrag ausdrücklich speichern.', 409, 'PHOTO_DRAFT_REQUIRED');
  return draft;
}
export function parseManualPhotoConfirmation(value: unknown): ManualPhotoConfirmation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PurchaseDocumentError('Manuelle Originalprüfung muss ausdrücklich bestätigt werden.', 400, 'CONFIRMATION_REQUIRED');
  const input = value as Record<string, unknown>;
  const keys = ['expectedDraft', 'expectedDraftSavedAt', 'buyerName', 'currency', 'documentType', 'confirmSourceOwnership', 'confirmExactDraftValues', 'confirmOrdinaryInvoice'];
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) throw new PurchaseDocumentError('Manuelle Originalbestätigung enthält unbekannte oder fehlende Felder.');
  const expectedDraft = completePhotoDraft(input.expectedDraft);
  if (canonicalPhotoJson(expectedDraft) !== canonicalPhotoJson(input.expectedDraft)) throw new PurchaseDocumentError('Gespeicherte Entwurfsangaben müssen unverändert bestätigt werden.', 409, 'PHOTO_DRAFT_CHANGED');
  if (typeof input.expectedDraftSavedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expectedDraftSavedAt) || !Number.isFinite(new Date(input.expectedDraftSavedAt).getTime()) || new Date(input.expectedDraftSavedAt).toISOString() !== input.expectedDraftSavedAt) throw new PurchaseDocumentError('Gespeicherter Entwurfszeitpunkt ist erforderlich.');
  if (typeof input.buyerName !== 'string' || !input.buyerName.trim() || input.buyerName.trim().length > 1000 || /[\u0000-\u001f\u007f]/.test(input.buyerName)) throw new PurchaseDocumentError('Empfänger / Käufer laut Original ist erforderlich (1–1000 Zeichen).');
  if (input.currency !== 'EUR' || input.documentType !== 'INVOICE' || input.confirmSourceOwnership !== true || input.confirmExactDraftValues !== true || input.confirmOrdinaryInvoice !== true) throw new PurchaseDocumentError('Nur gewöhnliche eigene EUR-Einkaufsrechnungen nach ausdrücklicher manueller Prüfung sind unterstützt. Keine Gutschriften, Erstattungen oder Teil-/Vorauszahlungen.', 400, 'CONFIRMATION_REQUIRED');
  return { expectedDraft, expectedDraftSavedAt: input.expectedDraftSavedAt, buyerName: input.buyerName.trim(), currency: 'EUR', documentType: 'INVOICE', confirmSourceOwnership: true, confirmExactDraftValues: true, confirmOrdinaryInvoice: true };
}
