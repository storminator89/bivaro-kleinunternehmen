# Income and expense workspace — local presentation package

Base: `9229ed2f3b368cbed06ca75506e8e805deb1eed0` (merged invoice/quote package).

## Visible changes

- Search is first in actual keyboard/DOM order, followed by compact labeled filters. Export/reset and sorting remain in a separate utility strip.
- Entry descriptions span the identity row; amount, date and customer/category follow together. Tax controls use a quiet divider, not nested cards. Expense percentage and depreciation fields remain unconditionally available.
- Receipt attachment becomes a compact, wrapping row. Its native file input remains keyboard reachable, with a visible focus-within ring; accepted formats and first-file selection are unchanged.
- Mobile descriptions are no longer truncated. Identity and money occupy independent rows on narrow screens; actions have their own divider. Desktop date, description, tax, provenance, amount and action columns retain their established order and behavior.
- Scoped CSS follows locked `design.md`: Inter, evergreen/mint tokens, white ledger surface, 44px controls, visible keyboard focus, and 16px mobile filter inputs.

## Preservation evidence

Source-only AST comparisons against the base freeze all 281 non-class JSX attributes in each tab, visible literal copy, component props, income attribution, category derivation, sort state and filter state. Class changes and presentational wrapping/reordering are intentionally permitted. No controller, API, amount, tax calculation, invoice allocation, action eligibility, legal copy or pagination change is included.

Independent read-only review found no material source regression. It identified a mobile font-size issue; the narrow-screen filter rule now uses the 16px token. Source review does not establish rendered layout or functional acceptance.

## Verification status

- Source contract comparison: matches baseline for both tabs.
- `git diff --check`: passed.
- Node 22.23.4: full ESLint with zero warnings, production build (117 static pages plus notice generation), and separate `tsc --noEmit` passed. Nine existing filesystem-tracing warnings remain in unchanged server modules. Dependencies were copied privately; no shared Prisma generation or production database access occurred.
- Focused source-contract suites: 21/21 passed (cashflow, invoice, quote). Receipt actions, source-linked expense actions, allocation presentation and purchase-expense presentation: 54/54 passed. Total focused pure/source tests: 75/75 across seven suites.
- Hosted preparation: two additional cases and eight exact captures are discoverable without browser execution; new bounds/source checks pass. Independent source review fixes keep the clipped file input at 1px and bound actual aggregate image reads, including same-inode size changes.
- Browser acceptance: **not run / not accepted**. No local browser, native renderer, JVM or PDF execution is part of this package.
- GitHub publication, CI, merge and deployment: **not performed** by this local package.

## Future hosted acceptance plan — at most eight images

Use synthetic fixtures only and the existing hosted browser harness after coordinated publication. Do not add eight PNGs blindly to the current 95-image artifact: its known size is close to the 10 MiB ceiling. The hosted workflow now preserves the original 95-name artifact and its 10 MiB output / 16 MiB input limits unchanged. A separate exact eight-name `cashflow-workspace-synthetic-visuals` artifact is capped at 2 MiB output / 4 MiB input / 1 MiB per input file, with one-day retention and a six-minute staging timeout. Combined output is explicitly bounded to 12 MiB. Both partitions retain the same lossless pixel and color-metadata verification and two-worker compression. No existing proof is dropped. Incomplete cashflow evidence cannot be staged as complete.

| Images | Route/state | Viewport | Themes |
| --- | --- | --- | --- |
| 1–2 | `/dashboard?tab=incomes`, ledger, long description/customer and large amount, attribution visible | 390px | light/dark |
| 3–4 | `/dashboard?tab=expenses`, ledger, long description/category and source-linked receipt actions | 390px | light/dark |
| 5–6 | `/dashboard?tab=incomes`, entry open with populated ledger and filter/sort utility strip | 1440px | light/dark |
| 7–8 | `/dashboard?tab=expenses`, entry open with long attachment filename and tax/AfA fields | 1440px | light/dark |

Without additional screenshots, check widths 320/375/414/768/1280/1440, keyboard search/reset/file selection and visible focus, loading/error/retry, empty/filtered-empty states, 10/20/50 pagination, unchanged edit/duplicate/delete/export behavior and origin-versus-current income attribution. Check overflowing amounts, dropdowns and source-linked expense actions. Preserve the existing functional financial suites rather than replacing them with visual assertions.
