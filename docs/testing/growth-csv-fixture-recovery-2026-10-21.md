# PR80 CSV browser-fixture scoping recovery — 2026-10-21

## Observed hosted result

On reviewed focus successor `8f5458834963bd6d6e2d0ad1f196ba764bf271e2` (tree `317b03da59bb19ec0d505358685de7671de47c01`), full CI passed: **1,548 tests**, two existing skips, lint/types, security and production build. Browser run `39582321701`, job `119162653376`, executed all **65 cases: 63 passed, 2 failed**. The unchanged desktop payment Escape/focus assertion passed, as did the new quote journey.

Both failures were strict-locator ambiguity in the new CSV fixtures: a global alert locator also matched Next's route announcer, and a global saved-net-price label matched both legitimate priced and zero-price article rows. The run produced only 21 of 23 required PNGs because the two CSV flows stopped before their captures. This is not complete browser or visual acceptance. Raw evidence: `/workspace/shared/growth-publication/job-119162653376.log`.

## Test-only correction and one-pass selector audit

No production code changes. Scope errors and confirmation checkboxes to the wizard container identified by its named `Importschritte` list, leaving the unrelated global route announcer alone. Identify preview rows by the named preview region and exact line/name summary, rather than DOM order or a global repeated field label.

Keep all original assertions and synthetic data: read-only preview database counts, exact gross-to-net result, leading-zero postcode, cancellation, mapping, reload, lost-response retry/idempotency, explicit confirmation, exact import counts, unchanged unknown fiscal profile, no invoice/income writes, backup coverage and reuse in both invoice and quote editors. Check the other article rows too: the unknown price remains invalid with no saved-net field, whereas an explicit zero remains importable with an exact zero net price. The final customer-list assertion targets its semantic heading instead of responsive duplicate text. A scan of the rest of this new fixture found no remaining global alert, unscoped repeated price-label or order-based preview-row selector.

No browser cases, screenshot names, assertions, retry settings, production behavior or schema capabilities were removed or relaxed. The exact PNG union remains **23** and the staging limits remain **5 MiB / one day**. Historical backlog documents remain untouched.

## Focused verification

- **79 tests / 4 files passed**: existing CSV parsing, customer contract, service article and atomic data-import coverage.
- ESLint on the changed browser fixture passed with zero warnings; `git diff --check` passed.
- Supported runner discovery: **65 tests / 14 files**. Discovery is not browser execution.

Raw logs and SHA-256:

- `/tmp/growth-csv-fixture-recovery-focused.log`: `68c4b8f3c3c701397eaef4111cab387148bccff3363bc5813367a585d9661f34`
- `/tmp/growth-csv-fixture-recovery-lint.log`: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `/tmp/growth-csv-fixture-recovery-discovery.log`: `d26023be6b1cc546066dbde28196a7562e2da63e5ae1022256f7a3e85d9f505e`

No local full native build/type/browser run was started under the resource restriction. Independent review must clear this exact test-only successor before amendment. Fresh full hosted CI, all 65 real browser cases and integrity verification plus inspection of all 23 PNGs remain required. No merge/release acceptance is claimed.
