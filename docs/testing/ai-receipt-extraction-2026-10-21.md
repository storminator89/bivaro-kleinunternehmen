# Optional AI receipt extraction: implementation verification

Base: immutable `352a35f2e241016cc6c1a83cc0891724cf2a2bf9` plus provider foundation `a485ed0baae45992e1a6a822648eda2407217750` and opaque-precondition followup `18ac5bc8f554ab07e0ada74a8aeb0d2098e709a4`. Extraction lane owns migration091000; provider owns090000. No push, merge, deployment, real key, actual provider request, paid synthetic call or hosted service created in this lane.

## Passed

- Focused final run: **13 files /219 tests passed**, one worker. AI receipt validation/input/service/backup, bounded inbox projection regression, existing intake/manual human approval, original backup/restore, annual-context backup, billing-note backup, payment-journal/full/partial backup and fiscal-profile backup.
- New AI tests: closed JSON/instruction injection, unknown fields, over-size/text/position limits, exact decimals/invalid date/currency; explicit line completeness; native PDF argument/resource caps/fifth-page/incomplete/missing/timeout rejection and cleanup (native execution mocked); tenant/revision/config-version/configuration-revision checks; durable idempotency/single-flight; concurrent manual-draft preservation; free empty-field apply with provider disabled; failed/unknown explicit retries only; cancellation/stale read; explicit auto-new-upload opt-in/replay; zero financial writes by extraction; backup original/evidence integrity and no provider-secret import or target-provider mutation.
- Explicit human approval test preserves AI-origin result+human-confirmed draft snapshot, freezes active attempts before immutable source closure, and verifies DB rejects subsequent rewrite. Existing manual original/buyer/payment attestations remain required.
- Projection regression seeds multi-MB AI history/approved-result sentinels and verifies list queries select neither full AI JSON field nor return it.
- Focused ESLint over new AI APIs/services/tests and modified production server files: zero warnings/errors. `git diff --check`: passed.
- Private generated client schema matches source schema after whitespace normalization; both `.prisma` and `@prisma/client` realpaths are this worktree's private copies.

## Not passed / not run

- Exactly one authorized bounded typecheck (`NODE_OPTIONS=--max-old-space-size=768 timeout120 node .../tsc --noEmit --pretty false --incremental false`) terminated with V8 heap OOM, exit134, after about17 seconds. No compiler diagnostics were produced; **typecheck is unverified**, not passed. No retry or higher heap used.
- No native full build, local browser/function journey or new GitHub CI run.
- No real Ghostscript/provider interoperability certification: PDF execution is mocked in focused tests; image/PDF provider support depends on configured model and runtime dependencies.
- Published-site journeys, screenshot review and integrated deployment acceptance remain root/UI-lane work. Initial auto-upload HTTP response waits for bounded analysis after durable original storage; no initial queued/preview UI is promised before that response.

Historical-schema test fixtures were updated to omit the newly introduced excluded `AiProviderSettings` coverage entry when constructing genuinely older manifests. Validation remains closed: older schema identities reject non-null AI evidence rather than silently discarding it.

## Minimal terminal-expiry successor

Reviewer source finding: status originally displayed expired running jobs as unknown without storing that transition, so a delayed callback could revive the persisted running job and auto-fill a draft. Fixed with CAS-persisted expiry on status/claim, an independent deadline guard inside completion, overall90s cancellation/race across preparation/provider, and signal propagation into the native PDF child. Closed sources remain untouched. Promise-race branches retain rejection handlers, including late ignored cancellation failures.

Deterministic fake-clock/deferred-provider regressions cover polled durable expiry plus late reply, no-poll late reply, old completion after a successful explicit retry on a simulated second processing replica plus subsequent manual edit, overall-deadline cancellation with an ignoring/late-rejecting mock provider, and predispatch expiry during preparation. No real provider call or new native typecheck was performed.

Successor focused verification: **6 files /91 tests passed** (AI extraction/input/validation/backup, existing explicit purchase approval and bounded list projections), one worker; focused lint and `git diff --check` passed. The earlier typecheck OOM remains unresolved; no additional typecheck was attempted.
