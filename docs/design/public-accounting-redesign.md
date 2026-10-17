# Public and accounting workspace redesign · 15 October 2026

Scope: five existing routes, two private CSS modules. In-place presentation changes only; no files deleted, no dependencies, API, database, tax rules or authentication contracts changed. Design follows the existing Bivaro Ledger system in `design.md`.

## Source audit and implemented scope

| Route | Observed problem | Implemented change | Contracts retained |
| --- | --- | --- | --- |
| `/` | Oversized headline, long repeated editorial sections and dense screenshot alongside copy made the product story harder to scan. | Compact split introduction and clear account action; wider real screenshot beneath the introduction; three task-oriented product rows; concise closing action. No invented metrics, endorsements or product claims. | Existing authenticated dashboard action; anonymous registration/login actions; real repository product screenshot; actual feature descriptions. |
| `/login` | Decorative icon tile competed with form heading. Password visibility control was excluded from keyboard navigation. | Focused form with one visible page heading on every viewport, restrained supporting workflow on desktop, clearer control spacing, 44px keyboard-accessible password visibility control. | Existing credentials sign-in, error messages, autocomplete, Caps Lock warning, registration feedback and redirect. |
| `/register` | First-use, unavailable and active registration states had different hierarchy; no visible mobile page heading; incorrect six-character password placeholder. | Consistent form treatment, visible semantic page heading in enabled/disabled branches and named loading heading, policy-neutral password placeholder, keyboard-accessible password controls. | Bootstrap proof, one-use bootstrap state, role assignment, registration status endpoint, password-policy validation, password matching and all submission logic unchanged. |
| `/cashbook` | Four equal summary cards obscured the cash balance. Daily figures were labelled “today” even after selecting another date. Eight-column journal lacked a useful mobile presentation. Cash count form used too much horizontal space on desktop. | Prominent real current cash balance with active-cash selector and transaction/initial-balance context; explicitly dated daily movement panel and shortcut; responsive journal records with real amounts, running balance, category/receipt and existing edit/delete actions; flatter daily metrics; desktop split cash-count workspace; visible load errors and named icon actions. | Existing fetches, server transactions, all amounts and ordering, tax relevance, pagination, export, cash-count persistence, edit/delete dialogs, negative-balance guards and role checks unchanged. Only the date label now accurately describes the existing data. |
| `/steuer-simulation` | Large form had weak distinction between insurance assumptions and tax switches; result lacked immediate assumption context; source and result navigation was indirect. | Direct source/assumption/result anchor navigation with EÜR link; distinct activity, insurance and tax/surcharge groups; active business/employment/deduction assumptions beside the result; quieter recommendations; 44px help targets with keyboard-focusable social-insurance help and delayed hover tooltips. | All tax calculations, default values, year/range support, source warnings, legal limitations, unsupported-state handling, reset, live result and recommendation logic unchanged. |

## Accessibility and restraint review

- Existing typography, semantic color/spacing tokens, primary action voice and single outer page container retained.
- Scoped modules use `--bivaro-color-muted` and `--bivaro-color-accent`, avoiding Tailwind/shadcn alias collisions.
- No decorative gradients, icon tiles, fabricated charts or stats, new animation or stacked card grids.
- Native buttons/links have visible focus treatment; existing shared primitives retain loading/disabled/error states. New mobile actions reuse the existing dialogs and handlers.
- All five page families have meaningful native page headings; auth marketing story uses h2 so it does not replace the mobile h1.
- Reduced-motion rules suppress spatial animation within these scoped workspaces.
- Hallmark source review: Philosophy 4, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4. App consistency overrides per-page theme rotation.

## Actual verification and remaining evidence

- `npx eslint app/page.tsx app/login/page.tsx app/register/page.tsx app/cashbook/page.tsx app/steuer-simulation/page.tsx --max-warnings 0` passed with zero warnings.
- `git diff --check` for the five owned page files passed.
- No database probes or production mutations performed by this agent.
- Full build/typecheck, financial regression tests, isolated E2E flows, all-route rendering, responsive screenshots at 320/375/414/768/1440px, dark-mode contrast and authenticated live verification remain with the parent agent. Source inspection does not count as visual verification.
- In particular verify cashbook journal actions at both mobile and desktop, date changes in daily summary, cash-count result layout, bootstrap-closed registration heading, tooltip focus and expanded tax calculation at 320px.

State: implemented and uncommitted; integration/visual verification pending. No release claim made.

## Root integration acceptance

Integrated and released on 15 October 2026. See [VERIFICATION-2026-10-15.md](VERIFICATION-2026-10-15.md) for actual final browser/build/unit results, live evidence, corrections and scope limits. The agent-local pending notes above are preserved as the original handoff record.
