# Sales workspaces · Hallmark redesign · 15 October 2026

Scope: the sales and document page family in the locked `design.md` system. Structure: ledger directory for records, split document workbench for editors, collection queue for reminders. Palette and type remain Bivaro Ledger / Geist. No illustration, gradients, decorative metrics or new dependencies. Existing routes and component ownership remain in place; no files deleted.

## Route audit and implementation

| Route / surface | Initial source finding | Implemented scope | Remaining verification |
| --- | --- | --- | --- |
| `/dashboard?tab=invoices` | Good desktop ledger baseline; mobile exposed only PDF/details/delete and repeated deletion caveat per row; zero amounts appeared unavailable. | Shared More menu now used on desktop and mobile for PDF/XML view/download, email, cancellation and guarded deletion. Customer name shown on mobile. True zero amounts remain visible. Scoped table typography and spacing. | Root's populated/empty/error route smoke, responsive screenshots and email/cancellation flow verification. |
| `/dashboard?tab=quotes` | Filter toolbar differed from invoice ledger; no clear filters action; initial loading rendered an empty state; mobile omitted email/download/validity. | Matching quiet filter strip with search icon and a 44px clear control; filter reset; loading feedback; truthful filtered empty state; mobile validity, email and download actions; named, minimum-height status selector; correct zero totals and pagination scope. | Root's populated status/conversion actions, empty/search states and responsive screenshots. |
| `/dashboard/invoices/new` | Existing invoice studio already had a correct split rail; repeated section kickers and one-line descriptions added friction. | Simplified section hierarchy, matching document surface rhythm, quieter template disclosure, and multiline description editing while preserving IDs and the existing export pipeline. | Existing invoice export/browser regression tests, long description, 320px form and optional preview. |
| `/dashboard/quotes/new` and quote dialog | Dense six-column line grid, a net-only “Gesamt” label, no persistent full total context and a separate bottom sticky footer. | Recipient, document, line and condition surfaces with the same hierarchy as invoice studio. Full-width labelled descriptions and 2/4-column line controls; existing duplicate/remove controls; per-line net amount; net/tax/gross summary and save controls in a desktop sticky rail; optional PDF preview; compact mobile save text with preserved accessible name. | Root's create/download/preview route checks, all viewports and financial edge cases described below. |
| `/dashboard/reminders` | Duplicated app-shell gutters, four isolated statistic cards, guidance above the actual queue, desktop-only records and collapse triggers using non-button elements. | One scoped overdue-balance strip; filter and task queues before guidance; native keyboard buttons for disclosure; actual mobile records retain reminder creation, paid action and reminder deletion/history. Visible fetch errors with retry. Existing statutory guidance text, confirmation/send steps and templates preserved. | Root's nonempty overdue/upcoming fixtures, error state, keyboard disclosure and responsive screenshots. |
| `/customers` | Separate boxed search and directory; arbitrary generated avatar colors; fetch failure silently looked empty. | Search/result count inside the directory surface, neutral token-based monograms, actual loading/error/retry states and preserved mobile contact records. Existing customer and billing-note flows retained. | Root's customer create/edit/search/notes regression suite, loading/error and narrow layouts. |

## Files changed

- `app/customers/page.tsx`
- `app/dashboard/reminders/page.tsx`
- `components/dashboard/tabs/invoices-tab.tsx`
- `components/dashboard/tabs/quotes-tab.tsx`
- `components/dashboard/create-invoice-modal.tsx`
- `components/dashboard/editors/quote-editor.tsx`
- `components/dashboard/editors/quote-page-editor.tsx` (design stamp correction)
- `components/dashboard/editors/invoice-editor-page.tsx` (design stamp correction)
- New `components/dashboard/sales-workspace.module.css`

No API, authentication, schema, persistence handlers, financial export handlers or dependencies changed. Quote displayed net/tax/gross and line amounts mirror the existing PDF/save arithmetic exactly, including fractional cases. The invoice editor retains its existing shared cents calculation. Aligning the older quote arithmetic with the shared invoice calculator would be a separate financial change and was deliberately kept out of this presentation task.

## Actual validation

- Scoped ESLint on all eight owned TSX files, `--max-warnings 0`: passed, 15 October 2026.
- `git diff --check`: passed after the first implementation pass; final repository-wide check belongs to root.
- Source-level Hallmark critique: Philosophy 5, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4. Cross-page theme consistency intentionally replaces diversification.
- Root owns build, type checking, unit/E2E tests, screenshot and contrast review, deployment and production read-only verification. This note does **not** claim those checks have passed.
- All changes currently uncommitted. No production writes or browser automation were performed by this agent.

## Root integration acceptance

Integrated and released on 15 October 2026. See [VERIFICATION-2026-10-15.md](VERIFICATION-2026-10-15.md) for actual final browser/build/unit results, live evidence, corrections and scope limits. The agent-local pending notes above are preserved as the original handoff record.
