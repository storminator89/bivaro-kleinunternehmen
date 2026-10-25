# Manual financial records: bounded issue #54a contract

## Scope and delivery boundary

Prepared from accepted main `db3098b8dd5318e426cd2e1e93a54b810cd1b4e9`, after
the supplier-task schema `20261024040000_add_supplier_tasks`. This document is
an implementation contract, not a test, migration, release, fiscal approval or
deployment result. Actual verification belongs in the candidate's testing note.
Issue #54 remains partial beyond this ordinary-manual-record slice.

The supported records are individual, manually entered EUR incomes and ordinary
expenses. Invoice/journal, incoming-original, cashbook, recurring-series and AfA
records are not adopted by this lifecycle. Known source lineage must survive
removal of a nullable foreign key. Missing historical provenance is not invented.

## Accounting invariant

Existing manual entries already affect the application's cash-based figures.
`LEGACY_UNREVIEWED` and `RECORDED` therefore do **not** mean unbooked. Finalization
does not create a receipt, payment, invoice, number, cash transaction or email,
and does not change the amount, actual payment date or existing totals.

The original finalized snapshot is retained. `CORRECT_AMOUNT` appends reasoned
evidence and replaces the amount in exactly one existing effective Income or
Expense projection, atomically. History snapshots are never additional money
rows. A correction from EUR 100 to EUR 80 contributes EUR 80, not EUR 180 and not
a new refund. Its recording time is separate from the unchanged payment date.

Only the amount may be corrected by this slice. Date, customer, tax treatment,
category, deduction percentage, depreciation and original-file reference are
not edited through this command. An actual later repayment is a different
business event and is not represented by pretending the original receipt was
smaller. Existing journal adjustment and fiscal-review guards remain in force.

## States and explicit control

- `LEGACY_UNREVIEWED`: pre-existing/historical record; no retrospective review
  claim. Eligible legacy records require an explicit manual-record declaration.
- `RECORDED`: new manual entry, already financially effective, not finalized.
- `FINALIZED`: generic update/delete is forbidden; supported reasoned amount
  corrections remain finalized and retain the immutable original/history.

The server returns authoritative `canFinalize`, `canCorrectAmount` and
`readOnlyReason`. Clients must not infer eligibility from the absence of one
visible relation. Source-linked records retain their existing source workflows.

## Browser-safe endpoint contract

The shared types live in `lib/manual-financial-record-contract.ts`.

- `GET /api/manual-financial-records?kind=income|expense&id=<id>` returns a fresh,
  owner-scoped record, actual payment date, effective amount, original evidence,
  current revision/fingerprint, capabilities and immutable history. GET is read
  only. Portable UUID identities are allocated on creation/migration, not by GET.
- Protected web-session `POST /api/manual-financial-records` accepts `kind`, `id`,
  `operation`, `expectedRevision`, `fingerprint` and UUID `mutationId`, plus the
  explicit legacy declaration or correction `amount`/`reason` as applicable.
- Identical semantic mutation replay is resolved before stale-version rejection.
  The same mutation identity with changed semantics conflicts. No additional
  API-key privilege is introduced by this web endpoint.

Amounts are strict decimal EUR inputs; historical sub-cent values are not silently
rounded to manufacture eligibility. A required reason and the old/new values are
visible before correction. Input, result and history sizes must be bounded.

All authorization, source checks, compare-and-swap, history append, effective
projection update and mandatory financial audit belong to one transaction.
Failed audit or stale/conflicting state must roll back the entire mutation.
Generic web and v1 income/expense update/delete paths share the same protection.
Cashbook-link creation and customer deletion/FK detachment are protected against
races, not merely hidden in the UI.

## Uncertain responses and user input

Double-clicks cannot start another command while one is pending. A lost or aborted
response does not prove rollback. Recovery reads the record and retained mutation
identity before another write; an identical retry retains the same command.
Success remains distinguished from a subsequent list-refresh failure.

Delayed reads/writes must never replace newer keyboard edits, including an edit
that deliberately returns to the previously confirmed value. Explicit edit and
clean generations, rather than old-value equality, determine adoption. Cancel,
close, navigation, reload, errors and focus return need authored acceptance.
No original or history is deleted by dismissing the UI.

## Originals, backups and handoff

An absent attachment is explicit absence. An external `receiptUrl` is not proof
of archived original bytes. A present referenced original requires safe owned
bytes and a retained hash/byte count; missing or changed originals fail clearly.

The additive backup capability has its own exact identity. No older schema gains
new fields/capabilities retroactively, even null fields. Current history must be
complete, owner-bound and consistent with its one effective projection. Older
backups preserve unreviewed states and cannot erase finalized target history.
Historical financial merges into a target with finalized manual records are
rejected because the missing portable identity cannot safely distinguish a new
entry from a duplicate. Restore those backups into a separate empty target for
review. Historical merges into ordinary unfinalized targets keep their existing
semantics; amount, date and description are never treated as identity.

Portable UUID/history replay is required before existing generic manual-restore
create loops; matching by amount, name or date is not identity. Exact compatible
replay creates no second financial record. Divergent histories fail rather than
silently replacing or combining finalized facts. Numeric IDs are remapped while
portable identity and original evidence are preserved. Original file bytes need
the full ZIP path; a JSON-only business backup is not a complete file recovery.

The neutral accountant package may carry original/correction history as context
with no additional summed financial effect. Its preview fingerprint must change
when relevant lifecycle history changes. A downloaded earlier package is not
rewritten; the corrected historical period may need to be handed over again.

## Required acceptance and nonclaims

Authored verification must cover unchanged sums on finalize; 100-to-80 correction
with original 100 retained; all web/v1 bypasses; owner/source/cash/customer races;
same-key replay and stale tabs; real audit-insert rollback; unknown committed
responses; original-byte preservation; strict historical/current backups; exact
restore replay without duplication; malformed/foreign/divergent history; and
desktop plus 360/390px keyboard, focus, cancel/back/reload/error behavior.

Local functional/unit/API/fixture/browser execution and test discovery remain
prohibited by the current task constraints. Lint, types, no-database schema
validation/client generation and ordinary build are separate permitted checks.
Writing test source does not establish a passing result or visual acceptance.
No GitHub publication, new CI, production migration or deployment is authorized
for this preparation. Technical checks imply no tax/legal certification.
