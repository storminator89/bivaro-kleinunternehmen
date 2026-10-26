# API-key list read states — GitHub #83, local-only checkpoint

Observed: 2026-10-26, 23:12 UTC. GitHub #83 is not historical BV-083.

## Exact basis and bounded scope

- Provider main: `595e5e44525ec0967b627f482bc78f607dcabe15`.
- Exact available source tree: `7b8916a9f56a609b3b923121e9e26e8b83796254`.
- Local parentless base: `6da6d480ad0ee4d5f043f22ed5cfffd8a42f04a0`. This commit is **synthetic, not the provider commit or provider ancestry**.
- Isolated worktree: `bivaro-api-key-list-read-83`; changes remain local and uncommitted.
- Only runtime source changed: `app/settings/api-keys/page.tsx`, for list-read presentation and lifecycle.

The confirmed source bug silently discarded failed GETs and ended loading with default `[]`, incorrectly displaying `0/10 · 0 aktiv` and the empty-list creation prompt. Failed refreshes could also leave old keys looking current.

The list now has pending/error/success states, unknown counts until a validated successful GET, an accessible status/alert region, deliberate GET retry and a read-only list-refresh control. Only successful `[]` offers empty-list creation. Unconfirmed reads disable the header create affordance and remove old rows/actions; no failed read is treated as a successful empty result. Malformed JSON/rows are unavailable, not empty. Latest-read identity, AbortController and mounted guards ignore superseded/unmounted responses, including transports that ignore abort. There is no automatic retry.

Existing create/delete/toggle handlers, clipboard/scope/date helpers and CORS handlers are byte-identical. The CORS read function, entire CORS/create/one-time-secret UI tail and existing successful-list table are also byte-identical (local preservation proof). Auth, roles, server/API routes, API-key generation/storage, security policy, schema, dependencies and workflows are unchanged. No actual key or credential was created/configured, no permission action was performed and no secret was read or recorded.

## Actual checks on the final executable source

Node **24.22.1**; existing dependency tree reused, no install or shared Prisma regeneration.

| Check | Actual result |
|---|---|
| Clean exact-base regression probe, one pending-count unit case | Expected red: old page displays `0/10 · 0 aktiv` before confirmation; 1 failed / 15 filtered-out cases. |
| Focused Vitest | 2 suites / **63 passed / 0 skipped**: 16 API-key list hook-harness cases and 47 focused-selector cases. |
| Focused ESLint, five executable changed paths, `--max-warnings 0` | Passed, zero warnings. |
| Scoped TypeScript, page/tests/authored browser source/selector tests, no incremental cache | Passed, Exit 0, 1536-MiB memory cap. |
| Selector `node --check` | Passed, Exit 0. |
| Byte-preservation checks | All four handler/table/CORS/secret-region checks passed. |

The node-only page harness uses synthetic GET mocks, no application server, database or key mutation. Cases cover delayed initial read, successful empty/nonempty lists and counts, 401/403/503, network failure, invalid JSON/rows/dates, deliberate GET retry, stale refresh invalidation, old success/error after a newer read and unmount/retained callback suppression.

Four browser cases are **authored only, not executed**: held failure → keyboard GET retry → confirmed list → failed refresh → explicit retry → confirmed empty reload at 1440/360/390 px, plus denied/network/malformed deliveries. They use a fresh runner-guarded synthetic login fixture and intercepted GET deliveries, not actual API-key records, API mutations, real credentials or policy proof. The exact page and spec select only these four titles plus the existing independent core. Missing spec/unit/runner/login/core contracts fail closed; API-key/CORS server routes and unknown security sources retain critical review requirements. No broad-suite fallback, retry inflation or workflow change.

## Evidence and open acceptance

Local logs (not hosted or release evidence):

- `bivaro-api-key-list-read-83-unit.log`: SHA-256 `df528d24399d6c8ec00540befcd8a230ab3fb5e6ef95063f48b864290692b5e3`.
- Empty lint/types/selector-syntax logs after Exit 0: SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `bivaro-api-key-list-read-83-baseline-red.log`: SHA-256 `944dffdf1ac2c4d384593ae212d45337fac05667e96b6cbc1c3b6a66f8ec1ee6`.
- `bivaro-api-key-list-read-83-preservation.json`: region-preservation proof; final source SHA-256 `70c30d75d93ade7f063d0d7168eb75587419ab2e9af68b0ed0bd552b767e9e50`.

**Browser/layout, hosted exact-head and release acceptance remain open.** No local browser/server/API/database execution, full suite, full build, dependency installation, new CI run, remote write, PR, merge, deployment or issue closure. The known socket-permission boundary was not retried or bypassed. Paired backlog documentation appends this local checkpoint only; all 160 historical ticket objects, summaries and earlier records remain unchanged.
