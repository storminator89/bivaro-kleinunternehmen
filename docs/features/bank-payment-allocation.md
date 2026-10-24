# Bank CSV: explicit payment capture and allocation

Saving a bank import records normalized evidence and hashes, not a payment and
not an archived raw CSV. The separate allocation workflow can record a reviewed
actual receipt and change its invoice allocation within the supported scope.

- Initial capture requires a valid positive EUR row, an actual date no later than
  today and an eligible issued small-business invoice. Duplicate/overlap evidence
  and potentially existing manual payment evidence require review rather than an
  automatic second receipt.
- The user selects an invoice, reviews the resulting balance and explicitly
  confirms the actual receipt. This is not a bank connection or automatic match.
- Reallocation moves the complete supported payment allocation to an eligible
  invoice for the same customer. It preserves the original receipt, Income
  projection and imported evidence; it does not move money or split payments.
- Current versions, immutable evidence and operation identity protect concurrent
  edits and uncertain network results. Reading recovery state is not a new payment.
- Unsupported, adjusted or inconsistent cases remain blocked for review. No
  bank transfer, universal tax-case coverage or automatic reconciliation is claimed.

## Implementation references

- [UI](../../components/bank-csv/bank-allocation-row.tsx)
- [Server checks and commands](../../lib/bank-allocation-service.ts)
- [Invoice eligibility and same-customer scope](../../lib/payment-journal/allocation-evidence.ts)
- [Contract](../../lib/bank-allocation-contract.ts)
- [Original CSV evidence format](bank-import-evidence.md) describes the import
  layer; its initial “no allocation endpoint” scope is not the current combined
  workflow. [Payment adjustment rules](../../lib/payment-journal/README.md) describe
  the adjustment contract; the allocation implementation extends its original scope.
