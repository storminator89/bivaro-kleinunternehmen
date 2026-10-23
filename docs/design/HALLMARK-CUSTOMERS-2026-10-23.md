# Customer directory and CSV workspace redesign

This package recomposes `/customers` and `/customers/import` within the existing
Bivaro Ledger system and AppShell. It includes the shared wizard's customer and
article modes; the article catalog itself is unchanged.

## Before: customer directory

1. Purpose: find a customer and use edit, service-note, timeline or confirmed
   deletion actions.
2. Keep: real company/contact fields, search, selected-customer scope and all four
   record actions with their return-focus hooks.
3. Presentation: the previous seven-column desktop directory had a horizontal
   scrollbar; its tool links, count and primary action crowded the page header.
4. Evidence limit: retained synthetic desktop/mobile images mostly show an open
   timeline dialog, so they are not an unobstructed directory visual audit.

## Before: CSV import

1. Purpose: select customer/article CSV data, map columns, review and explicitly
   confirm before creating records.
2. Keep: file limits, mappings, every review row, validation, duplicate rules,
   price/tax disclosures, confirmation, recovery and results.
3. Presentation: the mobile preview used tracked-cap status text and nested
   bordered count/row containers.
4. Evidence limit: no import-logic defect was established; new full-screen
   captures are required to accept the changed presentation.

## Changed presentation

- One primary **Neuer Kunde** action; existing import/catalog destinations and
  count move to a quiet utility row.
- Explicitly labelled search, truthful unavailable counts while loading or
  failed, and one directory surface.
- Five-column desktop directory: company/contact person, contact links, address,
  tax number and actions. All text can wrap.
- Mobile contact records also expose existing address, tax number and
  customer-since values. Contact links and task controls have 44px hit areas.
- Token-based edit dialog styling, stacked phone contact fields and the existing
  optional internal-note disclosure.
- CSV progress rail, desktop data-kind/file setup, flat comparable preview
  counts, native row disclosures and a desktop confirmation rail. Mobile keeps
  the same reading order and all confirmation text.
- Both CSV modes share these visual changes. The article setup retains its full
  price/tax disclosure; no tax or financial calculation changes.

The locked Inter typography, evergreen/mint/emerald palette and existing tokens,
AppShell, fonts, navigation and global styles are not changed by this package.
No decorative imagery, invented data, new business state or new API is added.

## Preserved contracts

All existing routes, API/auth/session behavior, filter/save/delete/import logic,
field IDs, handlers, accessible labels and return hooks remain. All legal,
payment, deletion, internal-note and import-confirmation wording is preserved.
A source comparison retained all 67 unique customer-page and 26 CSV-wizard
contracts, with all 12 network/confirmation/alert call expressions unchanged.

Presentation-only copy adjustments split step numbers and filename/format/count
metadata into separate elements. Mobile city text moves into the labelled
address. `Ansprechpartner` moves from a table head to company-cell metadata.
Existing single-separator record/source captions remain exact for their record
identity and test contracts, under Hallmark gate 63's one-dot caption allowance.
No Floor waiver or automated Hallmark pass is claimed.

## Hosted capture plan

The bounded plan has **19 required images and one conditional image**:

| View | Coverage |
| --- | --- |
| Unobscured directory | Full pages, 1440×1000 and 375×812, light/dark (4) |
| Customer CSV preview | Same four contexts, opened ready/duplicate/invalid rows (4) |
| Article CSV preview | Same four contexts, source/net-price and invalid/duplicate rows (4) |
| Desktop edit | Uncropped 1440×1080 light viewport (1) |
| Mobile edit | Uncropped 375×812 light top and notes/footer viewports (2) |
| Article setup | Full 1440 light page, price/tax disclosure open (1) |
| Customer mapping | Full 375 light page (1) |
| Article mapping | Full 1440 dark page (1) |
| Shared result | Full 375 dark customer result (1) |
| Conditional desktop edit lower view | Only if the measured form does not fit (0–1) |

Captures use real synthetic workflow states, without injected styles, crops,
masks, concealed content or shrinking. PNG dimensions are checked against the
measured document or viewport. Open disclosures and native internal scrolling
are recorded: a full-page image does not reveal rows clipped inside the capped
preview pane.

`e2e/customers-redesign.spec.ts` adds these hosted-only cases and functional
checks for filtering, selection, cancellation, load/retry, preview failure/retry,
busy/disabled controls and non-financial results. Existing onboarding,
lost-response/recovery, article-price, note and timeline tests remain intact.
Uncaptured states are not described as visually reviewed.

The workflow retains all 59 baseline screenshots and adds 20 exact allowlisted
names: 19 required and one conditional. The original 8MiB output, 16MiB input,
5MiB per-file, functional/job timeout, retention and trust guards remain unchanged.
The screenshot-staging allowance is 12 minutes for the 79 bounded images. Required
images must not be dropped to satisfy a byte budget.

## Verification

On Node 22.23.4:

- Production build, including type checks, route generation and notices: passed.
- `tsc --noEmit --incremental false`: passed.
- Full repository ESLint: passed without warnings.
- Three pure contract/evidence test files: 104 tests passed.
- `git diff --check`: passed.

Hosted browser execution, exact artifact counts/bytes and screenshot-first
Hallmark app-screen finish review remain pending at publication. No local
browser, native/PDF run or automated Hallmark sloplint/render pass is claimed.
Draft publication does not constitute merge or deployment approval.


### First hosted run

The first hosted run passed all 135 browser cases. It generated all 79 allowlisted
screenshots, including the conditional twentieth redesign image, but screenshot
staging exceeded its previous eight-minute allowance. No visual artifact was
delivered, and no visual acceptance is claimed from that run. The staging-only
allowance is now 12 minutes; the 45-minute job, 25-minute functional step and all
byte/count/pixel-equivalence/trust guards remain unchanged. A new exact-head run
must establish complete artifact delivery before screenshot-first acceptance.
