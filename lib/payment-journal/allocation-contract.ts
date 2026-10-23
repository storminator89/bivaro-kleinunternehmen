import { exactPaymentCents, paymentSummary, type PaymentAllocation } from './contract';
import { adjustmentReview, type LedgerAdjustment, type LedgerRoot } from './adjustment-contract';
import type { MoneyInput } from '@/lib/money';

export type EffectivePayment = {
  originalPaymentId: number; originInvoiceId: number; allocatedInvoiceId: number;
  amountCents: string; validReceivedCents: string; refundedCents: string; retainedCents: string;
  paidAt: string | null; dateCertainty: string; source: string; bindingStableKey: string | null;
  allocationRevision: number | null; allocationChangeStableKey: string | null; provenance: 'BANK_CSV' | 'MANUAL' | 'LEGACY';
};
export type RootCapabilities = {
  originalPaymentId: number; correctableCents: string; refundableCents: string;
  canCorrect: boolean; canRefund: boolean; canReallocate: boolean;
  correctionReviewReason: string | null; refundReviewReason: string | null; reallocationReviewReason: string | null;
};
export type PaymentLedgerV3 = {
  version: 3; documentState: 'DRAFT' | 'SENT' | 'PAID' | 'CANCELLED';
  originCash: { originalReceivedCents: string; correctedCents: string; validReceivedCents: string; refundedCents: string; netRetainedCents: string };
  allocation: { originalAllocatedCents: string; correctedAllocatedCents: string; validAllocatedCents: string; refundedAllocatedCents: string; retainedAllocatedCents: string };
  collectibleOpenCents: string; refundDueCents: string;
};
export type AllocationRootState = {
  root: LedgerRoot & { invoiceId: number; source: string }; allocatedInvoiceId: number;
  adjustments: readonly LedgerAdjustment[]; bindingStableKey: string | null; allocationRevision: number | null; allocationChangeStableKey: string | null;
};
/** Aggregate bounds are graph bounds, not one invoice's Number.MAX_SAFE_INTEGER. */
export const MAX_ALLOCATION_GRAPH_RECORDS = 10_000;
export function aggregateCents(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,23})$/u.test(value)) adjustmentReview();
  return BigInt(value);
}
function rootCents(value: string) {
  const amount = aggregateCents(value);
  if (amount <= BigInt(0) || amount > BigInt(Number.MAX_SAFE_INTEGER)) adjustmentReview();
  return amount;
}
/** Two non-additive views of the same roots; never count Income a second time. */
export function reduceAllocationLedger(total: MoneyInput, invoiceId: number, status: string, rootStates: readonly AllocationRootState[]) {
  if (!['DRAFT', 'SENT', 'PAID', 'CANCELLED'].includes(status) || rootStates.length > MAX_ALLOCATION_GRAPH_RECORDS) adjustmentReview();
  if (rootStates.some(state => state.bindingStableKey !== null) && rootStates.some(state => state.root.dateCertainty !== 'ACTUAL')) adjustmentReview('Bankzuordnungen dürfen nicht mit unklaren Legacy-Zahlungsnachweisen vermischt werden.');
  const face = exactPaymentCents(total), seen = new Set<number>();
  const values = rootStates.map(state => {
    if (seen.has(state.root.id)) adjustmentReview();
    seen.add(state.root.id);
    const original = rootCents(state.root.amountCents);
    let corrected = BigInt(0), refunded = BigInt(0);
    for (const adjustment of state.adjustments) {
      if (adjustment.originalPaymentId !== state.root.id || state.root.dateCertainty !== 'ACTUAL') adjustmentReview();
      if (adjustment.kind === 'PAYMENT_CORRECTION') corrected += rootCents(adjustment.amountCents);
      else if (adjustment.kind === 'CUSTOMER_REFUND') refunded += rootCents(adjustment.amountCents);
      else adjustmentReview();
    }
    if (corrected + refunded > original) adjustmentReview();
    return { state, original, corrected, refunded, valid: original - corrected, retained: original - corrected - refunded };
  });
  const sum = (axis: typeof values) => axis.reduce((n, v) => ({ original: n.original + v.original, corrected: n.corrected + v.corrected, valid: n.valid + v.valid, refunded: n.refunded + v.refunded, retained: n.retained + v.retained }), { original: BigInt(0), corrected: BigInt(0), valid: BigInt(0), refunded: BigInt(0), retained: BigInt(0) });
  const origin = sum(values.filter(v => v.state.root.invoiceId === invoiceId));
  const effective = values.filter(v => v.state.allocatedInvoiceId === invoiceId), allocated = sum(effective);
  if (allocated.valid > face) adjustmentReview();
  const residual: PaymentAllocation[] = effective.filter(v => v.valid > BigInt(0)).map(v => ({ ...v.state.root, amountCents: v.valid.toString() }));
  const summary = paymentSummary(total, residual);
  if (status === 'CANCELLED') summary.openCents = '0';
  const settlementDate = allocated.valid === face && residual.length && residual.every(root => root.paidAt !== null)
    ? new Date(Math.max(...residual.map(root => new Date(root.paidAt!).getTime()))) : null;
  if (settlementDate && !Number.isFinite(settlementDate.getTime())) adjustmentReview();
  const ledger: PaymentLedgerV3 = { version: 3, documentState: status as PaymentLedgerV3['documentState'],
    originCash: { originalReceivedCents: origin.original.toString(), correctedCents: origin.corrected.toString(), validReceivedCents: origin.valid.toString(), refundedCents: origin.refunded.toString(), netRetainedCents: origin.retained.toString() },
    allocation: { originalAllocatedCents: allocated.original.toString(), correctedAllocatedCents: allocated.corrected.toString(), validAllocatedCents: allocated.valid.toString(), refundedAllocatedCents: allocated.refunded.toString(), retainedAllocatedCents: allocated.retained.toString() },
    collectibleOpenCents: summary.openCents, refundDueCents: status === 'CANCELLED' ? allocated.retained.toString() : '0' };
  const rootPayments: EffectivePayment[] = values.map(v => ({ originalPaymentId: v.state.root.id, originInvoiceId: v.state.root.invoiceId, allocatedInvoiceId: v.state.allocatedInvoiceId,
    amountCents: v.original.toString(), validReceivedCents: v.valid.toString(), refundedCents: v.refunded.toString(), retainedCents: v.retained.toString(),
    paidAt: v.state.root.paidAt === null ? null : new Date(v.state.root.paidAt).toISOString(), dateCertainty: v.state.root.dateCertainty, source: v.state.root.source,
    bindingStableKey: v.state.bindingStableKey, allocationRevision: v.state.allocationRevision, allocationChangeStableKey: v.state.allocationChangeStableKey,
    provenance: v.state.bindingStableKey ? 'BANK_CSV' : v.state.root.dateCertainty === 'ACTUAL' ? 'MANUAL' : 'LEGACY' }));
  const effectivePayments = rootPayments.filter(root => root.allocatedInvoiceId === invoiceId);
  return { ledger, summary, settlementDate, effectivePayments, rootPayments };
}
