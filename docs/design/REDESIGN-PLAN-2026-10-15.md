# Hallmark redesign · 15 October 2026

## Objective and boundaries

A coherent, modern, restrained SaaS accounting workspace on every route. Keep Bivaro Ledger tokens, Geist product typography, Newsreader marketing typography and the existing route/component ownership. Improve structure and daily interactions without changing financial calculations, authentication, access rights, data contracts or database schema. No production data as test fixtures. No production file deletion. Current baseline: 4b293ff, clean working tree.

## Initial page inventory and source audit

| Route | Purpose | Design work package |
| --- | --- | --- |
| / | Product introduction | Restrained product story, legible display scale, actual product imagery, concise task links |
| /login | Authentication | Compact focused form, quiet secondary panel, accessible feedback |
| /register | Initial setup / registration | Consistent form hierarchy and setup states; preserve bootstrap and access rules |
| /dashboard | Overview | Clear period scope, useful annual analysis, actionable booking feed, reduced visual clutter |
| /dashboard?tab=invoices | Invoice list | Clear status/filter/results hierarchy and mobile records |
| /dashboard?tab=quotes | Quote list | Same record-list language; clear conversion actions |
| /dashboard?tab=incomes | Income book | Cohesive filter strip and entry/list states |
| /dashboard?tab=expenses | Expense book | Calm entry flow, document context and categorization |
| /dashboard?tab=eur | EÜR analysis | Featured result, period scope and structured category breakdown |
| /dashboard?tab=gwg | Asset register | Clear totals, asset records and depreciation context |
| /dashboard/invoices/new | Invoice editor | Refine document workspace, line controls, total rail and optional preview |
| /dashboard/quotes/new | Quote editor | Match invoice editor hierarchy while retaining quote-specific flow |
| /dashboard/reminders | Collections | Prioritize overdue balance and next actions; retain explicit send/history steps |
| /customers | Customer directory | Search and contact context, responsive records, clear notes workflow |
| /cashbook | Cash management | Distinct cash balance, responsive journal, daily overview and cash count |
| /steuer-simulation | Tax scenarios | Consistent source/assumption/result hierarchy, accessible disclosure and mobile result |
| /settings | Company / administrative settings | Navigable sections, concise explanations, safe backup/restore states |
| /users | User administration | Clear role/status records and admin actions; no expanded permissions |
| /settings/api-keys | API access management | Key inventory and scoped creation flow, preserve secret handling |
| /settings/api-keys/docs | API documentation | Readable long document, useful code navigation and keyboard copy controls |
| /settings/audit-logs | Audit trail | Compact filters, readable event records, clear pagination and empty states |
| /settings/documentation | Procedure documentation | Structured document workflow and version context, retain legal wording and export flows |

This is a source-based initial audit. Browser and responsive evidence are recorded separately after implementation; no page is considered visually verified merely by source inspection.

## File ownership and sequence

- Root: tokens.css, app/globals.css (append-only), components/app-shell.tsx, components/navigation/nav-links.tsx, components/dashboard/dashboard-content.tsx, dashboard-client.tsx, dashboard-header.tsx, year-comparison.tsx, dashboard-activity-feed.tsx, tabs/incomes-tab.tsx, expenses-tab.tsx, eur-tab.tsx, gwg-tab.tsx; shared design components, test coverage, design.md and .hallmark memory.
- Sales agent: app/customers/page.tsx, app/dashboard/reminders/page.tsx, components/dashboard/tabs/invoices-tab.tsx, quotes-tab.tsx, create-invoice-modal.tsx, editors/quote-editor.tsx, editors/quote-page-editor.tsx, editors/invoice-editor-page.tsx; sales-specific CSS module.
- Admin agent: app/settings/**/page.tsx, app/settings/page.tsx, app/users/page.tsx, components/settings/section-navigation.tsx and admin-specific CSS module.
- Public/accounting agent: app/page.tsx, app/login/page.tsx, app/register/page.tsx, app/cashbook/page.tsx, app/steuer-simulation/page.tsx and its private presentation components; dedicated CSS module.
- Each agent writes a per-route implementation note in docs/design. Agents do not edit root styles/tokens or shared primitives. No files are deleted.

## Validation

1. Compile and lint with zero warnings. Run existing unit tests appropriate to touched paths.
2. Existing isolated end-to-end suite plus every-route smoke, empty/populated states, keyboard-accessible navigation and responsive checks at 320 / 375 / 414 / 768 / 1440 px.
3. Inspect representative screenshots of all page families, light/dark and narrow mobile. Fix visual defects before release.
4. Deploy only after tests/build pass, preserving a consistent database/upload backup and previous image. Verify container health and unchanged stored data.

## Status

Implemented by three delegated agents and integrated by root. Released as `bivaro:hallmark-20261015` on 15 October 2026. Verification is recorded in [VERIFICATION-2026-10-15.md](VERIFICATION-2026-10-15.md). All listed route families are implemented; no schema migration.
