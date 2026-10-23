import { BANK_IMPORT_HASH, BankImportError, bankImportUuid, type BankImportEvidence } from '@/lib/bank-import-contract';
import { parseBusinessDate } from '@/lib/business-date';

export const BANK_ALLOCATION_CONTRACT = 1;
export const BANK_ALLOCATION_SEARCH_LIMIT = 20;
export class BankAllocationError extends BankImportError {
  constructor(message: string, status = 400, public readonly code = 'INVALID_BANK_ALLOCATION') { super(message, status); this.name = 'BankAllocationError'; }
}
export type BankRecordPaymentInput = {
  invoiceId: number; idempotencyKey: string; expectedLedgerVersion: string; expectedRowEvidenceHash: string;
  reviewed: true; receiptConfirmed: true;
};
export type BankReallocationInput = {
  invoiceId: number; idempotencyKey: string; expectedAllocationRevision: number;
  expectedSourceLedgerVersion: string; expectedTargetLedgerVersion: string;
  actionDate: string; reason: string; cashNeutralReviewed: true;
};
export type BankAllocationSearchInput = { invoiceId?: number; search: string; cursor: number };
export type BankAllocationInvoice = {
  invoiceId: number; invoiceNumber: string; customerName: string;
  ledgerVersion: string; totalCents: string; paidCents: string; openCents: string;
};
export type BankCurrentAssignment = {
  bindingStableKey: string; originalPaymentId: number; originInvoiceId: number; originInvoiceNumber: string;
  allocatedInvoice: BankAllocationInvoice; allocationRevision: number; allocationChangeStableKey: string | null;
  amountCents: string; currency: 'EUR'; paidAt: string; canReallocate: boolean; reallocationReviewReason: string | null;
};
/** Live state is deliberately OUTSIDE immutable evidence and receipt/hash input. */
export type BankAllocationRowEnvelope = {
  rowStableKey: string; evidence: BankImportEvidence; rowEvidenceHash: string;
  assignmentState: 'UNASSIGNED' | 'ASSIGNED' | 'REVIEW_REQUIRED'; bindingStableKey: string | null; assignmentReviewReason: string | null;
  assignment: BankCurrentAssignment | null;
};
export type BankAllocationPreflight = {
  version: 1; row: BankAllocationRowEnvelope; invoices: BankAllocationInvoice[];
  nextCursor: number | null; selection: BankAllocationInvoice | null;
  canConfirm: boolean; reviewReasons: string[]; afterOpenCents: string | null; sourceAfterOpenCents: string | null;
};
export type BankPaymentOperationReceipt = {
  kind: 'BANK_PAYMENT_RECORDED'; idempotencyKey: string; bindingStableKey: string; rowStableKey: string;
  originalPaymentId: number; originInvoiceId: number; originInvoiceNumber: string;
  amountCents: string; currency: 'EUR'; paidAt: string; recordedAt: string; expectedLedgerVersion: string; expectedRowEvidenceHash: string;
};
export type BankReallocationOperationReceipt = {
  kind: 'PAYMENT_ALLOCATION_CHANGED'; idempotencyKey: string; bindingStableKey: string; changeStableKey: string;
  revision: number; fromInvoiceId: number; fromInvoiceNumber: string; toInvoiceId: number; toInvoiceNumber: string;
  amountCents: string; currency: 'EUR'; actionDate: string; reason: string; recordedAt: string; expectedSourceLedgerVersion: string; expectedTargetLedgerVersion: string;
};
export type BankAllocationOperationReceipt = BankPaymentOperationReceipt | BankReallocationOperationReceipt;
export type BankAllocationResult = { operation: BankAllocationOperationReceipt; row: BankAllocationRowEnvelope; replayed: boolean };
export type BankAllocationRecovery = { operation: BankAllocationOperationReceipt | null; row: BankAllocationRowEnvelope };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BankAllocationError('Ungültige Zuordnungsanfrage.');
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new BankAllocationError('Die Zuordnungsanfrage enthält nicht unterstützte Felder.');
}
export function bankAllocationInvoiceId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new BankAllocationError('Ungültige Rechnungskennung.');
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !BANK_IMPORT_HASH.test(value)) throw new BankAllocationError('Bitte den aktuellen Zahlungsstand erneut prüfen.');
  return value;
}
export function parseBankRecordPaymentInput(value: unknown): BankRecordPaymentInput {
  const input = record(value);
  closed(input, ['invoiceId', 'idempotencyKey', 'expectedLedgerVersion', 'expectedRowEvidenceHash', 'reviewed', 'receiptConfirmed']);
  if (input.reviewed !== true || input.receiptConfirmed !== true) throw new BankAllocationError('Bitte ausdrücklich bestätigen, dass der gespeicherte Betrag tatsächlich eingegangen ist. Die CSV ist kein unabhängiger Zahlungsnachweis.');
  return { invoiceId: bankAllocationInvoiceId(input.invoiceId), idempotencyKey: bankImportUuid(input.idempotencyKey), expectedLedgerVersion: hash(input.expectedLedgerVersion), expectedRowEvidenceHash: hash(input.expectedRowEvidenceHash), reviewed: true, receiptConfirmed: true };
}
export function parseBankReallocationInput(value: unknown): BankReallocationInput {
  const input = record(value);
  closed(input, ['invoiceId', 'idempotencyKey', 'expectedAllocationRevision', 'expectedSourceLedgerVersion', 'expectedTargetLedgerVersion', 'actionDate', 'reason', 'cashNeutralReviewed']);
  if (input.cashNeutralReviewed !== true) throw new BankAllocationError('Bitte bestätigen: Nur die Rechnungszuordnung ändert sich. Kein zusätzlicher Geldeingang und keine Rückzahlung.');
  if (typeof input.expectedAllocationRevision !== 'number' || !Number.isSafeInteger(input.expectedAllocationRevision) || input.expectedAllocationRevision < 0) throw new BankAllocationError('Ungültiger Zuordnungsstand.');
  if (typeof input.actionDate !== 'string') throw new BankAllocationError('Bitte das Entdeckungsdatum angeben.');
  try { parseBusinessDate(input.actionDate); } catch { throw new BankAllocationError('Bitte das Entdeckungsdatum als YYYY-MM-DD angeben.'); }
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000 || /[\u0000-\u001f\u007f-\u009f]/u.test(input.reason)) throw new BankAllocationError('Bitte eine Begründung mit höchstens 1.000 Zeichen angeben.');
  return { invoiceId: bankAllocationInvoiceId(input.invoiceId), idempotencyKey: bankImportUuid(input.idempotencyKey), expectedAllocationRevision: input.expectedAllocationRevision,
    expectedSourceLedgerVersion: hash(input.expectedSourceLedgerVersion), expectedTargetLedgerVersion: hash(input.expectedTargetLedgerVersion), actionDate: input.actionDate,
    reason: input.reason.normalize('NFC').trim(), cashNeutralReviewed: true };
}
export function parseBankAllocationSearchInput(value: unknown): BankAllocationSearchInput {
  const input = record(value);
  closed(input, ['invoiceId', 'search', 'cursor']);
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(input.search))) throw new BankAllocationError('Die Rechnungssuche ist ungültig.');
  if (input.cursor !== undefined && (typeof input.cursor !== 'number' || !Number.isSafeInteger(input.cursor) || input.cursor < 0)) throw new BankAllocationError('Ungültige Suchseite.');
  return { ...(input.invoiceId !== undefined ? { invoiceId: bankAllocationInvoiceId(input.invoiceId) } : {}), search: typeof input.search === 'string' ? input.search.normalize('NFC').trim() : '', cursor: typeof input.cursor === 'number' ? input.cursor : 0 };
}
