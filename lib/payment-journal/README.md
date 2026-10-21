# BPR-010 first-full-payment backend

This slice supports exactly one full EUR payment per invoice. The invoice unique
constraint is deliberate; partial payments/refunds need a later reviewed migration.
No existing invoice, Income, amount or historical date is automatically backfilled.

## Public contract

`POST /api/invoices/:id/payments` (authenticated owner, same-origin mutation):

```json
{"amount":"123.45","currency":"EUR","paidAt":"2026-10-19","source":"MANUAL","reference":"Bank statement 2026-10-19","idempotencyKey":"client-generated-stable-request-id"}
```

Dates use `YYYY-MM-DD`, persisted at UTC midnight. Keep the same key and payload
when retrying an uncertain request. A successful first write returns 201; identical
replay returns 200. Both return `{event, summary, replayed}`. Summary contains exact
string `totalCents`, `paidCents`, `openCents`, `paid`, date certainty and `paidAt`.
Changed payload/key reuse returns 409 `IDEMPOTENCY_CONFLICT`; partial/overpayment
returns 400 `FULL_PAYMENT_REQUIRED`. Zero, negative, subcent, unsupported currency,
unsupported document and unsafe Float-bridge amounts are rejected before writes.

The single serializable transaction writes one immutable journal event, one linked
Income projection, derived invoice PAID/paidAt/ISSUED and mandatory financial audit.
Income remains the existing revenue source. **Do not add journal amounts to Income
amounts**: these represent the same payment. Cancellation does not delete either.

`GET /api/invoices/:id/payments` returns `{currency:"EUR", event, summary, legacyAdoptionRequired, canRecordPayment}` after the same supported-document/currency/money checks as the writer.
An unadopted legacy PAID row returns `summary:null` rather than falsely reporting
it as unpaid. It requires explicit review/adoption.

## Historical adoption

`POST /api/invoices/:id/payments` with only `{"kind":"LEGACY_IMPORT"}` adopts an
existing PAID invoice once. It never creates an Income or changes invoice paidAt.
Existing Income is linked unchanged and marked `LEGACY_INCOME`; existing invoice
paidAt without Income is marked `LEGACY_INVOICE`. These are historical evidence,
**not confirmation of an actual payment date**: old defaults may themselves be
uncertain. Without either, paidAt remains null and certainty is `UNKNOWN`. Conflicting
amount/date evidence is rejected for review. ACTUAL is reserved for explicit new
payment input. Normal reads and legacy status no-ops do not silently adopt rows.

## Compatibility and UI integration

Legacy `PUT /api/invoices` can still mark PAID with explicit `paidAt` (calendar date
or exact UTC ISO instant). Its deterministic key prevents duplicates. Without a
new actual date it returns 400 `PAYMENT_DETAILS_REQUIRED`, never guesses today.
An unchanged already-PAID request remains a no-op. Existing irreversible lifecycle,
customer, billing-note and cashbook guards are retained.

The parent must update both existing undated PAID callers before acceptance:

- `components/dashboard/dashboard-content.tsx`: `handleInvoiceStatusChange`.
- `app/dashboard/reminders/page.tsx`: `handleMarkAsPaid`.

No frontend is included in this backend package. Browser/mobile/keyboard acceptance
and integrated full build remain parent gates.

## Backup and immutability

Schema migration `20261020230000_add_payment_journal` is additive. Event edits and
deletes are rejected by SQLite triggers; owner/invoice/Income linkage is checked
on insert. No public API updates or deletes journal events.

Backup snapshots include typed `paymentJournalEvents`, hashes and coverage.
Restore validates amount/date/source/link invariants and remaps tenant-owned IDs;
merge replays immutable equivalent events without duplicate Income. A target that
already contains journal events **cannot be overwritten**, even by an old backup:
use merge or an explicitly empty isolated target. This actionable rejection prevents
journal loss. Rollback to code unaware of this model requires explicit data/restore
review; do not drop the table or pretend an old backup contains its history.
