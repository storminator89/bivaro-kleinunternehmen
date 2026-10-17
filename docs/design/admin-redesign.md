# Administration redesign · 15 October 2026

## Scope and design decision

Hallmark multi-page redesign using the locked `design.md`: modern-minimal Bivaro Ledger, Workbench administrative forms/lists and Long Document reference pages. Geist product typography, evergreen actions/navigation, cool neutral data surfaces. No decorative enrichment or added motion. Files are edited in place, with a private administrative CSS module and code example/copy presentation helpers. No routes or production files removed.

## Per-route audit and implementation

| Route | Source audit | Implemented scope | Verification |
| --- | --- | --- | --- |
| `/settings` | Existing section anchors omitted registration and audit destinations; one ungrouped company form, repeated card paragraphs, logo row and destination actions could squeeze mobile content. | Compact header; persistent desktop navigation / native mobile section picker covering every section; semantic contact, bank, and document fieldsets; responsive logo row; registration toggle spacing; API/audit/procedure destinations condensed into task rows; named logo removal control. | Scoped ESLint zero warnings; source/diff review. Responsive/browser evidence pending root suite. |
| `/users` | Plain wide directory with unnamed edit control and hard-coded violet/blue role pills. | Identity-led records with initials and explicit “Ihr Zugang”; actual registered count; theme role states; labeled mobile records and named edit control. Add/edit/deactivation dialogs retained with narrow viewport bounds. | Scoped ESLint zero warnings; source/diff review. Admin API/deactivation protections unchanged. Browser evidence pending root suite. |
| `/settings/api-keys` | Nested page gutters, oversized icon title, decorative blue instructions, seven-column table and unnamed secret actions. Clipboard success was announced before the write completed. | Compact action header, actual total and usable key counts, quiet authentication reference, responsive labeled records, wrapping Origin input/control row and badges; named key activation/deletion, secret visibility/copy and Origin removal; asynchronous honest copy feedback and LAN HTTP copy fallback. Dialogs remain constrained to viewport. | Scoped ESLint zero warnings; source/diff review. Secret only-once/reveal/revoke/create flows preserved. Browser evidence pending root suite. |
| `/settings/api-keys/docs` | A very long stack of cards without in-page navigation, nested gutters and oversized icon header; copy actions only shown on pointer hover and unnamed. Nested component remounted after copying and lost keyboard focus. | Long Document with sticky desktop TOC and wrapping mobile links, anchored sections and token-based code surfaces; stable extracted code-example component with permanently visible keyboard-operable copy action, local announced feedback, focus preservation, and LAN HTTP fallback. Endpoint descriptions wrap. Original technical content retained. | Scoped ESLint zero warnings; source/diff review. Existing code payloads and endpoint data unchanged. Browser evidence pending root suite. |
| `/settings/audit-logs` | Nested gutters, oversized icon header, bulky filters and six-column event table; reset/details controls unnamed. | Compact task header, grouped filter strip, named reset/details controls, readable mobile event records with all values retained, flexible pagination and small-screen detail metadata. Existing query pagination, filter semantics and details preserved. | Scoped ESLint zero warnings; source/diff review. Browser evidence pending root suite. |
| `/settings/documentation` | Nested narrow document gutter, oversized icon heading, stacked cards with no document navigation; long editable sections had no explicit accessible field names. | Long Document workspace with anchored company/system/section TOC, anchor navigation opens a collapsed section, preserved version/save status, native keyboard section disclosure, labeled section editors and calmer generated document text. Print/PDF flow retained. | Scoped ESLint zero warnings; source/diff review. Legal/system-generated wording and sanitization untouched. Browser/print evidence pending root suite. |

## Security and data boundaries

- No API handlers, authentication, authorization, hashing, audit recording, backup/restore handlers, database schema, or deployment configuration changed.
- Existing registration visibility, administrator role gate, self-deactivation/disabled account protections, and secret one-time output/reveal semantics retained.
- No production access, browser use, database experiments or data mutations performed by this agent.
- Copy helpers only run after an explicit user click. They do not log/store values; temporary offscreen copy controls are removed in `finally`, and keyboard focus returns to the initiating control.

## Local verification actually completed

- `npx eslint app/settings/page.tsx app/settings/audit-logs/page.tsx app/settings/documentation/page.tsx app/settings/api-keys/page.tsx app/settings/api-keys/docs/page.tsx app/users/page.tsx components/settings/section-navigation.tsx components/settings/code-example.tsx components/settings/copy-admin-text.ts --max-warnings 0` — passed, zero warnings.
- `git diff --check -- app/settings app/users/page.tsx components/settings` — passed.
- Full build/unit/E2E/visual checks delegated to root to avoid concurrent build jobs. Browser screenshots, all five breakpoints, dark mode, real session, print preview and deployment are not claimed here.

## Hallmark critique

Source-based pre-handoff critique: Philosophy 5, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4. App consistency intentionally takes precedence over theme diversification. Interaction states reuse shared primitives and local focus rings; new components add no animation. Full visual acceptance awaits screenshot inspection.

State: implemented, uncommitted; root integration and release verification pending.

## Root integration acceptance

Integrated and released on 15 October 2026. See [VERIFICATION-2026-10-15.md](VERIFICATION-2026-10-15.md) for actual final browser/build/unit results, live evidence, corrections and scope limits. The agent-local pending notes above are preserved as the original handoff record.
