# Issue #96 — hosted browser acceptance recovery checkpoint

Status at **2026-10-23, 05:47 UTC**: **partial hosted verification; recovery prepared, exact recovery rerun pending**. This note records the additive acceptance package and its subsequent bounded recovery on `feat/bank-allocation-integration`; it does not replace historical audit or backlog evidence or claim final acceptance.

## Confirmed hosted result and current recovery

For the exact tested hosted head **`9a23633cd264b13171ed3cd787c256705e16babe`**, tree `ee72b3e9b753b5b8f7323bf62d7856cd078c014e`, [CI 39905018417](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39905018417) passed **3,957 tests / 20 skips**; [own-invoice PDF-A 39905018441](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39905018441) passed on x64 and ARM, and [container 39905018427](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39905018427) passed on x64 and ARM. These are hosted results, not local native reproduction.

[Browser acceptance 39905018436](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39905018436) passed **122 of 130 cases**, with **8 failures**: four strict-mode Close-button locator ambiguities, one stale adjusted-CSV review assertion, and three stale foreign-currency label assertions. Of the six new #96 cases below, **two recovery cases passed and four were locator-blocked**. Passing the two cases does not establish the remaining whole-root, refund/correction or screenshot acceptance.

The pending source recovery narrows Close-button selection to the success dialog footer without removing focus, arithmetic, no-write or immutability checks. Adjusted CSV history is separately checked using the server's genuine v2 fallback and its checked v3 projection; no journal body or success is fabricated. Foreign-currency evidence uses the current exact review label and still asserts that invoice selection is disabled. These changes are prepared, **not yet verified by a hosted rerun of the exact recovery candidate**.

The initial visual artifact **`12481385882`** shows that the 5 MiB screenshot-output cap was effectively exhausted before all three new views were produced: **52 of the 55 known images, 5,241,047 of 5,242,880 bytes**, leaving only **1,833 bytes**. That bounded initial result does not establish production, delivery or visual inspection of the three new allocation views. The explicitly authorized output-only recovery is described below; it is not a new image allowlist or relaxed input/codec boundary.

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

The optional upload allowlist remains the exact accepted 52-name union plus these three names (**55**). The specifically authorized recovery raises only the aggregate **encoded screenshot output** cap from **5 MiB to 8 MiB (8,388,608 bytes)** for those exact 55 known images after the observed 52-image budget exhaustion. The source recovery keeps these boundaries unchanged:

- **5 MiB encoded input per file** and **16 MiB aggregate encoded input**;
- codec **64 MiB pixel/decode bound** and **16 MiB strong-filter bound**;
- safe regular paths, no symlink traversal, no-follow opens and inode/device identity checks;
- duplicate-basename rejection, lossless full-pixel proof, exact allowlist and one-day retention;
- all previous screenshot names and substantive browser assertions.

This is a bounded output-cap correction, not permission to enlarge input/decode/filter budgets or accept arbitrary images. The exact recovery candidate still needs hosted execution, delivery of all expected new views and actual visual inspection. Neither the static allowlist assertions nor the initial 52-image output establish that result.

## Historical acceptance-package checks — `82935f6`

The following checks belong to the original prepared acceptance-package checkpoint, **not the current uncommitted recovery** or the hosted head above. They are retained as historical evidence only:

- Node 22.23.4 whole-tree TypeScript `--noEmit --incremental false`: passed after final review edits.
- Focused ESLint, zero warnings: passed after final source edits.
- Focused static screenshot-workflow unit assertion: **1 passed, 1 unrelated codec test intentionally not run**; verified the exact 55-name count and the then-current 5 MiB aggregate output cap. It does not verify the new 8 MiB source recovery. No PNG filter/codec execution was needed.
- `git diff --check`: passed.
- Browser, PDF/native/JVM/filter/installer execution, full hosted acceptance, new screenshots and visual QA: **not run locally**. The subsequent hosted results are reported separately above; the hosted workflow already provisions the actual PDF validators and headed Chromium prerequisites.

## Current verification boundary

The locator/assertion/output-cap recovery is uncommitted and pending publication at this observation; no current candidate SHA is assigned. Independent source review found no remaining issue. Local bounded verification passed **39 pure/static tests**, with **54 skipped tests**, plus focused lint and whole-tree TypeScript checking. The 54 skipped tests are not passing evidence; these bounded checks do not establish hosted or visual acceptance. The exact hosted recovery result is still pending. No local browser/native/JVM/PDF/filter/installer execution is authorized or reported by this note; ordinary permitted type/static checks remain distinct from hosted browser evidence.

This acceptance-only recovery does not change application implementation, database migrations, production deployment or an external service. The prior implementation/package checks and the hosted unit/PDF-A/container passes are not re-labelled as complete #96 browser acceptance. Final acceptance remains open until the exact recovery candidate passes the required hosted stages and its new screenshot evidence is actually reviewed.
