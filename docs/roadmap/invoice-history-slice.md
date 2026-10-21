# BPR-017 / #51 — bounded read-only invoice history

Status: implemented slice, not full issue acceptance. Stand: 2026-10-21.

## Delivered scope

- `/history` and invoice action link: owner-scoped document picker, original and
  existing credit-note relationships from either document, current stored
  cancellation reason, download of stored bytes and document-local tax choice.
- Separate saved payment-journal evidence; a cancellation is never presented as
  a refund. At most the latest 50 journal entries are shown, with the actual
  count and a route back to the existing full payment flow. No amounts are
  reconstructed from a legacy paid status and no financial balance is computed.
- Selected Invoice/CreditNote audit events only: recorded actor association,
  recording timestamp in UTC, allowlisted available status/issuance/date/amount
  before/after values. Missing values stay unknown. Raw metadata, addresses,
  bank/payment references, session/IP data, storage paths and XML are not DTOs.
- Strict query parsing, bounded pagination with a deterministic tie-breaker,
  action and inclusive UTC recording-day filters. ADMIN sees only its own
  documents here. Every family, audit and payment read repeats owner scoping.
- Loading/error/retry, no-match/legacy-evidence/missing-original states;
  URL-backed filters and navigation, keyboard controls and responsive tokens.

No database migration or mutation path is added. No historical events are
backfilled. Stored documents are not regenerated from current company settings.
The screen does not prove a complete, legally immutable, certified or externally
verified history; existing retention and restore limitations remain explicit.

## Evidence at implementation handoff

- Focused ESLint: pass on new history route, component, contracts, tests and two
  small navigation hooks.
- TypeScript on the initial read-only slice: `tsc --noEmit --incremental false`,
  single bounded 768 MiB process, pass. Later follow-on changes require the final
  candidate typecheck as recorded by the integration owner.
- Vitest: 26/26 pass in `invoice-history.test.ts` and
  `invoice-history-api.test.ts`, single worker, explicit newly-created temporary
  SQLite fixture with deployed migrations. Includes foreign/admin isolation,
  cross-owner malformed relations, family traversal, date/action filters,
  pagination, raw-payload exclusion and read-only records/counters.
- Three new `e2e/invoice-history.spec.ts` journeys are prepared for hosted full
  browser acceptance, **not locally executed**. They cover cancellation abort,
  issued-document guards, correction, duplicate cancellation, separate partial
  payment evidence, unchanged original PDF after profile change, filtering,
  reload/back, retry, mobile dark mode and keyboard actions. A genuine synthetic
  legacy row also proves that missing source/tax/date/audit/payment evidence
  remains unknown. These are prepared tests, not browser pass claims.
- Reserved synthetic screenshots: `history-correction-desktop.png` and
  `history-correction-mobile.png`. Images are evidence only after the hosted run
  actually produces them; no workflow or artifact allowlist change in this slice.

## Still open

Full hosted build/browser/visual acceptance on an exact candidate, representative
structured E-correction checks and fiscal/retention review are not established by
this slice. The separate follow-on below closes the base version’s optional-reason gap. This slice does not change or re-prove every existing issued-record
immutability, numbering, cancellation transaction or payment/restore guarantee.
Issue #51 must remain open until its remaining acceptance criteria are evidenced.


## Follow-on: explicit cancellation reason

The existing modal and `/api/invoices/cancel` now require a nonblank string of at
most 1000 normalized characters. Ordinary multiline text is preserved (CRLF/CR
normalize to LF); unsafe controls are rejected. The field has an explicit
required label, bounded input, associated inline error and keyboard focus on
rejection. API rejection is a clear 400 with `fieldErrors.cancellationReason`,
before number preview, PDF rendering, file creation or transaction work.

Compatibility impact: the sole application caller is the existing cancellation
modal. Direct callers that omitted/blanked the previously optional reason must
now supply one. The old valid basis-price test now does so. There is no new API
credential, route privilege, schema, number/refund behavior or historical rewrite.
Original, generated credit note and required audit entries retain the same
explicit normalized reason; no fallback reason is invented for new corrections.

Focused combined history/cancellation checks: 54/54 pass in four suites (single
worker);
ESLint and diff whitespace checks also pass. Focused cancellation tests cover
invalid inputs without side effects, normal
multiline text, exact bound, owner isolation, duplicate cancellation without new
number and rollback of document/number allocation when required audit storage
fails. Browser assertions for blank-submit error/focus and API 400 are prepared
in the existing history journey; actual hosted acceptance remains pending.

## Follow-on: pending cancellation cannot be accidentally dismissed

The modal now synchronously locks confirmed submission, suppresses its X button,
blocks Escape/outside/close callbacks, disables reason editing and announces
accessible progress until the response settles. Normal pre-submit cancellation
still closes without side effects. The gate is released in `finally`; terminal
errors permit normal closing again, and an uncertain response explicitly does
not imply that the sent request was cancelled or rolled back. This does not add
financial logic or attempt to abort/undo server work.

Focused handler/component tests cover synchronous duplicate-submit prevention,
all dismissal hooks, terminal unlock and accessible progress. Two additional
hosted browser journeys are prepared in `cancellation-interruption.spec.ts`:
one delays delivery **after the real server cancellation has committed**, the
other returns a synthetic pre-write 503. Both preserve original/number/payment
assertions; neither has been locally executed. No additional screenshots or
workflow changes are included.

Follow-on focused verification: ESLint and diff checks pass; 61/61 tests pass
across the five history/cancellation suites. Final candidate full types and both
new interruption browser journeys remain integration/hosted gates.
