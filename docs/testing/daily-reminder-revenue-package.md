# Daily actions, confirmed reminders and revenue indicators

## Scope

This package combines three reviewed features without introducing recurring-service billing, automatic accounting, provider requests or outbound email.

### Daily actions

- A read-only dashboard preview and dedicated daily list prioritize existing invoices, quotes and unapproved incoming documents.
- Open invoice amounts come from the validated payment journal. Missing or ambiguous evidence leads to manual review, not an estimated debt.
- Exact owned-document links open the existing review workflows. Reading, cancelling and navigation do not complete tasks or change financial records.
- Receipt amounts use exact source decimals rather than cached floating-point totals. A bounded database projection reads only the source and AI-status scalars needed for prioritization, not full AI results or line items.
- Customer metadata and customer-name search remain owner-bound. Invalid or foreign document IDs cannot reveal another account's data.

### Confirmed remaining-balance reminders — partial scope of #47

- A user-controlled workbench explains actual receipts and a positive remaining balance, for example EUR 120 − EUR 40 = EUR 80.
- Explicit confirmation is required for a TXT draft or an internal reminder record. Both re-read server state and reject a stale balance instead of silently changing the reviewed amount.
- New confirmations require idempotency keys and retain immutable balance evidence. Successful command replay remains valid after later settlement; a new command against a settled invoice remains blocked.
- Own, later and round-trip backups preserve portable source identities. Ambiguous or conflicting immutable history fails closed rather than being deleted.
- Fees default to zero. No automatic fee accumulation, payment, accounting entry, PDF mutation, message or delivery is introduced. Partial-payment SMTP remains blocked.
- Reminder PDF output, durable partial-payment delivery and refund/credit allocation are not delivered by this package. Issue #47 remains partial.

### Read-only revenue indicators — partial scope of #59

- The current dashboard year has an explicit data basis separate from the historical chart filter.
- App-recorded current and prior-year receipts, self-declared prior-year totals, source, revision and completeness are displayed separately; included external shares are not added twice.
- Unknown remains distinct from known zero. A self-declared prior-year statement does not establish completeness for the current year or independently verify the business total.
- No financial calculation, fiscal profile, tax status or legal decision is changed. References remain limited to the years and material reviewed for this feature.
- The bounded references were reviewed against [§ 19 UStG](https://www.gesetze-im-internet.de/ustg_1980/__19.html) and the [Hessen tax administration's small-business guidance](https://finanzamt.hessen.de/steuern/umsatzsteuer-kleinunternehmer). The display is not tax advice or a status determination. Issue #59 remains open for its remaining acceptance scope.

## Data compatibility

The additive reminder migration is `20261021090000_reminder_balance_snapshot`, distinct from the AI-provider migration with the same numeric timestamp. The combined export identity is `20261021120000_combine_growth_ai_reminder_context`.

All historical exact feature identities retain their original capabilities. In particular, the earlier combined growth/AI identity is not relabeled as reminder-capable. Daily actions and revenue indicators add no database model or migration.

Customer/catalog/quote, payment journal, AI/photo approval, annual-context history, original files and accountant/EÜR behavior remain preserved. Provider configuration and encrypted credentials stay excluded from business backup exports and remain owned by the restore target.

## Verification recorded before hosted acceptance

- The final integrated focused selection passed **666 tests across 54 files**, including cross-feature full-ZIP restoration, immutable reminder replay/history, exact-decimal and bounded-summary regressions, owner boundaries, payment-dialog focus and read-only daily/revenue checks.
- A subsequent test-only CSV selector carry passed **79 focused tests across four files**. These overlap the broader selection and are not added to it as unique coverage.
- Changed-file lint, Prisma validation and exact-source/static checks passed. Database tests used fresh isolated fixtures and separate generated clients.
- The full-ZIP regression verifies original-file bytes, restored ownership and immutable provenance, exact source business-row equality, target provider preservation and no business/audit mutation from daily or revenue reads.
- Browser discovery lists **69 cases across 17 files**. This is discovery, not execution or visual acceptance.
- The optional screenshot contract contains **29 exact names** with the existing **5 MiB aggregate cap**, **one-day retention** and all existing safe-path, duplicate, regular-file, PNG and staging guards unchanged. Actual aggregate size and all-image visual review remain pending; incomplete or oversized evidence must be resolved without increasing the cap or silently dropping required coverage. A previous 35-image attempt exceeded the same cap; only new, unaccepted views were consolidated after review. All 23 accepted baseline filenames and both reminder views remain.

A full semantic typecheck, production build, hosted browser run and actual image-integrity/visual review remain acceptance gates for this exact package. No release-readiness, completed-issue or production-deployment claim is made here.

## Reviewed screenshot coverage

The six new selected images are confirmed reminders at 390/1440 px, daily actions at 390/1440 px and revenue amounts at 390/1440 px. Daily images show the first prioritized source, exact open amount and its review action. Revenue images show the app-receipt/unknown-company-total distinction and nearby numeric basis. These are normal viewport captures: neither image claims that every item or the complete long declaration fits on one screen.

The functional journey still checks every daily action and all revenue data-basis terms/source declaration/correction-link access by scrolling at **360, 390 and 1440 px**. Empty, loading, error/retry, keyboard, navigation, source-specific review/cancel and no-financial-write assertions remain. The daily quote step uses the actual mobile card's “In Rechnung” control after checking the exact owned document URL, rather than waiting for a desktop-only label. No UI content is hidden, restyled, masked or removed for capture. All 69 functional cases remain; none is skipped for evidence selection.
