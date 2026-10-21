import { parseBusinessDate } from '@/lib/business-date';
import { parseMoneyEUR, formatMoneyEUR } from '@/lib/money';
import type { IncomingDocument, PurchaseExpenseApprovalInput } from '@/lib/purchase-documents/types';

export function approvalBlockedReason(document: IncomingDocument): string | null {
  if (document.reviewState !== 'REVIEW') return 'Nur offene Belege können erfasst werden. Verworfene Belege zuerst wieder öffnen.';
  if (document.parseStatus !== 'PARSED' || !document.preview) return 'Für diesen Beleg fehlen unterstützte strukturierte Rechnungsdaten. Original prüfen; gegebenenfalls ein korrektes PDF mit eingebettetem XML oder eine XML-Rechnung hochladen.';
  if (document.preview.documentType !== 'INVOICE') return 'Gutschriften und andere Dokumenttypen werden hier nicht gebucht. Sie benötigen einen eigenen geprüften Korrektur- oder Erstattungsablauf.';
  if (document.currency !== 'EUR') return 'Nur EUR-Rechnungen werden unterstützt. Keine automatische Währungsumrechnung.';
  if (!document.approvalSupported) return 'Diese Rechnung erfüllt die unterstützten Buchungsregeln nicht. Prüfhinweise und Original kontrollieren: Teilzahlungen, Vorauszahlungen, Rundungsbeträge oder fehlerhafte Quelldaten benötigen eine getrennte Klärung.';
  if (!document.supplierId || !document.selectedSupplierSnapshot) return 'Bitte zuerst einen Lieferantenkontakt ausdrücklich auswählen. Das Original bleibt davon getrennt.';
  return null;
}
export function validPaymentDate(value: string): boolean {
  try { parseBusinessDate(value); return true; } catch { return false; }
}
export function approvalAmount(value: string | null): string {
  try { return value === null ? '' : formatMoneyEUR(parseMoneyEUR(value, { mode: 'strict' })); } catch { return ''; }
}
export function validBusinessShare(value: string): boolean {
  return /^\d{1,3}(?:[.,]\d{1,2})?$/.test(value) && Number(value.replace(',', '.')) <= 100;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function approvalIdentityPrefix(tenantId: string, documentId: number): string {
  return `bivaro-purchase-approval:${encodeURIComponent(tenantId)}:${documentId}:`;
}
/** Persist only an opaque UUID. Financial fields never leave in-memory form state. */
export async function approvalIdentityKey(tenantId: string, documentId: number, input: Omit<PurchaseExpenseApprovalInput, 'approvalRequestId'>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${approvalIdentityPrefix(tenantId, documentId)}${fingerprint}`;
}
export function hasApprovalIdentity(storage: Storage, tenantId: string, documentId: number): boolean {
  const prefix = approvalIdentityPrefix(tenantId, documentId);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && /^[0-9a-f]{64}$/.test(key.slice(prefix.length)) && UUID.test(storage.getItem(key) ?? '')) return true;
  }
  return false;
}
export function storedApprovalId(value: string | null): string | null { return value && UUID.test(value) ? value : null; }
