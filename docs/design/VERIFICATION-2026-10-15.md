# Redesign verification · 15 October 2026

## Delivered

Three subagents implemented the sales, administration and public/accounting page families. Root integrated the shared presentation, dashboard, bookkeeping and reports. All 22 routes/views in the plan were audited and exercised. Changes remain uncommitted on baseline `4b293ff`.

- Unified in-place Bivaro Ledger presentation; existing navigation, font and color system retained.
- Matching invoice/quote studios, multiline positions, responsive customer and collection records, full mobile document actions.
- Grouped settings, complete section navigation, mobile user/key/audit records and readable anchored documentation.
- Focused public/auth pages, cash-balance workspace, tax assumption context, and profit-led EÜR with category distribution.
- Dashboard placeholder comparisons replaced with truthful period explanations and links.
- UI regression fixes: invoice number validation is pending throughout its debounce, so a late duplicate check cannot disable a lost-response retry; quote PDF wrapping preserves multiline descriptions. Quote display arithmetic matches existing PDF/save arithmetic.

## Actual checks

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, zero warnings |
| `npm run test -- --maxWorkers=2` | 52 files passed, one skipped; 376 tests passed, one skipped |
| Production build and typecheck | Passed in isolated E2E release and production Docker build |
| `npm run test:e2e` | 16 passed, final run 43.2 seconds |
| Every-route smoke | 20 authenticated/public product views plus anonymous login/register; all 22 at 320, 375, 414, 768, 1440 px |
| Workflows | Registration/login, invoices, PDF/A-3/Factur-X, XRechnung, quote PDF creation with displayed amount and multiline description, paid-invoice protection, backup validation, dates/timezones, cash overdraft, user deactivation, tax/EÜR export, billing notes, lost-response retry, password/session revocation |
| Browser runtime / navigation | No page exceptions in all-route test; mobile menu closes after navigation; light/dark checked |
| Contrast | Fourteen core text/surface pairs calculated from canonical light/dark OKLCH tokens; all at least 4.5:1, details in contrast-2026-10-15.json |
| Source whitespace | `git diff --check` passed |
| Real server session | All 20 authenticated/public product views re-opened after deploy; no root horizontal overflow at desktop. Quote editor also checked at 375px. No production forms submitted. |

Tests used newly created temporary fixture directories with explicit database targets. No test used repository dev.db or production data. The final release harness used a private node_modules copy because Turbopack disallows a node_modules symlink outside its root. An old local dev CSS cache was moved aside and the preview restarted before visual acceptance; production CSS was compiled fresh.

The initial run correctly failed after the mobile deletion action moved into the More menu. The test now opens that menu and still verifies the disabled deletion control and explanation; the financial protection is unchanged. The added quote test detected and then verified the multiline PDF fix. Final tests include both corrections.

## Deployment and data evidence

- URL: http://192.168.0.126:7689/dashboard
- Image: `bivaro:hallmark-20261015`
- Image digest: `sha256:58a3a4773a450a3955bab92ec9e3de82a124988b2deb243948955d4e824bb08d`
- Source: `/opt/bivaro-hallmark-20261015`
- Consistent stopped-container backup: `/opt/bivaro-backups/20261015-hallmark` (private permissions), preserving Compose, environment, SQLite data and uploaded originals.
- Previous image retained as `bivaro:pre-hallmark-20261015`; failure trap restores previous Compose/image.
- Compose validated with `config --quiet`.
- Container healthy; SQLite integrity OK.
- All stored contents, not merely counts, in all 21 tables match the consistent pre-deploy backup after live review. Upload archive comparison also passed.
- No database schema/API/auth/security contract changes. No invoice, quote, reminder or user created on production during QA.

## Evidence and limits

97 test screenshots and final browser test log retained in the chat visualization directory under `hallmark-20261015/test-evidence`; before/after live captures and `live-route-audit.json` sit beside it. Synthetic populated records are explicitly marked Designfixture. Live screenshots use the user's own session.

The existing health API occasionally reports `degraded` when its current V8 heap allocation is highly occupied; database remains up and container health remains healthy. The observed Docker usage after the complete route walk was 102.9 MiB of a 16 GiB limit (0.63%). This existing heap heuristic was not changed in a design task.

Print styles and role/secret-handling contracts were retained and source-reviewed. A full print/PDF layout audit of procedure documentation and an exhaustive accessibility/security audit were not part of this UI verification.

Hallmark critique after integration: Philosophy 5, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4. Theme consistency follows the locked design system. No invented product claims or decorative generated assets introduced.
