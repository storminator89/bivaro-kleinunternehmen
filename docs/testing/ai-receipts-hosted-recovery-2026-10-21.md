# AI receipt hosted gate recovery — 2026-10-21

This is a minimal successor to local `2a742e2404bef62f389b50e6d75e40b702689ba3` / tree `41d0c47b1aab13c5ce2ff9cc5c394e33b25ef3fb`, published unchanged as draft PR #79 head `d82ccd2cb2f34fa522399339b815d9a30fc82956`. The earlier local evidence document remains a historical checkpoint, not a claim that these hosted gates passed.

## Observed hosted failures

- Browser run `39571924012` and the security browser gate failed **before any browser test** because the production build found TypeScript errors. There are no actual screenshot artifacts from this attempt.
- CI run `39571925181` independently found the same four diagnostics: the expiry fixture used `Record<string, unknown>[]` rather than JSON-safe values; both extraction/apply audit entries lacked required `actorId`/`tenantId`; the deliberately isolated renderer child environment omitted Next's required `NODE_ENV` field.
- Full unit job: **1,395 passed, one failed, two existing skipped**. The failure was a stale photo-confirmation text expectation (`kein OCR`) after the reviewed UI changed that disclosure to `keine automatische Buchung`. Full hosted ESLint and production-only dependency audit passed; build job was skipped after dependent failures. No merge or deployment occurred.
- Raw connector job results/logs are retained outside the frozen source at `/workspace/shared/ai-receipts-publication/13-browser-failed-jobs.json`, `14-browser-failed-logs.json`, `15-ci-jobs.json`, `16-failed-tests-logs.json`, and `16-failed-types-logs.json`.

## Minimal corrections

- Both AI source-review audit entries explicitly bind `actorId` and `tenantId` to the authenticated tenant `userId`, matching the existing single-tenant-per-user model. The real backend journey verifies both actual audit operations exist and carry those identities; no key or provider contents are added.
- Renderer child environment remains a closed five-key allowlist: `PATH`, `NODE_ENV`, `LANG`, private `HOME`, private `TMPDIR`. Only `NODE_ENV` is inherited (with `production` fallback); the environment is never spread. Focused tests check inherited `test` and absent-mode fallback and ensure an unrelated synthetic secret does not reach the child. All prlimit/Ghostscript/time/page/byte constraints are unchanged.
- Expiry fixture first validates persisted closed extraction state, requires exactly one job, then constructs an explicitly typed `Prisma.InputJsonObject` with JSON-safe values. No assertion or cast suppresses the reported type gap.
- Existing photo UI assertion now expects the same exact no-automatic-posting disclosure as the reviewed UI and hosted photo journey; all manual-confirmation assertions remain.

## Successor verification

- Focused single-worker run of extraction lifecycle, bounded renderer input, real synthetic HTTP backend journey and purchase-expense UI: **4 files / 55 tests passed**. Raw output: `/workspace/shared/ai-receipts-publication/successor-focused-tests.log`.
- Scoped ESLint for all six modified TypeScript sources: zero warnings; raw output: `/workspace/shared/ai-receipts-publication/successor-scoped-eslint.log`. Whitespace check clean.
- No local native build, full typecheck, browser execution, provider call, real credential configuration, paid service, dependency/schema change, backlog edit, remote amendment, merge or deployment during this correction. New exact commit/tree requires review before publishing and must then pass hosted gates; 62 browser cases and the exact 19-name/5-MiB/one-day screenshot contract are unchanged.
