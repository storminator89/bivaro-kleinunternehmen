# Issue #96 — prepared hosted browser acceptance

Status: **prepared, not browser-verified**. This note records the additive acceptance package on `feat/bank-allocation-integration`; it does not replace historical audit or backlog evidence.

## Real fixtures and authority boundaries

`e2e/helpers/bank-allocations.ts` seeds only a synthetic user, company settings and customer into the supported runner's fresh temporary database. Each €120 source/target invoice is created in the actual editor, passes the real final PDF rendering/upload route, is downloaded, and is then explicitly marked **Gesendet** through the dashboard. PDF upload alone leaves `DRAFT/UNKNOWN`; the fixture does not fake issuance with a direct status request or database update. It waits for the editor's real next-number response before entering the test number.

The CSV is imported and reviewed through the actual UI. Its saved evidence initially creates no payment or Income. All accepted money/allocation mutations use the authenticated application UI. The second-tab stale request is a deliberately obsolete real HTTP command expected to be rejected, never an accepted bypass. Response interruption either drops a real server success or aborts before forwarding a request; no success is fabricated.

## Six prepared cases

| Case | Required evidence |
| --- | --- |
| 1440 px whole-root journey | €120 − €40 = €80; keyboard Escape/cancel restores opener focus without writes; pending real commit cannot be dismissed or submitted twice; A→B whole €40 reallocation; a live second tab invalidates its reviewed stale state and the real endpoint rejects its captured old revision with `409/PAYMENT_STATE_CHANGED`; lost committed move response reload recovers by GET only. |
| 390 px whole-root journey | Same initial arithmetic and immutable cash/evidence checks; move fails before forwarding; reload restores only opaque scoped recovery identity, never POSTs; a read-only retry remains unresolved; explicit fresh review produces a new key and exactly one actual move. |
| 360 px whole-root journey | Same arithmetic and move; real complete cancellation creates an issued −€120 credit note but does not refund cash; €40 remains due until an actual refund is explicitly documented against current invoice B, original A root and frozen allocation revision 1. |
| Lost initial payment success | A real initial payment commits but response is dropped; reload and recovery GET show the original receipt/current allocation without creating a second root, Income, binding or operation. |
| Never-committed initial payment | Request is aborted before forwarding; reload/read-only retry performs no writes; original payload is unavailable, inputs stay locked until fresh review; a distinct key creates exactly one actual receipt. |
| Truthful wrong-CSV correction | After A→B, a synthetic CSV amount of €40 is reconciled with an actual receipt of €30; only the never-received €10 is corrected through the v3 adjustment UI. No refund or extra reallocation is invented; effective open balance is €90, origin proof remains at A, and original CSV/root/Income stay unchanged. |

Both command families cover lost committed and never-committed reloads. Session storage is asserted to contain exactly seven identity/concurrency fields, scoped to account and row, with no invoice number, reason or command payload; local storage has no recovery record. A separate tab does not inherit that record. Fresh-review recovery clears the superseded old entry only after the server's current state establishes the outcome.

Every whole-root journey checks both v3 axes: A keeps €40 immutable origin cash with zero current allocation; B has zero origin cash and €40 effective allocation. `originEvents` remain at A, `effectivePayments` reference B, and `originAssignments` link the same root to B. Historic initial-receipt GET after the move explicitly reports original A and current B. Root, Income, bank batch/row and original PDF bytes remain unchanged. Refund/correction additionally freeze binding/change/revision evidence and block later reallocation.

## Screenshots and hosted workflow

Exactly three normal-viewport PNGs are added:

- `bank-allocation-confirmation-1440.png`
- `bank-allocation-move-390.png`
- `bank-allocation-current-origin-360.png`

The optional upload allowlist is the exact accepted 52-name union plus these three names (**55**). Existing 5 MiB aggregate/16 MiB input limits, lossless full-pixel checks, safe regular-file/no-symlink/no-follow/inode checks, duplicate rejection, one-day retention and all previous screenshots/assertions remain. Actual screenshot production, aggregate delivery and visual inspection are **pending**, not established by the static count test.

## Verification boundary

- Node 22.23.4 whole-tree TypeScript `--noEmit --incremental false`: passed after final review edits.
- Focused ESLint, zero warnings: passed after final source edits.
- Focused static screenshot-workflow unit assertion: **1 passed, 1 unrelated codec test intentionally not run**; verifies the exact 55-name count and unchanged aggregate cap. No PNG filter/codec execution was needed.
- `git diff --check`: passed.
- Browser, PDF/native/JVM/filter/installer execution, full hosted acceptance, new screenshots and visual QA: **not run locally**. The existing hosted Browser acceptance workflow already provisions the actual PDF validators and headed Chromium prerequisites; the authorized parent must run and inspect that full stage for the exact published candidate SHA.

No application implementation, database migration, production deployment, GitHub write, workflow dispatch or external service change is part of this acceptance-only package. The previous integrated implementation's unit/build result is not re-labelled as browser acceptance.
