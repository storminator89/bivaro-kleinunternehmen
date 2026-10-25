# Records/history redesign acceptance — source only

## Verified versus pending

Lint, project type checking and static wiring/logic comparisons passed as recorded
in [the design note](../design/HALLMARK-RECORDS-HISTORY-2026-10-24.md).
No functional tests were run locally, no app/browser was started, and no new
GitHub CI run was triggered. No published app has been verified for this patch.

`e2e/records-history-redesign.spec.ts` is **authored, not executed**. It follows
existing suites such as `invoice-history.spec.ts`, `reminder-workbench.spec.ts`
and `service-statement.spec.ts`: the established isolated browser runner supplies
a fresh fixture database, and the source asserts `DATABASE_URL` equals the
runner's `e2eDatabasePath()` before seeding. No repository database is reset.
Synthetic users/customers/notes and a real API-created stored PDF invoice/payment
support the review. No production account or dataset is used.

This is ordinary `.spec.ts` source compatible with the existing GitHub browser
harness. It adds no CI workflow, dependency, standalone server, external-only URL
requirement or execution trigger. Running it later still requires separate
authorization under the current no-local-functional-testing restriction.

The source sets and verifies actual light/dark theme, captures 1440×1000 and
390×844, chooses visible row/card variants rather than assuming a viewport
breakpoint, and exercises Back/Forward, repeated refresh, cancel/reopen,
confirmation invalidation and explicit statement selection without saving an
extra reminder or billing a note. The broader real-flow acceptance below remains
pending. Hosted CI browser execution does not by itself approve a published Site;
verify that separately when an authorized deployment exists.

## Required hosted matrix

| Scenario | Evidence needed | Current outcome |
| --- | --- | --- |
| Reminder queue: default, each stage filter, empty stage, loading and failed load/retry | Correct counts and unchanged totals; no document scroll; mobile actions visible; retry resolves without duplicate dialog | Pending hosted |
| Reminder history: expand/collapse, long notes, internal balance snapshot, existing delete eligibility | Every field retained; 44px actions; snapshot delete stays absent | Pending hosted |
| Preparation: open → cancel → reopen; confirm → edit fee/notes → recheck; repeated preview; cancel while busy | Draft/approval invalidation; busy and server-version guard; no automatic email/payment; close behavior unchanged | Pending hosted |
| Partial-payment preparation and uncertain payment proof | Exact total/paid/open values; review-required actions stay blocked; no stale full-amount reminder | Pending hosted |
| History: document search/reset, no result, pagination, selected document, original missing, absent/partial evidence | Search/filter/page URLs survive Back/Forward; warning text remains visible; no implied refund or payment balance | Pending hosted |
| History: payment allocation links, correction/refund proof, event filters, repeated refresh and newer navigation during load | Latest request wins; original/correction/payment/protocol remain distinct; UTC labels and before/after values retained | Pending hosted |
| Service notes: quantities versus manual duration; create retry/uncertain save; repeated submit; archive/reactivate | No duplicate capture; original rounding; retained draft; archived projects blocked for new capture | Pending hosted; requires separately authorized synthetic writes |
| Service notes: filters, empty/error/retry, linked download, unlinked delete, close and reopen, two customers | Counts are filter-scoped; linked note cannot be deleted; visible correct-customer focus return; no stale customer data | Pending hosted |
| Statement: no default selection, filter resets selection, date validation, maximum count, approval, repeated preview, cancel while loading | Explicit selected rows; same PDF bytes preview/download; no billing; abort/revoke lifecycle intact | Pending hosted; preview run requires separate authorization |
| Dialogs: keyboard, Escape, visible Close/Cancel, Back/Forward, 200% zoom | No obscured title/actions, page behind inert, logical focus return, no trapped stale screen | Pending hosted |

All rows require light and dark at 1440 and 390px. Also inspect the reminder
container threshold with expanded/collapsed sidebar; a wide viewport may correctly
show responsive records when the actual work area is narrow.

## Source-only gaps retained, not silently repaired

The existing reminder stage filter and service-note filters are component state;
unlike history filters they are not URL-backed. Existing reminder deletion keeps
its current error/confirmation behavior. These are preserved business/interaction
contracts, not claimed improvements. The redesign adds no recovery state for which
the original components had no logic. Any further behavioral change needs a
separate authorized scope and hosted acceptance.
