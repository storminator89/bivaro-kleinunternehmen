# Settings workspace redesign

## Scope

This change redesigns `/settings` within the locked Bivaro Ledger system in `design.md`. It retains Inter product typography, evergreen/mint navigation, emerald actions, existing tokens and the shared `PageHeader` and form controls. Hallmark v2.0.0 app-screen guidance informs the hierarchy and state review; no new theme, font or decorative imagery is introduced.

Application changes are limited to:

- `app/settings/page.tsx`
- `components/settings/section-navigation.tsx`
- `components/settings/settings-page.module.css`
- `components/settings/section-navigation.module.css`

The global stylesheet, shared administrative stylesheet, provider settings, authentication, API-key implementation, financial calculations, schema and API handlers are unchanged by this package.

## Before and changed

The previous screen already had named section anchors, separate save boundaries and complete tax, provider-cost and restore disclosures. Those remain.

- Company/contact and bank details now sit beside each other when the panel is wide enough; narrow panels use one readable column.
- Document defaults and logo controls form a second group above the existing save/discard footer.
- The native logo upload is keyboard-reachable with a visible focus treatment. Logo removal has a 44px target without overlapping the preview.
- Page-owned sections use `h2` headings; backup export choices use `h3`.
- The existing handoff, API-access, audit and documentation destinations form four compact directory rows. Handoff follows backup in document order; its original ID, link and accessible name remain.
- Export and navigation actions use quiet outlines. Independently saved forms retain their existing primary save actions.
- Container-width rules control company and backup/restore grids. Narrow restore previews stack count labels and permit long text to wrap.
- The existing desktop section rail and native mobile section picker remain.

## Preserved behavior

Source comparison verified that all 164 original non-style JSX attributes remain and no original JSX copy node was removed or rewritten. The full settings state/effect/handler block is byte-identical. The fiscal, annual-context, AI and SMTP component invocations, including the AI session key, are unchanged.

Form boundaries, IDs, names, values, validation constraints, event handlers, links, admin conditions, disabled expressions and loading/error/success rendering remain. Legal text, field labels, placeholders and messages are unchanged. No settings, feature, endpoint or credential access was added.

## Verification

Checks completed before draft publication:

| Check | Result |
| --- | --- |
| Whitespace/diff validation | Passed |
| Focused ESLint, zero-warning policy | Passed |
| TypeScript, no emit | Passed |
| Ordinary Node 22 production build, including existing asset/notice steps | Passed |
| Existing onboarding and fiscal-form unit checks plus workflow/evidence static checks | 4 files, 68 tests passed |
| Source-only independent review | Confirmed wiring and corrected capture-plan defects |

The build reports nine dynamic-filesystem tracing warnings in unchanged upload/PDF-validation code. Focused checks are not a claim that every repository test ran locally. No local browser, native/JVM/PDF acceptance or automated Hallmark lint/render sweep was run.

## Hosted acceptance plan

`e2e/settings-redesign.spec.ts` adds one bounded synthetic UI acceptance case to the existing hosted runner. The existing authentication suite remains unchanged.

Four full-page captures cover light/dark at 1440px and 375px. Light1440 and dark375 expand fiscal hints, annual context, no-key AI configuration and unconfigured SMTP; the other two show defaults. The complete pages include lower forms, save controls and all four directory destinations.

Four focused captures cover company saving-disabled/error states and backup previews with all fourteen counts, a long filename, warning and the longest overwrite label. The focused mobile backup preview uses 375×1280 to enclose the complete preview; primary mobile pages use 375×844. No content is hidden or cropped to meet a budget.

Additional 320, 768, 1024 and 1920px checks cover keyboard logo controls, uploading-disabled states, the open mobile picker, anchor landing, expanded restore controls, directory actions and clipping.

Settings/provider/SMTP responses and deliberate company/upload/preview requests in this new case are intercepted synthetic UI contracts, not persistence, provider compatibility or restoration proof. Unexpected mutations are blocked. No provider test or restore execution occurs. Existing dedicated suites cover unchanged business behavior.

The exact screenshot allowlist gains eight `settings-redesign-*` names, with cardinality and name assertions retained. Existing 8MiB staged-output, 16MiB encoded-input and 5MiB per-file limits and lossless checks remain unchanged. The new eight-image batch separately enforces a 1.85MiB encoded total. A hosted run produced all eight complete images totaling 1,895,156 encoded bytes; its optional staging step timed out before upload, so the bounded staging timeout is now twelve minutes. Actual delivered dimensions and byte counts still require artifact verification.

## Hosted evidence

At commit `e69c0b7`, hosted lint/types, security, build and unit checks passed (3,969 tests passed, 20 skipped). All 131 pre-existing browser cases passed. The new settings case completed its layout, state, anchor and reachability checks but failed its final mutation guard on a NextAuth diagnostic beacon; this is not a passing functional result.

The [hosted browser run](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39962704976) delivered all 67 allowlisted images at 7,541,751 bytes, below the unchanged 8MiB staged limit. All eight settings images were verified against their artifact hashes and dimensions. The four primary pages are complete full-page captures; the four focused states retain their planned viewports. An independent screenshot-first Hallmark finish review found no outstanding visual-finish issues.

The follow-up fixture correction waits for each real session fetch to finish before document navigation and separately records only sanitized diagnostic codes; unexpected authentication diagnostics and business mutations still fail the case. Its exact-head hosted functional result remains pending. Visual review is not proof of persistence/restoration, merge readiness or deployment.
