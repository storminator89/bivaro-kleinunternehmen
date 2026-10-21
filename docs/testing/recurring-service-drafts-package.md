# Recurring service invoice drafts

## Scope

The service-plan workspace supports monthly, quarterly and yearly customer
services with native line items or copied catalog items, an explicit tax mode,
and a fixed date-only calendar anchor. Month-end and leap-year schedules derive
from the original anchor rather than drifting. Due and missed periods are shown
for conscious review; pause/resume and skip-one actions are explicit.

A confirmed period creates at most one normal editable invoice **DRAFT**. It has
no invoice number, original file, issuance, payment or Income. Repeated requests
return the existing result, and a retained period receipt prevents regeneration
after draft deletion. Calendar, tenant ownership, revision checks and portable
period identities are enforced server-side.

The existing invoice editor can save the unrendered draft and later consciously
render a file into the **same invoice record**. That action continues the normal
invoice workflow; it does not automatically send, issue or collect payment.
There is no scheduler, automatic catch-up, email or financial posting. Billing
note imports into these planning drafts are explicitly unsupported and rejected;
ordinary invoice billing-note behavior remains unchanged.

## Financial and backup boundaries

- Planning markers are not receivables or reminder candidates. Malformed or
  legacy string markers fail closed in financial paths. Fresh reminder preview,
  TXT and recording paths reject them; prior immutable successful-command replay
  remains unchanged. Daily actions do not turn valid planning drafts into debt.
- The no-file restore exception requires the exact canonical native seed,
  calculated amounts, matching period receipt and absence of source, issuance,
  payment, reminder, conversion or billing-note evidence. Unknown fields reject;
  ordinary rendered invoices still require their original files.
- Full backups preserve plans, decisions, deletion tombstones and owner-remapped
  invoice links. The new exact combined identity is
  `20261021140000_combine_recurring_balance_daily_context`; standalone
  `20261021094500_recurring_service_drafts` and all prior capability identities
  retain their original meanings. Provider configuration and credentials remain
  excluded from exports and target-owned through restore.

## Verification and limits

The source-equivalent combined implementation passed **812 focused tests across
67 files**, including actual full-ZIP tests for planning and rendered periods,
a partial-payment/confirmed-reminder chain, customer/catalog/quote, manual photo,
AI and annual context, original bytes, provider preservation and read-only daily
and KPI behavior. Scoped lint and syntax checks passed, as did private SQLite and
PostgreSQL schema validation/generation. These are not full semantic typechecking
or full-repository acceptance.

Hosted verification passed **1,698 unit tests with two existing skips**, lint,
full semantic typechecking, production build, the security browser case and the
production-dependency audit. The functional run passed **70 of 71 cases**; its
remaining failure was an ambiguous page-level error-alert assertion, now scoped
to the unique application error. That correction still needs a fresh full run;
the package does not yet claim complete browser acceptance.

Browser discovery lists **71 authored cases across 18 files**, including two
recurring journeys. The screenshot allowlist is the complete accepted **29-name
base plus one recurring mobile review (30 names)**. An earlier 31-view recurring
attempt exceeded the unchanged **5 MiB** aggregate cap and safely delivered no
artifact. Only the new, unaccepted desktop recurring image was removed from the
evidence contract; all 29 accepted base views and all 71 functional cases remain.
**One-day** retention and all evidence guards are unchanged. Safe allowlisted
filename/byte diagnostics precede the aggregate check. The current 30-image
aggregate, integrity and visual quality have **not** been verified.

The new recurring image is a normal **390×844** viewport capture, not a full-page
or full-form claim. It targets the reviewed customer, period, exact amount and
no-financial-effect warning; confirmation and actions are checked separately by
scrolling. The **1440×1000** desktop assertions still check the real plan amount,
next period, review/edit/pause actions and existing-draft history link below the
visible header, including geometry and actual DOM hits. **Desktop is functionally
and geometrically tested but is not visually evidenced by this artifact.** No
whole-workspace visual claim is made, and no UI is hidden, resized, masked,
cropped or downscaled to fit the budget. Final mobile PNG legibility and the
current complete browser run remain acceptance gates.

**Known limitation:** a full backup containing a supplier-linked manually
reviewed photo can restore to a new owner, replay the same archive and restore
its own re-export. A further third-owner re-export back into an existing target
may reject with a purchase-source fingerprint conflict. The unchanged supplier
identity boundary fails closed; a regression verifies unchanged target business
and provider state after rejection. This package does not claim universal
all-feature multi-hop merging or resolve that separate supplier-alias issue.
Independent native full-ZIP recurring/payment/reminder three-owner and return
round trips pass without removing source evidence from an archive.
