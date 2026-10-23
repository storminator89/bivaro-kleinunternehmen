import type { PaymentLedger } from '@/lib/full-payment-form';

/** Invoice UI uses the effective allocation axis, never gross origin cash. */
export function invoicePaymentAmounts(ledger: PaymentLedger) {
  return ledger.version === 3 ? {
    valid: ledger.allocation.validAllocatedCents, corrected: ledger.allocation.correctedAllocatedCents,
    refunded: ledger.allocation.refundedAllocatedCents, retained: ledger.allocation.retainedAllocatedCents,
    open: ledger.collectibleOpenCents, refundDue: ledger.refundDueCents,
  } : {
    valid: ledger.validReceivedCents, corrected: ledger.correctedCents,
    refunded: ledger.refundedCents, retained: ledger.netRetainedCents,
    open: ledger.collectibleOpenCents, refundDue: ledger.refundDueCents,
  };
}
