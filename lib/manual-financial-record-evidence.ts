import { createHash } from 'node:crypto';
import { formatMoneyEUR, parseMoneyEUR } from '@/lib/money';
import type { ManualFinancialRecordKind, ManualFinancialRecordOperation } from '@/lib/manual-financial-record-contract';

export const MAX_MANUAL_RECORD_EVENTS = 256;
export const MAX_MANUAL_RECORD_BACKUP_EVENTS = 10000;
export const MANUAL_RECORD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MANUAL_RECORD_SHA256 = /^[a-f0-9]{64}$/;
export class ManualFinancialRecordError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field?: string) {
    super(message); this.name = 'ManualFinancialRecordError';
  }
}
export function manualRecordHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)]));
    return item;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
/** Strict cents + exact round trip through the existing Float projection. Never normalize legacy values. */
export function manualRecordAmount(value: unknown, input = false): string {
  try {
    if (input && (typeof value !== 'string' || !/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(value))) throw new Error('decimal');
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('type');
    const cents = parseMoneyEUR(value);
    if (cents < BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('range');
    const amount = formatMoneyEUR(cents);
    if (parseMoneyEUR(Number(amount)) !== cents) throw new Error('projection');
    return amount;
  } catch {
    throw new ManualFinancialRecordError(400, 'MANUAL_RECORD_INVALID_AMOUNT', 'Der Betrag muss nichtnegativ, centgenau und im sicher darstellbaren EUR-Bereich sein. Bestehende Werte werden nicht gerundet.');
  }
}
export type ManualRecordOriginalEvidence = {
  status: 'NONE' | 'ARCHIVED'; fileName: string | null; sha256: string | null; byteCount: number | null;
};
export type ManualRecordSnapshot = {
  contractVersion: 1;
  recordId: string;
  kind: ManualFinancialRecordKind;
  amount: string;
  originalAmount: string;
  currency: 'EUR';
  description: string;
  paymentDate: string;
  date: string;
  taxRelevant: boolean;
  customer: { name: string; contactPerson: string | null; email: string | null; address: string | null; zipCode: string | null; city: string | null; taxNumber: string | null } | null;
  category: string | null;
  taxDeductiblePercentage: number | null;
  receiptUrl: string | null;
  depreciationYears: number | null;
  original: ManualRecordOriginalEvidence;
  // A declaration is only the user's scope declaration, never invented provenance/fiscal review.
  legacyManualDeclaration: boolean;
};
export type ManualRecordEventEvidence = {
  id: string; recordId: string; kind: ManualFinancialRecordKind; sequence: number;
  operation: ManualFinancialRecordOperation; mutationId: string; semanticHash: string;
  previousHash: string | null; snapshot: ManualRecordSnapshot; hash: string;
  reason: string | null; createdAt: string;
};
export function manualRecordEventHash(event: Omit<ManualRecordEventEvidence, 'hash'>): string {
  return manualRecordHash(event);
}
export function assertManualRecordNotFinalized(row: { manualRecordState: string }): void {
  if (row.manualRecordState === 'FINALIZED') throw new ManualFinancialRecordError(409, 'FINALIZED_RECORD', 'Festgeschriebene manuelle Einträge sind unveränderlich. Verwenden Sie die begründete Betragskorrektur.');
}
