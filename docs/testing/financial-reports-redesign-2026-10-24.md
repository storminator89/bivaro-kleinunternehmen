# EÜR and GWG report redesign · 24 October 2026

## Scope and status

Base: `eaddb1fe5a6342e0c702104ebcbce4b7ab9b4eda` (`main`).
Implementation is a local, report-only Hallmark redesign. Not published, pushed,
merged or deployed. Hosted functional and visual acceptance is **pending**.
The historical green main baseline (4,248 tests / 152 browser tests) is not
verification of this change.

Reviewed report routes before choosing the package:

| Route | Existing composition | Decision |
| --- | --- | --- |
| `/cashbook` | Current balance, journal, day close and cash count | Leave unchanged |
| `/steuer-simulation` | Assumptions and live result with source limits | Leave unchanged |
| `/handoff` | Period, bounded preview, warning/fingerprint review, manual acknowledgement | Leave unchanged |
| `/dashboard?tab=eur` | Detached result, charts and repeated breakdown surfaces | Recompose |
| `/dashboard?tab=gwg` | Summary and register in separate repeated containers | Recompose |

The existing Bivaro Ledger / Design System 2.0 is locked. No shared tokens,
fonts, navigation, dependencies, database, backend, security settings or README
changes are included.

## Hallmark decisions

- **Audience/job:** a small-business user checking an existing report before
  exporting it; no marketing hero or invented proof.
- **EÜR:** one statement surface joins the provisional result, total income,
  total expenses and the detailed categories. Supporting monthly cashflow and
  category analysis follow it. Private movements and AfA remain separate with
  every existing qualification.
- **GWG:** one register joins period, entry count, net sum and the acquisition
  list. Desktop uses quiet tables; phones retain description, date, amount and
  category without hiding essential record data.
- **Material:** only existing props and original report data. Inline icons stay
  at 32px in section headings; decorative summary/empty-state icons are removed.
- **Interaction:** existing export callbacks and working-paper dialog remain.
  The existing monthly values also have an optional labelled disclosure for
  non-visual/chart access. No new query, route or financial calculation.
- **Copy:** existing visible facts and fiscal/legal caveats retained verbatim;
  only the accessible disclosure label “Monatswerte anzeigen” is added.

No local app, browser, unit or fixture test was run. The reference-only Hallmark
package has no `scripts/sloplint.mjs`; no automated gate count, screenshot or
rendered finish-review pass is claimed.

## Source-contract evidence

Static comparison against the base found:

- All six original ids retained: `income-breakdown-mobile`,
  `expense-breakdown-mobile`, `private-flows-heading`, `afa-heading`,
  `gwg-summary`, `gwg-list-heading`.
- Static TypeScript-AST inspection found no missing prior JSX text in either
  report. New text is only the monthly disclosure label and the already-known
  income/expense column labels repeated there.
- All three original click callbacks retained: EÜR `onExport`, EÜR
  `setShowElsterDialog(true)`, GWG `onExport`; existing dialog `onClose` retained.
- GWG filtering, boundaries `> 250` / `<= 1000`, date filtering, reduction and
  `getPeriodLabel` are byte-for-byte unchanged.
- EÜR props, `privateDeposits - privateWithdrawals`, all `formatCurrency` calls,
  category proportions, AfA values, remaining-period caveat and dialog props
  retain their data sources and formulas.
- Parent `dashboard-content.tsx`, `use-dashboard-data.ts`, export helpers and
  all API files are untouched. Fresh-summary export/retry, stale result hiding,
  date/tenant permissions and original file provenance are not moved or bypassed.
- Monthly disclosure uses the year-qualified `fullName` as its row key. The
  read-only source reviewer caught this before handoff; AfA header spacing and
  an inset disclosure focus ring were also corrected. No rendering was run.

## Checks actually performed

| Check | Result |
| --- | --- |
| Node | `v22.23.4` |
| `tsc --noEmit --incremental false` | Passed |
| ESLint, changed TSX and new browser-test source, `--max-warnings 0` | Passed |
| Existing PostCSS parse of report CSS module | Passed, 90 top-level nodes |
| `git diff --check` | Passed |
| Financial source/ids/callback inspection | Preserved as listed above |
| Full normal build | Parent-coordinated combined stage pending; not run here |
| Unit / fixture / browser execution | Not run; blocked for this local workspace |
| New CI, push, PR, merge, deployment | Not performed |

An initial CSS-parser lookup under `next/node_modules/postcss` failed with
`MODULE_NOT_FOUND`; the already-installed root `postcss` was then used. No
installation or dependency change occurred.

## Hosted acceptance source and remaining evidence

`e2e/financial-reports-redesign.spec.ts` adds **two unrun** acceptance cases.
They create only a synthetic isolated-fixture identity, intercept financial
reads and block every non-read business API request. They do not prove actual
financial calculations; the existing complete suite, including
`e2e/eur-2026.spec.ts`, remains required.

Pending acceptance:

1. Existing 152 browser tests plus the two new report cases and any separately
   integrated sibling cases. Existing unit/fixture suites remain unrun here.
2. Full-page evidence at **1440 and 390 px, light and dark**, eight report PNGs:
   `financial-reports-{eur,gwg}-{light,dark}-{1440,390}.png`.
3. Geometry/readability at 320, 375, 390, 768, 1024, 1280 and 1440 px;
   long descriptions/categories, large euro values, tabular comparisons, all
   AfA columns, unchanged legal caveats and complete non-scrolling rows.
4. EÜR: monthly disclosure keyboard/repeat activation; working-paper failure,
   Close/reopen/Escape and focus return; repeated fresh CSV downloads; pending
   export followed by navigation must not produce another download; period
   changes; missing/empty/error/retry states.
5. GWG: keyboard export/focus ring, exact CSV amount, year selection,
   Back/Forward between report routes, empty/error/recovery states and no
   financial writes. Real filter/calculation/permission behavior stays covered
   by the existing suite, not by intercepted presentation fixtures.
6. Visually inspect every screenshot and record exact commit, hosted job/run,
   completed test totals and any failures. Source-level confidence is not a
   substitute for this evidence or permission to publish.
