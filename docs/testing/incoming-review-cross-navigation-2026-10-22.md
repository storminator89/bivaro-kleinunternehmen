# Receipt review: cross-feature navigation

## Canonical inputs

- PR119: `84e527c1b5e131ccaaa03d7343223ed6a1b6be98`, including the service-PDF drawing-bounds fix and its three regressions for issue #120.
- PR109: `3538d99443dfe37c3c339bc6d2549df4499e02a2`, including the receipt review sequence and native-history boundary.

The cross-feature guard extends these inputs without a database migration, automatic financial posting, new service or global router/history patch.

## Navigation contract

- The purchases workspace owns a cooperative preflight. Opted-in navigation offers **save / discard / stay** before changing route.
- Palette static routes, create actions, record results, unfiltered-list actions and logout close and clear the palette before preflight. Theme changes remain non-navigation actions.
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
| Final combined-source focus | **79/79 passed** in five files: navigation, queue/history, financial presentation, service-PDF bounds and codec wrappers. Full lint and typecheck passed again. |

The full ordinary run and production build **predate** the service-PDF follow-up. Neither was rerun in full on the final combined source; the 79-assertion focus does not replace final canonical CI.

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

### Browser failure and pending behavioral coverage

The isolated runner selected `incoming-review-sequence.spec.ts`, `incoming-review-cross-navigation.spec.ts` and `record-search.spec.ts`, with one worker, zero retries and system Chromium **155**. This focused invocation omitted the bootstrap project's dependency; it was not full acceptance.

Chromium terminated before every selected test body with:

```text
FATAL:chrome/browser/process_singleton_posix.cc:297
socket() failed: Operation not permitted (1)
```

Crashpad initialization errors also occurred. This is an **OS/sandbox launch failure, not an application assertion result**. No screenshots were produced, and no sandbox/launch-flag workaround or local retry followed.

Prepared cross-feature cases use actual Ctrl+K interaction and a reachable in-review settings link, not synthetic clicks through the modal. They cover customer stay/discard/Back; static/create/list/logout preflight; failed-save retention followed by successful receipt navigation; and a held real save response followed by a newer intent. Assertions compare original download bytes/SHA-256, expected draft-only record changes, unchanged customers and zero expense/income/cash/invoice/payment-journal writes. **These behavioral assertions have not run locally.**

## Remaining acceptance gates

The final canonical commit requires standard CI unit/build/type/lint/security checks and real browser acceptance. Appropriately provisioned validator checks must execute the seven official-assets-dependent assertions above. The local launch failure must remain distinct from application behavior; focused passing checks are not full final acceptance. This report claims neither a browser pass nor merge readiness.
