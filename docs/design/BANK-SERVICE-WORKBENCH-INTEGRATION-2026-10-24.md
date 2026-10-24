# Bank and service workbench integration

**Status:** [draft PR #141](https://github.com/storminator89/bivaro-kleinunternehmen/pull/141); corrective hosted reacceptance pending. No merge or separate deployment.
**Accepted main:** `17cd6f124b96260efa32607d9c1866aa3e3e802b`.
**Accepted tree:** `2a4667456891cbcb1ab451ee75b7466b1db2b8e0`.
**Initial runtime integration commit:** `817e6b5d8b8a7999bd3e5f9d5abbcec27b673e0d`.
**Initial runtime integration tree:** `ee3b3da90199ca4eb4ba9ee1456e5c55b20cabaa`.

## Separate ownership, combined review

| Package | Original owner commit | Integrated commit | Scope |
| --- | --- | --- | --- |
| Bank/import | `cbfb66f169c044ef2178a3149aa3f9afb91fda9f` | `d097f9f` | Source/profile split, mapping, control totals, preview/evidence ledger, save rail, receipt/history and allocation review |
| Service billing | `867dd837c6762a2ba9f923e256c0dcad36953068` | `cd26583` | Service-plan ledger, split plan editor, period review and Today/full compact queue |

Both packages applied cleanly to the exact accepted main. Existing import-profile
and numbering features remain intact. Integration changes are limited to their
owned presentation, pure regressions, hosted acceptance and documentation.
There are no application API, backend, schema, dependency, shared shell/theme,
finance, idempotency or tenant-boundary changes.

The combined source review resolved three presentation/compatibility findings:

1. Reopened history entries now own an inline-size container, so their allocation
   rows use the existing three-column desktop layout at their actual available
   width. The narrow save rail stays stacked.
2. An initial history error no longer continues announcing loading or showing its
   loading skeleton. Fetch, retry, sequence and focus contracts are unchanged.
3. New service/Today muted text uses `--bivaro-color-muted`. The accepted compiled
   Tailwind stylesheet also defines `--color-muted` as the muted **surface**, so
   that ambiguous alias is unsuitable for these new text declarations. Only the
   scoped declarations changed, not the shared theme.

The existing `p.tabular-nums` amount selector is retained for established hosted
service acceptance; existing tests were not rewritten to accommodate the UI.

Bank AST contracts pin 231 owned bindings, including handlers, guards, focus
refs, destinations and field values, plus existing hooks/request expressions.
Service/Today AST contracts likewise pin accepted-base bindings and logic.
These are source/pure-fixture checks, not rendered accessibility acceptance.

## Verification and limits

All implementation checks use Node **22.23.4**. Dependencies were fully copied
into this isolated `/tmp` worktree without hardlinks to the shared dependency
installation. No install or dependency modification was used.

- **Passed:** normal final `npm run build`, including the unmodified PDF.js
  integrity prebuild and third-party notices postbuild. All 119 pages generated.
  Runtime source SHA-256 fingerprints match the final build. The official and
  adapted PDF.js workers retain their reviewed hashes, single links and adapted
  read-only mode.
- **Passed:** full repository ESLint with zero warnings and final standalone
  `tsc --noEmit --incremental false`.
- **Passed before the final selector-only fix:** 57 pure tests across bank UI,
  service UI, payment-allocation core and payment-journal route files. The two
  payment files passed after removal of an unnecessary temporary `NEXTAUTH_URL`
  override; no application security behavior was changed.
- **Passed by the acceptance owner:** 12 pure evidence-bound checks, TypeScript,
  focused ESLint and embedded workflow Python syntax checks.
- **Passed:** static syntax parsing of all five embedded workflow Python blocks,
  exact accepted-workflow prefix hash, scope inspection and `git diff --check`.
- **Not a full test pass:** the initial full pure run had 4,197 passed, 17 failed
  and 27 skipped. The 17 failures were origin-guard expectations caused by the
  temporary auth URL mismatch, not changed runtime code.
- **Blocked/inconclusive:** the corrected full pure run has no terminal JSON
  report. Polling it was rejected by auto-review as local tests triggering npm
  registry metadata access. Its produced log contains startup only and no fetch
  evidence. No bypass/retry was made; further test execution/result polling is
  paused pending explicit authorization.
- **Outstanding:** hosted browser/visual acceptance. No local application server,
  functional browser, Playwright run or new GitHub CI run was performed.

The final build has nine existing Turbopack filesystem-tracing warnings. Their
source locations exactly match the accepted earlier build; this package does not
silence or change them. Hallmark executable scanner/capture scripts are absent
from the supplied reference-only skill, so no scanner pass is claimed.

## Bounded hosted acceptance prepared, not executed

`e2e/bank-billing-redesign.spec.ts` adds **four declared presentation cases**.
All prior 148 hosted cases are unchanged. Existing genuine bank/service mutation
coverage remains authoritative; the new cases use isolated synthetic login,
intercepted reads and explicit write guards/rejected commands.

Every surface below has full-page evidence planned at **1440 and 390 pixels**,
each in **light and dark** mode, for **28 exact new PNG names**:

| Surface suffix | Evidence/behavior |
| --- | --- |
| `bank-preview` | Exact incoming/outgoing amounts, control totals and separate confirmation rail |
| `bank-history` | Reopened immutable evidence, current assignment/origin distinction, actual-width desktop columns |
| `bank-allocation` | Exact previous/target remainder, unconfirmed action disabled, cancel/Escape/focus return |
| `service-plans` | Exact canonical amount, anchored dates and one-period decision |
| `service-editor` | Fixed existing schedule, repeated line fields, reachable footer, retained inputs and busy close guard |
| `today` | Exact very large cents, unknown amount, partial selection, source-owned navigation and Back/Forward |
| `today-compact` | Existing intentionally one-column dashboard container and full-queue destination |

Names follow `bank-billing-<suffix>-<light|dark>-<1440|390>.png`.
Profile loading/application, mapping, narrow saved receipt rail, reallocation
review and generate/skip cancellation also receive both-size/both-theme geometry
checks. Interrupted service requests retry the same payload without a business
write. Failed history suppresses false loading; failed lists clear stale data;
loading/empty/recovery paths remain explicit.

The fifth evidence partition allows **4 MiB output / 8 MiB input**, at most
**1 MiB input per PNG**, two lossless workers and the existing per-image pixel
limit. The original four partitions, all **125** image names, their exact
workflow bytes and **16 MiB** aggregate output budget remain unchanged and
SHA-pinned. The new combined bound is 153 PNGs / 20 MiB output; no old proof,
permission, retry, job timeout or lossless metadata/full-pixel guard was relaxed.

## Draft publication scope

Local branch: `redesign/bank-billing-integration-20261024`.
A future authorized draft may include only these two UI packages, integration
presentation fixes, their regressions and bounded hosted evidence. Publication,
CI initiation, merge and deployment are not implied by this integration.

Before calling the package fully verified: resolve the pure-test authorization
block, establish the corrected test result, run hosted acceptance for the exact
published candidate and inspect the required visual artifacts. Until then the
redesign is not described as released or fully accepted.


## Hosted verification and corrective acceptance update

The first published candidate `9789edcf0309d13c6e7de19f90babb027c3b5515`
was independently verified to have the exact reviewed local tree above and the
unchanged accepted-main parent. Full GitHub CI passed: **4,228 tests / 270 files**,
**20 tests / 3 files skipped**, zero failures; security, lint/type and production
build passed. Both x64 and arm64 own-invoice final-byte conformance jobs passed.
This establishes the full hosted unit result without bypassing the denied local
process. The historical local-run disclosure above remains accurate.

The first Chromium run (40101527932) completed with **150 passed / 2 failed**,
zero retries. All 148 prior cases passed. The two new-case findings were:

- The bank history error locator also matched Next's global route announcer.
  Application-error assertions now target their named owning region; no assertion,
  timeout, retry or product state was weakened. The identical global-alert pattern
  in the service load-error assertion is scoped too.
- Escape from the controlled service editor did not restore its external opener.
  Installed Radix suppresses fallback restoration while its trigger ref is null.
  The scoped editor and period-review dialogs now capture/restore a connected,
  visible, enabled, non-inert opener; refs clear before successful save/review so
  existing reload-to-heading focus remains authoritative. Busy guards and all
  financial/request logic are unchanged. Original accepted-main AST hashes are
  retained; exactly two additive autofocus handlers per dialog are separately
  asserted. New pure fixture regressions await GitHub execution, not local tests.

All original **28** new screenshots were generated and losslessly delivered in
artifact **12564070817**, with **3,622,038 PNG bytes** inside the unchanged 4 MiB
output budget. The archive digest, each PNG hash and all decoded full-pixel hashes
were independently matched. All 28 actual original-resolution images were opened
by the integration/visual-review team. No blocking rendered defect was observed.
However, the two mobile editor stills showed setup and footer, not the lower inner
scroll content; they are **not** treated as full editor visual approval.

To close that evidence gap, retain all 28 named captures and add exactly **two**
`bank-billing-service-editor-bottom-<light|dark>-390.png` captures. Hosted checks
perform real nested scrolling, prove positive scroll position, verify every line
field/add/article control by clipping-aware hit tests, then capture the lower
editor/total with reachable footer actions. Complete evidence now requires **30**
new PNGs. The fifth partition remains **4 MiB output / 8 MiB input**, with unchanged
per-file/pixel/lossless/timeout protections; the original 125 proofs and all
previous assertions remain intact. Combined evidence is bounded to 155 PNGs /
20 MiB output. Corrected-head full CI, Chromium and actual 30-image review remain
pending; this is not a release or merge approval.
