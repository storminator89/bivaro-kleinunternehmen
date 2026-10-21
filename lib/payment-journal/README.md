# BPR-011 immutable positive payment allocations

An ordinary EUR invoice supports multiple exact positive allocations. Example:
EUR 120 receives EUR 40 on date A (EUR 80 remaining), then EUR 80 on date B.
Each allocation has its own immutable journal event and Income projection. Never
add journal amounts to Income: they are the same cash receipt represented twice.
Refunds, corrections, advance/final invoices and bank reconciliation are excluded.

## API and consistency

`POST /api/invoices/:id/payments` authenticates ownership and same-origin mutation:

```json
{"amount":"40.00","currency":"EUR","paidAt":"2026-10-20","source":"MANUAL","reference":"Bank statement","idempotencyKey":"stable-client-request-uuid","expectedPaidCents":"0"}
```

Dates are actual calendar dates, not today's inferred evidence. Positive cent
amounts must fit the existing safe Float bridge. A serializable transaction reads
the complete ledger, validates every event/Income projection, checks the optimistic
`expectedPaidCents`, then atomically writes Income, event, lifecycle and mandatory
audit. Retryable SQLite conflicts restart the entire transaction. Same semantic
key replays return the current whole-ledger summary before baseline validation;
changed amount/date/reference/source under that key is `IDEMPOTENCY_CONFLICT`.
The baseline is a precondition, not financial semantic identity.

Success is 201, replay 200: `{event, summary, replayed}`. Summary has exact canonical
string `totalCents`, `paidCents`, `openCents`, `paid`, and `paymentState`:
`OPEN`, `PARTIAL`, `PAID`. Stale distinct requests receive 409
`PAYMENT_STATE_CHANGED` with current summary. Overpayment receives 409
`PAYMENT_EXCEEDS_OPEN`. Unexplained historical projections require
`PAYMENT_REVIEW_REQUIRED`, never a guessed balance. Exhausted transient database
errors are explicit retryable failures, not success. Per-client FIFO is only an
optimization; cross-client transactions/preconditions enforce concurrency.

`GET` returns ordered `events`, `summary`, capability/review flags and a deprecated
`event` alias only when exactly one event exists (otherwise null). Old full-payment
requests may omit the baseline only on a consistent empty ledger for the exact
full total. Legacy status PUT requires an explicit actual date; a partial ledger
requires the payment dialog instead. Unchanged already-PAID no-ops are retained.

## Lifecycle and accounting

The first partial issues the invoice and sets SENT with paidAt=null. Settlement
sets PAID and the latest actual allocation date, irrespective of submission order.
Every ACTUAL Income is realized immediately on its event date, including while
partially paid. Settlement/cancellation never moves earlier periods or deletes
cash realization. Cancellation is not a refund.

Legacy PAID without a journal returns unknown summary and explicit adoption/review.
`{"kind":"LEGACY_IMPORT"}` adopts only full historical evidence once. Existing
Income and dates remain unchanged; no new Income or dates are synthesized.
`LEGACY_INCOME`, `LEGACY_INVOICE`, `UNKNOWN` retain historical source/certainty/nulls;
none is converted to ACTUAL. Conflicting legacy evidence is rejected.

## UI and dependent surfaces

The dialog offers editable exact amount, explicit date/reference, received/open
balances, ordered allocation history and deliberate conflict recovery. An
uncertain write may recover only the exact pending idempotency key. A new equal-
looking allocation uses a new baseline/key; merely opening history is not success.
Invoice paid/unpaid/partial filters run before server pagination and counts.
Reminder totals use remaining balances; partial-invoice reminder preview/send and
internal creation are blocked until the separate BPR-013 reminder work is ready.

## Migration, backup and rollback

`20261021043000_add_partial_payments` only replaces the two unique invoice indexes
with plural indexes. No event/Income backfill or historical financial rewrite.
Tenant-link and immutable-update/delete triggers remain. Aggregate caps are
application/restore invariants, not a property of the immutable triggers.

Grouped backup validation retains explicit support for the previous singleton
journal schema and pre-journal backups. Merge uses verified event/idempotency
identity and event-specific Income mappings. Replays do not duplicate Income or
payment audit. Compatible snapshots can advance without regressing more advanced
targets; ambiguous/divergent histories fail before writes. Journal-bearing targets
cannot be overwritten, even with old backups. Older application code is not a
supported rollback once partial allocations exist: never discard immutable history
or disable its triggers to make it fit a singleton application.
