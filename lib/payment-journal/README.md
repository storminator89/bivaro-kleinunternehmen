# Immutable payment ledger, contract 2

Positive `PaymentJournalEvent` rows and their `Income` projections represent the
same receipt; never add them together. Original rows, dates and projections remain
unchanged. An adjustment is separate positive-magnitude append-only evidence:

- `PAYMENT_CORRECTION`: the declared portion was never received. Its signed
  operational effect belongs to the original represented receipt date.
- `CUSTOMER_REFUND`: an actual later payout, not a payment instruction. Its signed
  operational effect belongs to the explicitly declared payout date.

## Bounded support

Adjustments require consistent ACTUAL original receipts, an issued ordinary EUR
invoice with historical `taxMode: small-business` evidence, no VAT/special case,
and no cashbook linkage. Legacy/uncertain and unsupported tax evidence requires
review. Real-money reassignment/date replacement, partial credit, advance/final
invoices, bank execution/reconciliation and automatic payouts are not supported.

A refund additionally requires an already fully cancelled invoice and its unique,
same-tenant, issued, original-linked full cancellation document. Cancelling alone
creates no payment adjustment or cash movement. Each payout covers one original
allocation and needs an explicit tenant-unique payout evidence reference; this
prevents replay of the same declared reference, not invented references or bank
reconciliation errors.

For original amount P, corrections C and refunds F, C+F must not exceed P. Across
an invoice, valid receipts = original receipts minus C; retained = valid minus F.
An active invoice's collectible amount is face minus valid receipts. A fully
cancelled invoice always has zero collectible debt; its refund liability equals
retained receipts. Refund liability is not reminder debt. Corrected originals may
be followed by new real receipts; gross original history can then exceed face,
but valid receipts cannot. No excess history is clamped or silently repaired.

## API and concurrency

`GET /api/invoices/:id/payments` returns `ledger.version: 2`, exact string-cent axes,
root-linked adjustments, per-root remaining capacities, a cancellation basis and
an opaque `ledgerVersion`. Adjusted reads require request header
`X-Bivaro-Payment-Contract: 2`; old readers receive an explicit capability error.
Invoice-list readers without that capability receive the same explicit capability
error when the selection contains adjusted invoices, not hidden or positive-only balances.

`POST /api/invoices/:id/payments/adjustments` accepts kind, originalPaymentId,
positive decimal-string amount, actionDate, reason, reference, idempotencyKey and
expectedLedgerVersion. Correction also requires declarationNeverReceived=true;
refund instead requires cancellationInvoiceId. Dates must be real calendar dates,
not future/planned or before the original receipt day. Recording date and effective
date remain distinct. Reason/reference are bounded, nonempty and control-free.

All commands authenticate and enforce tenant ownership. A serializable transaction
validates the whole ledger, immutable basis/fingerprint, fresh version, combined
capacity and duplicate payout reference, then atomically writes the shared
`PaymentOperation`, adjustment, mandatory financial audit and lifecycle projection.
A failed audit or projection rolls everything back. Same-key identical semantics
replay before stale-baseline rejection; changed semantics conflict. New positive
receipts share the same tenant-wide namespace, retaining compatibility with old
original keys. Positive writes on adjusted ledgers also require the fresh token.
Exhausted transient conflicts return explicit retry-required, not success.

Active correction can reopen PAID to SENT without reversing issuance. Settlement
uses the latest residual valid original date. Cancellation preserves its historical
payment marker; actual receipt dates are always in the unchanged original events.

The UI separates never-received correction and already-executed payout, shows
collectible/refund-liability axes, retains immutable pending replay identity and
blocks adjustment writes if that identity cannot be persisted. An ambiguous result
is retried unchanged or recovered by GET; refresh failure is never a second payment.

## Reporting boundary

The operational KPI source uses signed integer-cent original/correction/refund
movements, including negative refund-only months/years. Cancellation documents add
no second cash effect. Revenue orientation is not a validated legal turnover total.

No fiscal adjustment mapping is supplied by this feature. On tenants with adjustment
history, EÜR, tax simulation, positive-only dashboard working papers and raw Income
list/CSV/API outputs fail explicitly review-required from the same read snapshot.
This conservative tenant-level gate also protects affected prior periods; it is not
a fiscal approval or a filed-return amendment. Client CSV generation must obtain a
fresh guarded server result instead of exporting cached totals.

The neutral accountant handoff format 2 includes original-linked typed adjustment
evidence, positive magnitudes, signed operational effects, actual/effective/recorded
dates, basis, fingerprints and `fiscalMappingStatus: UNREVIEWED`. Outside-period
originals/basis are context only; legacy evidence is not promoted to an ACTUAL cash
movement. Document, Income and movement tables are not additive views.

Fresh reminders on adjusted invoices are explicitly unsupported pending a
correction-aware reminder contract. Stored reminder evidence/idempotent replay is
preserved. Cancellation can never become collectible reminder debt. Daily actions
and invoice balances use the same v2 reduction.

## Schema, backup and rollback

Minimum adjustment reader/writer/backup capability is exact schema
`20261021150000_add_payment_adjustments`, outer backup format 3.0. Earlier exact
feature identities retain their original capabilities; timestamps infer nothing.
The additive migration preserves original payment/Income bytes and their immutable
triggers, and adds immutable adjustment/operation storage, tenant/basis constraints
and a shared per-root capacity trigger. There is no financial backfill.

Current backups require explicit adjustment and operation arrays, even when empty.
Preview and restore share closed-field and full graph validation: owned roots and
Income, dates, capacities, cancellation basis snapshot, semantic fingerprints,
shared command/payout identities and mandatory audit evidence. Unknown future
fields under old schema identities are rejected, not dropped.

Restore creates documents, projections and roots before remapped adjustments,
retaining semantic command identity and source-event provenance. Compatible ancestor
snapshots never erase later events; divergent histories, source-ID reuse, mismatched
identities or over-cap unions fail transactionally. Replay adds no duplicate event,
Income, payout identity or audit. Overwrite is forbidden on any target containing
immutable payment, adjustment or financial-operation history, including with old
backups. Use an authorized empty target instead.

Once adjustment history exists, positive-only application code is not a supported
rollback. Never discard events, disable immutability or relabel a backup to make it
fit an older application. Rollback requires a compatible application/schema/data
set in a separately authorized target.

## Browser acceptance contract

The dedicated payment-adjustment browser suites use the supported isolated
Chromium runner, synthetic authenticated accounts and real application routes.
Only synthetic identities are seeded directly; financial writes are not mocked.
They cover correction followed by a replacement receipt, actual refund against
its full cancellation, residual refund liability without reminder debt,
unsupported evidence, stale/concurrent and interrupted/reloaded attempts,
keyboard/mobile operation and fiscal fail-closed behavior. Fiscal display checks
include returning to a second tab; CSV checks start with a previously successful
cached view and require a fresh guarded server result before download.

One full-page synthetic confirmation image is included in the exact browser
artifact allowlist. Existing images and the aggregate 5 MiB limit remain intact;
no crop, lossy conversion or evidence-suppression rule is used. Browser execution
and image inspection are separate acceptance gates from unit/type/lint checks.
