# Test and legacy-code audit — 17 October 2026

Status: completed with no blocking failures. All changes in this audit are
uncommitted; the pre-existing dirty baseline is preserved.

## Scope and baseline

The request is to find unused legacy code, prove code and tests obsolete before
removing them, fix actual bugs, preserve useful coverage, and report checks and
blockers. Independent agents inspect production reachability, test relevance,
and harness/documentation concerns; the coordinating agent reviews their changes
and runs shared checks.

The observed starting revision is
`4b293ff3081455bd7e21f08dbc928e5ffe4cd051` on `main`. Before documentation
changes, `git status --short` contained 141 entries: 113 modified tracked files
and 28 untracked entries. These existing UI, security, configuration, and test
changes are part of the audit baseline, not newly attributed to this work. The
working tree is shared, so the audit is against the observed working tree rather
than only the committed revision.

The initial source inventory contains 56 Vitest `.test.ts` files and two Playwright
`.spec.ts` files. Every Vitest file is inside `__tests__`, matching the explicit
include in `vitest.config.mts`; build artifacts and dependencies remain excluded.
Counts are inventory evidence, not a claim that all cases have passed.

## Deletion standard

A removal needs evidence that no production, framework, dynamic, script,
documentation, or supported compatibility consumer remains. Any test-only
references must exercise only that unreachable implementation; useful shared
behavior is checked through its active replacement. A failed assertion against
live behavior is investigated as a possible bug. Tests are not removed,
skipped, or weakened merely to obtain a green run.

## Proven unused code removed

The frontend audit removed 12 previously clean files and one obsolete barrel
export, totaling 1,191 source lines. For the first 11 files (626 lines), the
proof used TypeScript's AST and `resolveModuleName` to follow imports,
re-exports, dynamic import strings, and `require` strings, with every `app/**`
module plus `proxy.ts` and `next.config.ts` treated as roots. None of these
modules was reachable. Whole-repository text searches, including hidden files
and excluding dependency/build/Git internals, found no additional consumers,
test references, or documented external API contract.

The additional 564-line `RemindersModal` required symbol-level inspection:
its barrel remained live, but the sole consumer named only the other five
modals. Whole-repository symbol search found `RemindersModal` only in its
definition and the removed barrel export, with no namespace or dynamic
consumer. This distinguishes an unused exported branch from an entirely
unreachable module.

| Removed files | Evidence of superseded behavior |
|---|---|
| `components/charts/overview-chart.tsx` | The active dashboard imports `YearComparison`; no consumer reaches this old chart. |
| `components/dashboard/collapsible-kpi-card.tsx`, `components/dashboard/kpi-card.tsx` | `dashboard-header.tsx` imports the active `MetricCard`. |
| `components/dashboard/create-quote-modal.tsx` | Quote creation navigates to `/dashboard/quotes/new`, whose route uses `QuotePageEditor` and `QuoteEditor`. |
| `components/dashboard/recent-activity.tsx` | `dashboard-client.tsx` imports `DashboardActivityFeed`. |
| `components/ui/reveal.tsx` | Its former landing-page animation has no import or runtime consumer. |
| `hooks/index.ts`, `hooks/use-customers.ts`, `hooks/use-expenses.ts`, `hooks/use-incomes.ts`, `hooks/use-invoices.ts` | The dashboard uses `useDashboardData` with active TanStack list queries; only the dead barrel referenced these four hooks. |
| `components/dashboard/modals/reminders-modal.tsx` and its export from `components/dashboard/modals/index.ts` | `/dashboard/reminders` independently implements create, mark-paid, and delete workflows, is linked from navigation and the command palette, and is included in E2E workspace navigation. |

Shared UI scaffolding and all routes are retained. No tests are removed with
these files. Reachability proves the observed repository state; it does not
claim knowledge of an external private consumer absent from the repository.

Six unused direct dependencies were also removed with an offline npm uninstall,
removing 92 installed packages from the tree:
`@auth/prisma-adapter`, `@shadcn/ui`, `formidable`, `pdf.js-extract`,
`pdfjs-dist`, and `@types/uuid`. TypeScript AST import resolution and
repository-wide searches found no runtime, tooling, or configuration consumers.
The live authentication path uses credentials without the Prisma adapter;
uploads use native `formData`; PDF paths use `pdf-lib`; UUID generation uses
Node's crypto API. Pre-existing package upgrades and security changes remain
part of the dirty baseline and are not credited to this removal.

The backend audit additionally removed dead exported helpers after symbol and
import checks showed no runtime consumers:

| Module | Removed obsolete branch | Preserved or improved evidence |
|---|---|---|
| `lib/security.ts` | Generic file/path/type/size/random-name helpers, their constant tables, unused HTML escaping, rate-limit-key, CSRF-token, and header helpers. | Keep the three live registration/user-management inputs: `validatePassword`, `isValidEmail`, and `sanitizeString`. Tests solely for deleted implementations are removed; the actual e-invoice HTML renderer gains ampersand, quote, and apostrophe payload assertions. |
| `lib/api-auth.ts` | `checkRateLimit` and its module-local `Map`; its only callers were four old unit tests. | Live `withApiAuth` uses persisted `consumeRateLimit`. New integration cases exercise authenticated per-key quotas, requests 100/101 across independent Prisma connections, expiry reset, and preservation of `lastUsedAt` after denial. |
| `lib/upload-path.ts` | Uncalled `ensureTenantUploadDirSync`, `readTenantFile`, `getUploadPath`, `isPathWithinUploadDir`, and `ensureUploadDirExists` wrappers. | Keep live legacy reads (`getLegacyUploadPath`/`findUploadedFile`) and tenant storage. The rewritten suite contains 23 active legacy/tenant path, traversal, isolation, and storage cases. |

The reduced helper-test count reflects deleted unreachable implementations.
Meaningful behavior is exercised through the live renderer, upload resolver,
and persisted API wrapper rather than through removed alternatives.

## Compatibility and coverage retained

- `RecurringExpensesModal` remains reachable from the expense tab and renders
  from the dashboard. `CreateInvoiceModal` remains part of quote conversion and
  the invoice editor page despite the newer invoice route.
- Live route compatibility, including the `income` alias and deep links, remains
  present; names alone do not prove a route obsolete.
- `password-policy.test.ts` checks historical bcrypt verification, including
  accepted legacy hash prefixes and overlength inputs. New-password byte limits
  do not make existing login compatibility obsolete.
- `bootstrap-migration.test.ts` and `income-date-review-migration.test.ts` create
  pre-upgrade fixtures. These exercise real upgrade behavior and data retention;
  their historical schemas are intentional.
- `invoice-financial-integrity.test.ts` protects legacy invoices whose issuance
  state is unknown. A conservative deletion guard remains necessary.
- `private-upload-routing.test.ts` protects the blocked legacy public-upload URL
  boundary; old URLs are still inputs to the application.
- The dashboard performance suite is explicitly opt-in through
  `BIVARO_RUN_BENCHMARK=1`; its default skip is not evidence of obsolescence.
- The PDF/A conversion test is conditional on a usable Ghostscript executable.
  Keep this integration check and report dependency limits separately.
- Maintenance, Money, and EÜR utilities whose supported-consumer contract was
  uncertain remain present; apparent lack of imports alone was insufficient
  evidence to delete them.

Static inspection found no focused `.only`, `.todo`, or unconditional skipped
tests. This statement concerns checked-in test source patterns, not coverage
completeness.

## Harness findings

Two real test defects were fixed. The old upload-path suite imported its root
from the repository working directory and wrote under real `data/uploads`;
it now resolves the module under a fresh temporary working-directory fixture
and unconditionally cleans that fixture. The benchmark previously accepted a
quick error response with zero SELECTs because it only checked an upper query
bound. Warmup and every measured response now require HTTP 200 and the seeded
revenue/expense totals, and query counts must be positive as well as bounded.

At audit entry, regular Playwright used the fixed repository `prisma/e2e.db`.
`scripts/prepare-e2e.mjs` ignored the caller's `DATABASE_URL`, deleted that file
and journals, then migrated it. This cannot select `prisma/dev.db`, but does not
meet the current repository rule requiring a fresh temporary fixture directory
for every database experiment. The separate security E2E runner already used
`mkdtemp` and an explicit fixture URL.

Regular E2E now runs through `scripts/run-e2e.mjs`, creates a fresh temporary
directory, passes the same explicit URL to Playwright and migrations, and
removes its fixture afterward. `scripts/e2e-fixture.mjs` rejects missing,
repository, relative, nested, and symlink fixture paths. Preparation creates
the database exclusively (`wx`) and refuses an existing file instead of
deleting it. Four focused guard tests pass, and the edited/new `.mjs` runners
pass `node --check`. The runner forwards Playwright arguments.

An independent cancellation probe then found a real lifecycle bug: sending
SIGTERM to a wrapper left its fixture and child process alive because default
signal termination bypassed `finally`. The shared `scripts/e2e-process.mjs`
now forwards SIGINT/SIGTERM, awaits child shutdown, cleans the fixture, and
returns exit status 130/143. Both normal and security runners use it. Six fake
CLI process regressions cover both runners' argument/exit-code forwarding,
forced temporary `DATABASE_URL`, preservation of an inherited database marker,
normal cleanup, and SIGINT/SIGTERM cleanup. They passed together with the four
fixture-boundary cases (10/10), without a real database or application server.

The browser run found port 3100 already occupied. The existing server was
preserved. Playwright now accepts a validated `BIVARO_E2E_PORT`, and three
hardcoded port-3100 URLs in the main spec use Playwright's configured `baseURL`.
The audit run uses port 3117. This fixes test-harness portability while retaining
the same assertions and an isolated application/database.

The backdated-income case exposed a Playwright response-inspection stall after
a successful POST. Trace and the following GET showed the saved date correctly;
multiple interception variants reproduced the stalled browser `Response.body`.
The test now captures and asserts the real upstream JSON body, then fulfills the
browser with those exact bytes. Its 400-recovery, request-date, stored-ISO-date,
and desktop/mobile date assertions remain. Focused registration plus date
verification passed 2/2 in 17.2 s, and the final full browser run also passed.
This is a test-harness fix, with no application runtime change or waived date
check.

A later full run reached 14 passed cases before the same body-inspection stall
at customer creation. That case formerly read the mutation body only to extract
an ID. It now retains the successful POST check and reads the persisted customer
through the real GET API, asserting both its name and private note before using
its ID. This strengthens persistence coverage without changing product behavior.
The focused billing run then exposed a test-order dependency: it relied on an
earlier XRechnung case to seed required issuer settings. A shared synthetic
`invoiceIssuer` fixture now seeds both scenarios explicitly, preserving issuer
validation. Focused registration plus the complete customer/billing workflow
passed 2/2 in 14.2 s, including save conflict, lost-response/idempotent retry,
download, note privacy, and price history. The final full run executed and
passed all 20 cases; no later serial case remains unverified.

`AGENTS.md` and `README.md` no longer present the obsolete 166-tests/seven-files
count or `vitest.config.ts` filename as current facts. README points to this
dated report instead of a permanent hardcoded green-test claim.

Shared Vitest integration fixtures and migration tests create fresh temporary
directories and explicitly pass their URLs to Prisma. The database helper can
leave its temporary directory behind if migration setup throws before returning
the cleanup handle; this is a cleanup limitation, not evidence of a production
database mutation.

The CI build job uses `file:./dev.db` as a dummy URL. A build is not a migration,
and this inspection does not establish that the build writes data. A temporary
sentinel would make its intended isolation clearer. ESLint's source-file pattern
does not apply JavaScript rules to `.mjs` scripts; use `node --check` for any
edited runners as an additional relevant check.

## Prior incidents and backlog limits

The [19 September incident report](../backlog/PRUEFVORFALL-2026-09-19.md)
records an earlier migration against the local development database and an
earlier Compose-secret diagnostic exposure. Those facts and the prior user
decision against recovery remain preserved. They are not caused or resolved by
this audit; operator review remains documented as open and recovery is not a
current work blocker.

This audit does not claim new backlog acceptance-criterion completion. The 160
ticket states remain: 3 complete, 21 partial, 4 architecture discovery, and 132
proposed/unimplemented. The original audit/backlog sources are preserved.

## Final checks

All results below are from this audit, with explicit temporary database targets
for database experiments. Historical September totals are not reused as current
evidence. No schema change or production-data migration was introduced.

| Check | Actual result |
|---|---|
| Full Vitest with `BIVARO_RUN_BENCHMARK=1` | **58 files, 424 tests passed, zero skips**, 41.73 s. Ghostscript conversion executed. |
| `BIVARO_E2E_PORT=3117 npm run test:e2e -- --trace=retain-on-failure` | **20 passed**, 1.1 min, zero retries/skips; fresh database and production build. |
| `npm run test:e2e:security` | **1 passed**, 12.6 s; separate temporary database, port 3101, and production build. |
| `npm run build` | Passed independently and within final browser runners. |
| `npm run lint` and `npx tsc --noEmit` | Passed; lint permits zero warnings. |
| Changed `.mjs` scripts: `node --check` | Passed. |
| `git diff --check` and manifest/lock dependency equality | Passed. |
| Documentation consistency | All 160 original ticket objects, every pre-existing top-level JSON field, and incident entries equal `HEAD`; all local evidence links resolve. |

The final suite includes the four fixture-boundary and six runner-process
regressions; they are not additional tests to add to 424. Focused frontend and
backend ESLint also passed. Overlapping backend checks passed seven suites/46
tests, five live-storage suites/45 tests, and the upload-only suite/23 tests.
The strengthened benchmark separately passed one file/one test in 11.50 s,
seeding 100, 10,000, and 100,000 rows per table and checking seven measured KPI
responses at each size.

Earlier checks are retained here as diagnostic history, not final failures. The
first sandboxed unit attempt hit child-process/network `EPERM` restrictions;
the permitted rerun passed without removing assertions. An intermediate run
passed 418 tests with the opt-in benchmark skipped, and the next passed 418
with the benchmark enabled before lifecycle regressions were added. Initial
browser attempts stopped after ten and fourteen passed cases on the two
response-inspection stalls described above; the final complete browser run
passed every case. No failed product behavior was hidden by deleting a test.

## Remaining nonblocking limits

There are no blocking test, build, or type failures. The audit found real test
and process-harness defects, with no demonstrated application behavior bug.

- Unproven maintenance, Money, and EÜR cleanup candidates remain intact until
  their supported-consumer contracts can be established. Live compatibility
  paths listed above remain covered.
- `createTestDatabase` can leave its temporary directory behind if migration
  setup throws before returning its cleanup handle. The failure path does not
  select the repository database.
- The CI build still uses `file:./dev.db` as a dummy URL. No migration/write was
  evidenced from that build; a temporary sentinel remains a possible follow-up.
- ESLint's configured source-file pattern omits `.mjs`; changed runners received
  syntax checks and process-level tests, rather than a widened lint policy.
- The two historical incidents remain documented for operator review. No new
  recovery, remote-CI run, deployment, or backlog-criterion acceptance is claimed.

All current audit changes remain uncommitted. The paired backlog summaries
record this maintenance audit without changing any of the 160 ticket states.
