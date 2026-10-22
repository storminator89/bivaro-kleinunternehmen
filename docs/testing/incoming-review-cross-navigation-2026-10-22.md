# Receipt review: cross-feature navigation

## Canonical inputs

- PR119: `84e527c1b5e131ccaaa03d7343223ed6a1b6be98`, including the service-PDF drawing-bounds fix and its three regressions for issue #120.
- PR109: `3538d99443dfe37c3c339bc6d2549df4499e02a2`, including the receipt review sequence and native-history boundary.

The cross-feature guard extends these inputs without a database migration, automatic financial posting, new service or global router/history patch.

The regression-correction baseline is PR121 `3eac57bfc5035c2ad42e51dc7ce9e4a2c87f5111`, tree `a5022c359c8a5c22d3b65a5ec04dc7c8a1eb94c1`. Its accepted bank receipt-focus follow-up is retained unchanged.

## Navigation contract

- The purchases workspace owns a cooperative preflight. Opted-in navigation offers **save / discard / stay** before changing route.
- Palette static routes, create actions, record results, unfiltered-list actions and logout close and clear the palette before preflight. Theme changes remain non-navigation actions.
- Palette teardown restores unowned focus to the source before preflight. Its deferred close-autofocus callback never takes focus from a chooser or newer control. While a queue read is in flight, repeated controls are rejected before preparing another intent; distinct navigation still invalidates the older result.
- Deferred actions are one-shot and bound to the live review owner, active receipt, exact source URL and latest intent. Session identity includes status, user id, role and sessionVersion; routine expiry refresh is not an account switch.
- Native Back/Forward choices share that intent generation. A newer request during a traversal save prevents the older traversal replay, even when the newer request is refused while saving. Queue reads also reject stale results.
- `ReviewLink` uses Next's documented [`onNavigate`](https://nextjs.org/docs/app/api-reference/components/link#onnavigate). Modifier/new-tab/download/external-link behavior remains with Next/browser. Without a purchases owner, normal Next navigation is unchanged. A transient menu link does not own the review's lifetime.
- Coverage is limited to app-shell/sidebar navigation, user-menu links, sidebar/user-menu logout, review/provider-settings links and review/approval expense links. The sidebar is normally inert behind the review modal; no test claims click-through access. Unrelated components, raw anchors and other dirty-form systems are outside this contract.

The exact **52-name** screenshot allowlist, **5 MiB** aggregate limit, **one-day** retention, safe-file staging and full-pixel/color-aware lossless codec remain unchanged. Runtime/package/security configuration and protected backlog source files are preserved.

## Verification, in execution order

Environment: Node **22.23.4**, Next **16.4.1**, isolated locked dependencies and Prisma **6.19.3**. Installation passed. The first isolated Prisma generation was cancelled before completion; a subsequent normal generation succeeded without a shared client, alternate mirror or checksum override. Database checks used explicit fresh fixtures.

| Stage | Actual result |
| --- | --- |
| Initial navigation/history focus | **47/47 passed** in two files; scoped lint passed. |
| Typecheck and production build, before the service-PDF follow-up | Passed, including TypeScript and 116-page generation. Two existing dynamic-filesystem tracing warnings remained in `validation-runtime.ts` and `upload-path.ts`. |
| Focused browser attempt, before the follow-up | All **nine cases failed at browser launch**; no test body or behavioral assertion ran. Details below. |
| Codec wrapper correction | Before the ordinary suite, corrected its expected Python case count from 10 to the actual 15; no codec assertion was removed. |
| First full ordinary unit run | **2,398 passed, two failed, eight skipped.** SSR financial-presentation fixtures threw `expected app router to be mounted` while rendering the opted-in link, before their financial assertions. |
| Fixture correction and focused rerun | Only the missing public `next/navigation` hook dependency was supplied; no link/guard replacement or financial assertion change. **29/29 passed**: 27 financial-presentation assertions and two codec wrappers, including all **15 Python cases**. |
| Full ordinary rerun, before the follow-up | **2,400 passed, zero failed, eight skipped** across 187 files. Full lint and repeat typecheck passed. The initial 47 assertions are included, not additional. |
| Accepted service-PDF follow-up incorporated | Renderer, new regression file and codec-wrapper blobs match the PR119 follow-up exactly. Guard changes were retained. |
| Post-service follow-up focus | **79/79 passed** in five files: navigation, queue/history, financial presentation, service-PDF bounds and codec wrappers. Full lint and typecheck passed again. |
| Accepted bank receipt-focus follow-up | Its three source/test files match the PR121 baseline exactly. |
| Hosted browser acceptance, PR121 baseline | **115 passed, three failed**; evidence contained **51/52** required images. This was not acceptance. Details below. |
| New workspace lifecycle regressions, pre-fix source | **Four passed, two failed**: repeated clicks invalidated the held candidate read, including after a failed-read retry. |
| New palette lifecycle matrix, pre-fix source | **Four passed, 28 failed** across focus ownership and correct return-trigger assertions. The delayed callback demonstrably moved focus from the chooser heading back to the source. The initial run had incomplete fake-DOM failure formatting; completing that diagnostic support produced the same counts and readable assertion failures. |
| Corrected lifecycle focus | **38/38 passed** in two files: 32 palette lifecycle/navigation cases and six actual-workspace lifecycle cases. |
| Final corrected-source type/lint | Full TypeScript and zero-warning lint passed, including both new regression files. |
| Corrected full ordinary suite and fixture-aligned recheck | Both runs: **2,448 passed, zero failed, eight skipped** across 191 files, including the 38 new lifecycle cases. The second followed alignment of two synthetic result URLs with the existing search-service contract; implementation was unchanged. Full type/lint passed again after that fixture-only correction. |

The earlier production build **predates** the service-PDF, bank-focus and lifecycle follow-ups; it was not repeated locally on the corrected source. Focused checks do not replace final canonical CI.

### Eight local ordinary-suite skips

No skip was added or changed. These are local conditions, not a claim about another CI run's coverage. The benchmark was not opted in; the other seven assertions required `BIVARO_EINVOICE_TEST_ASSETS`, which was unset locally.

| Source | Exact test title | Reason |
| --- | --- | --- |
| `dashboard-performance.bench.test.ts` | `measures 100, 10k and 100k rows without changing product code` | Existing opt-in suite: `BIVARO_RUN_BENCHMARK !== '1'`. |
| `purchase-validation-process.test.ts` | `enforces one process across requests and removes private originals/reports on interruption` | Existing `it.skipIf(!process.env.BIVARO_EINVOICE_TEST_ASSETS)`. |
| `purchase-validation-runtime.test.ts` | `verifies the complete official rule tree and both derived scenario configurations` | Existing `describe.skipIf(!assetsRoot)`; missing official-assets variable. |
| Same runtime file | `validates synthetic valid-cii.xml with the real offline engine` | Same missing official-assets variable. |
| Same runtime file | `validates synthetic valid-ubl.xml with the real offline engine` | Same missing official-assets variable. |
| Same runtime file | `rejects reachable remote schema hints before either CII/UBL engine can consult them` | Same missing official-assets variable. |
| Same runtime file | `rejects wrong sums and a required missing field through official rules, not heuristics` | Same missing official-assets variable. |
| Same runtime file | `keeps accepted informational guidance visibly distinct from an unqualified technical pass` | Same missing official-assets variable. |

### Local browser-launch failure

The isolated runner selected `incoming-review-sequence.spec.ts`, `incoming-review-cross-navigation.spec.ts` and `record-search.spec.ts`, with one worker, zero retries and system Chromium **155**. This focused invocation omitted the bootstrap project's dependency; it was not full acceptance.

Chromium terminated before every selected test body with:

```text
FATAL:chrome/browser/process_singleton_posix.cc:297
socket() failed: Operation not permitted (1)
```

Crashpad initialization errors also occurred. This is an **OS/sandbox launch failure, not an application assertion result**. No screenshots were produced, and no sandbox/launch-flag workaround or local retry followed.

Prepared cross-feature cases use actual Ctrl+K interaction and a reachable in-review settings link, not synthetic clicks through the modal. They cover customer stay/discard/Back; static/create/list/logout preflight; failed-save retention followed by successful receipt navigation; and a held real save response followed by a newer intent. Assertions compare original download bytes/SHA-256, expected draft-only record changes, unchanged customers and zero expense/income/cash/invoice/payment-journal writes. **These behavioral assertions have not run locally.**

### Hosted browser failures and source corrections

The PR121 baseline's real hosted run completed **115 passing and three failing tests**, with **51/52** evidence images. Unlike the local launch failure, these were application assertion failures:

- `incoming-review-cross-navigation.spec.ts` callers at lines 73 and 162 reached the dirty-draft chooser, but its heading was not focused. Installed Radix FocusScope defers close autofocus beyond `flushSync`; the palette's unconditional restoration then stole focus. The correction preserves immediate intent checks, records the actual source trigger before preflight and makes later restoration conditional on live ownership and unclaimed focus.
- `incoming-review-sequence.spec.ts:85` remained on `sequence-3.xml` after releasing the held candidate response instead of opening `sequence-2.xml`. The second synchronous click prepared a new intent before the existing busy check rejected it, invalidating its own in-flight checkpoint. Moving duplicate rejection before intent preparation preserves that request without exempting distinct navigation from cancellation.

The new component harnesses separate render, commit, chooser effects and the real palette close callback; they use actual workspace/palette handlers and navigation-intent code, with deterministic transport/focus fixtures. Both focus-effect interleavings, repeated clicks/retries, newer intents, source changes and disposal are covered without sleeps or a browser workaround. No existing browser, original-byte, customer or financial assertion was changed. The corrected source has **not** yet received a hosted browser result.

## Remaining acceptance gates

The final canonical commit requires standard CI unit/build/type/lint/security checks and real browser acceptance. Appropriately provisioned validator checks must execute the seven official-assets-dependent assertions above. The local launch failure must remain distinct from application behavior; passing local checks are not full final acceptance. This report claims neither a browser pass nor merge readiness.
