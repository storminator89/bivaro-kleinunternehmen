import { createHash } from 'node:crypto';
import { exactPaymentCents, paymentSummary, PaymentJournalError, type PaymentAllocation } from './contract';
import type { MoneyInput } from '@/lib/money';

export type AdjustmentKind = 'PAYMENT_CORRECTION' | 'CUSTOMER_REFUND';
export type AdjustmentInput = {
  kind: AdjustmentKind; originalPaymentId: number; amount: string; actionDate: string;
  reason: string; reference: string; idempotencyKey: string; expectedLedgerVersion: string;
  cancellationInvoiceId?: number; declarationNeverReceived?: boolean;
};
export type LedgerRoot = PaymentAllocation & { id: number };
export type LedgerAdjustment = { originalPaymentId: number; kind: string; amountCents: string };
export const ADJUSTMENT_CONTRACT_VERSION = 2;
export const ADJUSTMENT_FISCAL_STATUS = 'UNREVIEWED' as const;
export function adjustmentReview(message = 'Zahlungskorrekturen und Erstattungsnachweise müssen geprüft werden.'): never {
  throw new PaymentJournalError(message, 409, 'PAYMENT_REVIEW_REQUIRED');
}
function cents(value: string) {
  if (!/^[1-9][0-9]{0,15}$/u.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) adjustmentReview();
  return BigInt(value);
}
/** Exact operational axes. A document cancellation is never a cash movement. */
export function reducePaymentLedger(total: MoneyInput, roots: readonly LedgerRoot[], adjustments: readonly LedgerAdjustment[], status: string) {
  const face = exactPaymentCents(total);
  const byRoot = new Map<number, { root: LedgerRoot; original: bigint; corrected: bigint; refunded: bigint }>();
  for (const root of roots) {
    if (byRoot.has(root.id)) adjustmentReview();
    byRoot.set(root.id, { root, original: cents(root.amountCents), corrected: BigInt(0), refunded: BigInt(0) });
  }
  for (const adjustment of adjustments) {
    const allocation = byRoot.get(adjustment.originalPaymentId);
    if (!allocation || allocation.root.dateCertainty !== 'ACTUAL') adjustmentReview();
    if (adjustment.kind === 'PAYMENT_CORRECTION') allocation.corrected += cents(adjustment.amountCents);
    else if (adjustment.kind === 'CUSTOMER_REFUND' && status === 'CANCELLED') allocation.refunded += cents(adjustment.amountCents);
    else adjustmentReview();
    if (allocation.corrected + allocation.refunded > allocation.original) adjustmentReview();
  }
  const values = [...byRoot.values()];
  const sum = (key: 'original' | 'corrected' | 'refunded') => values.reduce((n, value) => n + value[key], BigInt(0));
  const original = sum('original'), corrected = sum('corrected'), refunded = sum('refunded');
  const valid = original - corrected, retained = valid - refunded;
  if (valid > face || valid < BigInt(0) || retained < BigInt(0)) adjustmentReview();
  const residual = values.filter(value => value.original > value.corrected).map(value => ({ ...value.root, amountCents: (value.original - value.corrected).toString() }));
  const summary = paymentSummary(total, residual);
  if (status === 'CANCELLED') summary.openCents = '0';
  return {
    ledger: { version: 2 as const, documentState: status, originalReceivedCents: original.toString(), correctedCents: corrected.toString(),
      validReceivedCents: valid.toString(), refundedCents: refunded.toString(), netRetainedCents: retained.toString(),
      collectibleOpenCents: status === 'CANCELLED' ? '0' : (face - valid).toString(), refundDueCents: status === 'CANCELLED' ? retained.toString() : '0' },
    summary,
    settlementDate: valid === face && residual.length ? new Date(Math.max(...residual.map(root => new Date(root.paidAt!).getTime()))) : null,
    adjustmentCapacities: values.map(value => ({ originalPaymentId: value.root.id,
      correctableCents: (value.original - value.corrected - value.refunded).toString(),
      refundableCents: status === 'CANCELLED' ? (value.original - value.corrected - value.refunded).toString() : '0' })),
  };
}
export function paymentLedgerVersion(invoice: { id: number; status: string; customerId: number | null; paidAt: Date | null; totalAmount: number | null; paymentJournalEvents: unknown; paymentAdjustments: unknown; creditNotes?: unknown }) {
  return createHash('sha256').update(JSON.stringify({ contract: 2, ...invoice })).digest('hex');
}
