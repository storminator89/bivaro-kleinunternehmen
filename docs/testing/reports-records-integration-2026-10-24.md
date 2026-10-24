# Hallmark reports and records: integrated candidate

## Scope and identity

Local-only integration from accepted main `eaddb1fe5a6342e0c702104ebcbce4b7ab9b4eda`
(tree `7abb4c505558da2eb94e9e3b658a30f5b75ed310`). Exact source packages:

- `a53d0c4be4be750a6233c44ed4a2309311c55e34`: EÜR/GWG report composition.
- `f508b0bdd5f406b5b01d4e6d7368f20b872dd857`: service notes/statements,
  reminder queue/preparation, document/payment history composition.

Both cherry-picked without conflicts. The existing Bivaro Ledger theme, shell,
font, shared tokens and responsive light/dark system remain locked. No APIs,
financial helpers, parent dashboard logic, hooks, Prisma/schema/migrations,
dependencies, security/hosting, routing or existing browser suites changed.
No GitHub write, PR, CI trigger, merge or deployment is part of this checkpoint.

## Integrated review and corrections

Independent source review checked the new acceptance source against the real
existing harness and application rather than executing test discovery:

- Reused the fresh-fixture-only synthetic-login IP-budget helper for all 12 new
  records/history identities, without changing production rate limiting.
- Scoped the EÜR dialog footer's Close locator to avoid the existing X-button
  duplicate accessible name. Pending export gates release in `finally`.
- Added exact named output paths, settled font/layout checks, encoded/decoded
  size bounds, actual PNG geometry and capture SHA-256 logs.
- Added post-fixture API mutation interception and before/after business-state
  comparisons. Only read requests and the existing read-only reminder preview
  POST remain allowed during the records journeys; no extra email, payment,
  reminder, invoice or billing-note mutation is permitted.
- Captured internally scrollable dialogs at explicit top/bottom positions.
  Mobile requires actual positive root scrolling; title and bottom action/link
  must be fully in the viewport and unobscured. A full-page PNG is not claimed
  to expose hidden modal content. The regular history/queue views use full-page
  captures; dialog captures are real viewport images.
- Prevented inferred fixed-table invoice-cell overlap near the reminder's
  content-width breakpoint using only flex minimum-width/shrink classes.

Static TypeScript-AST comparison retained all **313/313 critical attributes**
and unchanged non-presentation TypeScript across the five records runtime files.
Both reports retain every prior literal JSX text, id and handler, and their
non-presentation TypeScript remains unchanged, including GWG filtering, period
labels and reduction. EÜR result/private-flow
formulas and data sources remain unchanged. New monthly disclosure only repeats
the supplied monthly data. All four changed scoped CSS modules parsed.

## Hosted obligations and screenshot contract

The accepted main evidence (**4,248 unit tests, 152 functional browser cases,
155 screenshots**) is historical baseline evidence, not acceptance of this
candidate. Added source, **not executed locally**:

- **14 browser cases:** two financial report cases and three records/history
  journeys in each of four real 1440/390px light/dark configurations.
- **Four static unit cases** for the appended evidence contract.
- Expected hosted union: **4,252 unit cases / 166 functional browser cases**,
  subject to confirmation by a separately authorized hosted run.
- **44 new exact PNG names**, disjoint from all 155 accepted images:
  eight `financial-reports-{eur,gwg}-{light,dark}-{1440,390}.png`;
  twelve `records-history-{history-evidence,history-empty,reminder-queue}`
  light/dark desktop/mobile views; 24 top/bottom modal views for
  `reminder-confirmation`, `service-ledger`, `statement-selection`.
- Exact union: **199 images**, partitions **95 + 8 + 14 + 8 + 30 + 44**.

The entire accepted browser workflow prefix remains byte-identical (SHA-256
`59b555efe0c3ce2119372adcb0f845a619d3ba969439792b4beb288b236b5efe`).
The sixth optional partition has **6 MiB aggregate encoded output**, **12 MiB
aggregate input**, **1 MiB per-file input**, a six-minute staging limit and
one-day retention. Previous 20 MiB output budgets remain unchanged; combined
maximum is 26 MiB. Exact completeness, unique basenames, regular-file/no-symlink,
no-follow, path/inode/size checks and bounded two-process lossless full-pixel,
color-metadata and input/output hash proofs remain mandatory. The authoritative
45-minute job, 25-minute suite step, 20-minute global test limit, one worker,
zero retries, no-only and trace-off settings are unchanged.

The existing bank/billing static test's reader now ends at the sixth partition;
none of its existing assertions or 30-image budgets were removed or relaxed.
YAML and all six embedded Python scripts were parsed, not executed. No staging
fixture/codec test or browser test ran locally, and no screenshots are claimed.

## Checks and remaining evidence

- Passed: whole-project ESLint (`--max-warnings 0`) under Node 22.23.4.
- Passed: whole-project TypeScript (`--noEmit --incremental false`) under Node
  22.23.4; final source recheck passed, followed by the normal build type check.
- Passed: source-contract comparisons, four CSS parses, workflow prefix/exact
  disjoint image union, YAML/embedded-Python syntax and `git diff --check`.
- Passed: **one normal final `npm run build`**, including unchanged PDF.js
  prebuild and third-party-notices postbuild, under Node 22.23.4. No hook,
  provenance guard or dependency check was skipped.
- Unit, fixture, app/browser execution and result polling: **not run locally**.
  The prior local-test auto-review denial remains in force and was not retried.
- Hosted checks, actual screenshots, lossless-artifact delivery, pixel review,
  financial real-flow regression and interrupted/repeated journeys: pending
  separately authorized publication and execution. The new source is not a
  claim that these gates passed.

Only reproducible completed temporary build caches were reclaimed with parent
permission. A complete private dependency copy retained exact PDF.js source and
adapted-worker hashes and single-link asset guards; no installation, shared
package mutation, Prisma regeneration or integrity-check bypass was used.
