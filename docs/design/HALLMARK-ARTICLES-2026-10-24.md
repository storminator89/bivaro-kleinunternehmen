# Article catalog · Hallmark / Bivaro Ledger

## Scope and preflight

Base: `56c37c0ea2126cb386f83aaf4d0e0b2cfd9675d3` (main).
Route: `/customers/articles`; owner: `app/customers/articles/page.tsx`.
Read the root `design.md`, route inventory and pinned Hallmark text reference
(`/workspace/shared/hallmark-reference-skill`, upstream `7ec868225c6caa040558c321ee0fefa0e73f83a8`).
The route inventory correctly identifies the original catalog as individual
records, not a table. No previous Hallmark catalog implementation was present.

Audience/task: existing Bivaro users finding imported articles and services.
Material: actual article names, full descriptions, exact formatted net/source
prices, units and tax rates. No imagery, invented counts or financial totals.

## Visible redesign

- One compact toolbar pairs the existing search with the existing currency note.
- Full-width article records replace the equal-width two-column card grid.
  Description leads on the left; net prices share a right-aligned rail on desktop.
- Each record retains a separate, quiet source-price and tax footer. Long names,
  descriptions and units wrap; the records remain semantic `article` elements.
- At 639px and below the same record stacks without a second mobile DOM tree.
- Loading, error and empty surfaces use the same restrained panel treatment.
  Search, import actions and back navigation have 44px minimum targets and
  immediate focus indicators. The long empty-state import label may wrap.
- Locked local Inter/evergreen/mint/emerald system inherited unchanged. CSS is a
  route-local module using existing tokens; no global token or shell changes.

## Contracts

All original visible text, routes, article IDs/keys, input attributes and handlers,
fetch lifecycle, filtering expression, and calls to `formatArticlePrice` remain.
No API, auth, persistence, finance, tax, service-billing picker, document or legal
changes. Added wrappers and classes are presentation only. The page's current
search-empty state (blank results when an existing catalog has no match) and
error recovery wording are intentionally preserved rather than adding behavior.

`lib/__tests__/article-workspace-design.test.ts` compares AST fingerprints with
the original main source for non-class JSX attributes, text, state/effect/filter
calls and price-format calls. Additional source checks protect record semantics,
responsive wrapping, focus/target styles and token-only CSS.

## Verification

Passed with Node 22.23.4:

- Focused ESLint (page and new test), `--max-warnings 0`.
- Vitest: 1 file, 2 source-only tests passed; no database/network/browser.
- `tsc --noEmit --incremental false`.
- `git diff --check`.

No full build, local functional/browser tests, new GitHub CI, push or publication
was run by this implementation task. Hallmark's reference package contains no
executables; no automated sloplint or screenshot claim is made.

Hosted acceptance remains required after coordinated publication: 320/375/768/
1440px, light/dark, populated/empty/loading/error, long descriptions/units,
keyboard search and focus, import destination, article anchors, back navigation,
and filtering. Compilation and source guards do not establish visual acceptance.
