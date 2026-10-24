# Hallmark: records, reminders and history

## Outcome and boundary

Source implementation is reviewable, not published or browser-approved. It starts
from accepted `main` commit `eaddb1fe5a6342e0c702104ebcbce4b7ab9b4eda`
(tree `7abb4c505558da2eb94e9e3b658a30f5b75ed310`).

- **Redesign:** full app-screen composition inside the existing shell.
- **Theme:** locked Bivaro Ledger / Design System 2.0, read from `design.md` and
  `tokens.css`; no palette, font, navigation or global token changes.
- **Screens:** `/dashboard/reminders`, `/history` (list and detail), customer
  Leistungsnotizen and nested Leistungsaufstellung dialogs on `/customers`.
- **Keeps:** business logic, calculations, permission/eligibility gates,
  idempotency, pending/retry guards, links, field identities and evidence wording.
- **Files:** five existing runtime TSX files, one existing scoped stylesheet,
  two new scoped stylesheets; no route or component deletion.
- **Signature:** an actionable collection queue; separate document/payment
  evidence and a chronological app-event ledger; date-led customer service notes.
- **Sweep:** source-only review. Hallmark's reference archive has no executable
  scripts. No static Hallmark gate count or rendered sweep pass is asserted.

## Before and after

| Surface | Before, source observation | Composition now |
| --- | --- | --- |
| Reminders | Detached notice and card-header filter; generic queue containers; desktop switching based on viewport alone | Notice in the existing page header, one stage-filter toolbar, direct queue surface, shape-matched loading rows, actual-content-width desktop table and independent mobile records |
| Reminder preparation | Repeated bordered boxes around preview evidence | Dedicated header/body, balanced financial row, separate proof list, readable draft surface and explicit confirmation; footer actions grow when labels wrap |
| History | Full-width document/payment/event panels in one undifferentiated stack | Paired document and payment evidence regions on wide screens, separated evidence warning and app-event timeline; filters and search remain URL-driven |
| Service notes | Numbered step labels and stacked notes | Quiet capture rail, date-led note ledger, independent status/quantity content and preserved per-note action |
| Service statement | Narrow selection dialog and generic action rows | Wider explicit-selection surface, visible selection count, dedicated filter/action regions and preserved approved-description preview |

No invented metrics, decorative imagery, new financial action, new backend call,
new storage or automatic delivery was added. All displayed totals use the same
existing variables and formatting expressions.

## Copy inventory

Only the decorative step labels `01 / Erfassen`, `02 / Prüfen` and
`03 / Abrechnen` were removed (Hallmark gate 54). The existing headings
`Neue Leistung`, `Leistungsverlauf` and the invoice-editor link remain.
`Nur interne Erfassung · Kein automatischer E-Mail-Versand.` and
`App-Protokolle · Verlauf kann Lücken enthalten.` moved into their existing page
headers without rewording. `Mahnwesen wird geladen …` is a new screen-reader
loading label. Financial, tax, consent and evidence qualifications are unchanged.

## Preserved contracts and source evidence

A read-only TypeScript AST inventory compared the edited runtime files against
accepted main. It compared `on*`, `id`, `name`, `type`, `key`, `href`,
`data-testid`, `disabled`, `checked`, `value`, `defaultValue`, `required`,
`min`, `max`, `step` and `maxLength` attributes, ignoring whitespace only.

| Runtime file | Critical attributes before / after | Missing / changed |
| --- | ---: | ---: |
| `app/dashboard/reminders/page.tsx` | 35 / 35 | 0 |
| `components/dashboard/reminder-workbench-dialog.tsx` | 35 / 35 | 0 |
| `components/history/invoice-history-workspace.tsx` | 56 / 56 | 0 |
| `components/customers/service-workbench.tsx` | 131 / 131 | 0 |
| `components/customers/service-statement.tsx` | 56 / 56 | 0 |
| **Total** | **313 / 313** | **0** |

A separate AST source inspection replaced JSX trees with a presentation marker,
removed imports and the presentation-only `control` class declaration, then
compared printed TypeScript. Non-presentation TypeScript was unchanged in all
five files. This is source comparison, not runtime or browser verification.

Notably preserved:

- Reminder server-derived eligibility; fresh balance/version check; confirmation
  invalidation after edits; idempotency key; disabled busy actions; cancel guard;
  zero-payment-only manual mail-client composition; internal-only recording.
- History abort-on-navigation and signed-in data gating; account-scoped key;
  no-store requests and payment contract header; query parameters and pagination;
  missing-original, missing-proof, review-required and partial-history caveats.
- Service notes' mutation mutex and request ordering; uncertain-capture recovery;
  close/unload warning; focus return to a visible customer-specific opener;
  archived-project rules; linked-note delete suppression; exact duration math.
- Statement explicit selection and description approval; maximum selection size;
  date checks; in-flight guard; abort/object-URL cleanup; same PDF preview/download.

## Independent source review

A separate reader found no handler, guard, financial calculation or evidence-copy
regression. Source findings addressed: reminder switching now uses actual content
width; the fixed-layout table permits wrapped action groups; dialog headers reserve
close-target clearance; multiline reminder buttons use automatic height and a
44px minimum. None of this substitutes for visual or interaction acceptance.

## Verification

- Passed: focused ESLint with `--max-warnings 0` across the five runtime TSX files
  and the authored browser-acceptance source, Node **22.23.4**.
- Passed: whole-project `tsc --noEmit --incremental false`, Node **22.23.4**.
- Passed: `git diff --check`; read-only source comparisons above.
- A first type check also passed under the workspace's default Node 24.19.0;
  the supported Node 22.23.4 result is the relevant recorded check.
- **Not run:** local unit/fixture tests, local app server, local browser tests,
  Hallmark rendered sweep, GitHub CI, publication, deployment or merge.
- **Pending:** the parent's one combined integration build and authorized hosted
  acceptance at 1440/390px in light/dark, including interrupted/repeated flows.

The acceptance spec follows the existing isolated GitHub browser harness and is
source-only; it adds no CI workflow or execution trigger.

Acceptance details: [records-history-redesign-2026-10-24.md](../testing/records-history-redesign-2026-10-24.md).
