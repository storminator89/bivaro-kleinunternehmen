# Quote workspace redesign

## Direction

Full recomposition of the existing offer worklist at `/dashboard?tab=quotes`, within the locked Bivaro Ledger system. Inter, evergreen/mint, emerald primary action, shared spacing and 44px controls remain unchanged. The shell's page heading and “Angebot erstellen” action remain the entry point; no duplicate page header or new primary action was added.

The retained desktop and mobile quote-workflow screenshots were inspected before editing. The old worklist gave substantial space to a padded filter block and an oversized actions column. They remain historical before evidence, not proof of the final code's appearance.

## Changed

- The three existing next-step filters now form one continuous task strip in the worklist, rather than detached pills. They use the existing counts, conditions and callbacks only.
- Search leads the compact toolbar; the existing status filter remains labelled and available.
- A six-column desktop ledger separates dates, offer identity, customer, amount and status from the workflow/action continuation below each record. Long identities can wrap instead of forcing the table wider.
- Mobile records expose labelled dates, customer, amount, status and workflow, with document actions grouped below. No record information or action is desktop-only.
- Status uses a semantic icon alongside its existing text. Reduced motion stops the loader animation; keyboard focus remains immediate.
- The total stays explicitly labelled “Summe dieser Seite”. No pipeline, financial calculation, metric, sort or feature was invented.

Only the quote tab, its own CSS module, a source-only regression guard and this note are part of the package. Shared layout, financial services, APIs, data hooks, schema and invoice/customer/settings components are untouched.

## Kept

The source inventory retains all 49 original protected handler, ID, type, destination and focus-return attributes. Quote types, component props, status options/labels, conversion and deletion handlers remain unchanged. Both conversion-block and next-action calls remain present in both responsive layouts. The two confirmation descriptions remain verbatim.

The existing workflow dialog, email preview and return-focus ownership, file URLs, linked invoice route, status updates, conversion gates, pagination, page sizes, filter reset and empty/error retry paths are preserved. The table's duplicate result caption remains available to assistive technology; the visible count remains in the list heading. Pagination facts are separate text runs rather than a dot-joined metadata string.

## Verification

- Static TypeScript parsing: passed for the tab and source-contract test.
- Protected source inventory: 49/49 retained; no removed protected attributes.
- Conversion/deletion logic and confirmation descriptions: unchanged against the baseline.
- Full ESLint with zero warnings: passed.
- Focused source/component/workflow unit checks: 74/74 passed across five files, using installed tools on Node 22. No browser, app server or database was started.
- Production build, deterministic notice generation and separate no-emit TypeScript check: passed on Node 22. The build reported nine filesystem-tracing warnings in unchanged validation/upload modules; no quote-code warning was reported.
- Independent source review identified two narrow-width risks: the workflow strip now switches to three columns only at 1280px, and phone amounts stack beneath the identity with a breakable long-value fallback. These corrections still need rendered confirmation.
- No local browser, native/PDF/JVM verification or new GitHub CI run was started.
- No new final screenshots exist yet. No rendered Hallmark pass or visual acceptance is claimed. The reference-only Hallmark material was read; its scripts/hooks were not executed.

## Remaining hosted acceptance

Capture the full worklist in light/dark at phone, tablet and desktop widths, including 320px, long record identifiers/customer names and large amounts. Check field/label readability, table columns, continuation alignment, no horizontal page overflow, keyboard focus and the responsive breakpoint.

Exercise the existing workflow filters and URL restoration, search/clear/reset, page sizes and pagination, manual status/follow-up responses, linked invoice navigation, permitted and blocked conversion states, email-preview close/return focus, view/download, delete confirmation/cancel, and loading/empty/error retry. Conversion must still create nothing until the existing editor is saved; no payment, income or automatic sending may occur.

This package is local only. Publication and hosted visual/functional acceptance remain separate steps.
