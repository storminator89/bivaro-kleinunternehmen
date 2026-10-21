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

Browser discovery lists **71 authored cases across 18 files**, including two
recurring journeys. The screenshot allowlist is the reviewed **29-name base plus
two recurring views (31 names)**, retaining all 23 accepted baseline filenames.
An earlier 35-view base attempt exceeded the unchanged **5 MiB** aggregate cap;
only new, unaccepted base views were consolidated after review, with functional
360/390/1440-px assertions retained. **One-day** retention and all evidence guards
are unchanged. The new recurring browser journeys, actual 31-image aggregate
size and visual quality have **not** been verified. Full build, semantic and
browser acceptance remain pending.

The two recurring images are normal **390×844** and **1440×1000** viewport
captures, not full-page or full-form claims. Mobile evidence targets the reviewed
customer/period/exact amount and no-financial-effect warning; confirmation and
actions are checked separately by scrolling. Desktop evidence targets the real
plan amount, next period, review/edit/pause actions and existing-draft history
link below the visible header. Geometry and actual DOM-hit checks are authored
for these critical details; no UI content is hidden, resized or masked. These
capture assertions and final PNG legibility still require browser verification.

**Known limitation:** a full backup containing a supplier-linked manually
reviewed photo can restore to a new owner, replay the same archive and restore
its own re-export. A further third-owner re-export back into an existing target
may reject with a purchase-source fingerprint conflict. The unchanged supplier
identity boundary fails closed; a regression verifies unchanged target business
and provider state after rejection. This package does not claim universal
all-feature multi-hop merging or resolve that separate supplier-alias issue.
Independent native full-ZIP recurring/payment/reminder three-owner and return
round trips pass without removing source evidence from an archive.
