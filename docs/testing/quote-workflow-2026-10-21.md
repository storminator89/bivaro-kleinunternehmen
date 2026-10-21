# Quote follow-up workbench — implementation checkpoint

2026-10-21 · Issue [#77](https://github.com/storminator89/bivaro-kleinunternehmen/issues/77) · base `e5a00e8d7b8725b2be224fbbba541326e0531d9b`.

## New user value

- Three global, tenant-bound task counts and server-side filters: follow up today/overdue, clarify a sent offer whose validity has elapsed, prepare an invoice from a manually accepted offer. Counts are not page sums and are explicitly independent of search; the same offer may appear in two task categories.
- Persistent private calendar follow-up and response/context note, with an accessible manual-response form, date clearing, cancellation, retained input on save failure, and optimistic conflict detection. No customer portal, email, background reminder or payment event.
- URL-backed quote status/task filter and search preserve context across reload and browser history. Existing PDF, fiscal selection, totals, customer and line data are not rewritten by task updates.
- Existing quote-to-invoice review is not a new feature. Its old false claim about automatically booking income was removed. Compatibility guards and the automatic ACCEPTED mutation are a separately authorized follow-on, not completed by this checkpoint.

## API/schema/backup contract

Migration `20261021073000_add_quote_followup` adds nullable `Invoice.quoteFollowUpOn` (strict YYYY-MM-DD) and `quoteResponseNote` (max 2000 characters), plus an owner/type/day index. API accepts these only for an owned QUOTE. Calendar comparisons use Europe/Berlin; valid-until is inclusive. No status changes are inferred from time passing.

`PATCH /api/quotes/:id/workflow` requires the last observed status/date/note snapshot. Mutation and audit commit atomically; stale snapshots return 409 without overwriting the newer response. Private notes are not copied into PDF or invoice parsedData.

The existing invoice identity, customer map and converted-from relation remain the restore identity contract. Snapshot exports already include all invoice fields. New schema manifests preserve both metadata fields; older manifests cannot claim non-null workflow metadata. Same-number merges with different workflow metadata fail closed. A legacy overwrite is refused when it would erase existing private tasks/notes. Old backups remain importable into an empty target. No new model, credentials, service or host configuration.

### Integration with the parallel CSV slice

CSV reserves migration `20261021080000_add_data_import_receipts`; this quote migration is distinct from annual-context `070000` and photo `061000`. When combining branches, retain both schema capability histories: ServiceArticle coverage belongs to CSV and the final current schema, quote workflow capability belongs to the final current schema only, review-draft/payment capabilities belong to both prior/current schemas. Neither branch's manifest ladder may replace the other's. CSV owns both service-picker editor integrations.

## Verified and unrun stages

- Focused workflow/date/API/ownership/stale edit/audit rollback/backup/navigation: **5 files, 38 tests passed**.
- Existing backup v3, invariant, purchase original and partial-payment backup regressions: **4 files, 70 tests passed**.
- Scoped ESLint for changed implementation and unit-test files: **passed, zero warnings**. Browser-spec lint checked separately.
- `git diff --check`: passed.
- One bounded native TypeScript attempt: `timeout 90s env NODE_OPTIONS=--max-old-space-size=768 node node_modules/typescript/bin/tsc --noEmit --incremental false`; terminated with **exit 137, no diagnostics**. Resource-killed; neither a code failure nor a typecheck pass. No retry or local full build.
- Hosted full typecheck/build, browser execution and visual acceptance: **not run at this checkpoint**. No deployment/merge/release claim.

`e2e/quote-followup-workbench.spec.ts` defines a synthetic isolated-hosted-runner journey: 390px/1440px, keyboard save, intercepted 503 retaining input, real stale 409, cancel/reopen, date/response persistence, manual acceptance, URL filters, Back/Forward/reload, original PDF immutability and no income/invoice side effects. It declares exactly two PNGs: `quote-followup-mobile-390.png`, `quote-followup-desktop-1440.png`. These are planned evidence names, not existing screenshots.

## Separate conversion compatibility checkpoint

Existing callers remain compatible: `/api/quotes/:id/convert` delegates multipart uploads to `/api/invoices/upload`, and the existing invoice editor passes `fromQuoteId` directly. The existing quote prefill and user-editable customer/lines/fiscal review remain unchanged. This does not introduce a second conversion flow or automatically issue/send an invoice.

- The actual converted-invoice relation is replayed before new eligibility checks, including after a later manual rejection. Replay now verifies the linked invoice owner/type too.
- DRAFT and still-valid SENT sources may prepare a draft without being marked ACCEPTED. A same-status transaction claim and the unique source relation prevent duplicate conversion; the claim does not write a fictitious response history.
- REJECTED, EXPIRED and CANCELLED sources require an explicit user reopening or manually recorded acceptance. A SENT source whose inclusive validity day has elapsed also requires that explicit step. A user-accepted late offer may proceed; this remains a user declaration, not electronic customer acceptance.
- Eligibility is checked both before persistence and inside the conversion transaction, using the German calendar. The transaction claim matches the observed status and validity date. Source PDF/line/money/private-task metadata remain unchanged.
- Converted offers display a separate link to the real linked invoice's existing history, independently of the offer's manual status.

Verification after this follow-on: **3 focused files / 53 tests passed**, including real parallel uploads producing one DRAFT, retry after later rejection, foreign-owner rejection, post-preflight response race, exact source PDF/metadata preservation, no income booking, and just-before/after Berlin-midnight validity boundaries. Scoped ESLint passed with zero warnings. These overlap the earlier 108 tests and must not be summed as distinct cases. Hosted typecheck/build/browser remain unrun. The hosted journey additionally opens the existing prefilled invoice editor, exits without saving and verifies no invoice was created. No extra PNGs were added.

Historical `docs/backlog/TICKETSTATUS.md` and `ticket-status.json` are preserved exactly at the base; this public-safe checkpoint and issue #77 carry this slice's evidence.

## Final source verification / backup capability hardening

New-capability manifests must include both nullable workflow fields on every QUOTE row; absent fields are not evidence of no tasks. Legacy 2.0 payloads cannot carry unbound non-null quote workflow metadata. Restore validates canonical calendar dates and trimmed notes and reports invalid input as a backup validation error. This closes the old-row/current-schema relabeling gap without inventing a new identity or changing historical files.

After all implementation changes, the complete focused union was rerun once: **10 test files / 133 tests passed** in 14.50 seconds, one worker. This is the final non-overlapping focused count. Changed-file scoped ESLint and `git diff --check` passed. It is not a full-suite/typecheck/build/browser pass. Hosted typecheck/build and the two-image browser journey remain required and unrun; the one native typecheck remains exit 137 without diagnostics, with no retry.
