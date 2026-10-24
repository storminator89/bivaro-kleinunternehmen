# Service billing and Today workspace redesign

**Status:** implemented locally; publication and hosted acceptance pending.
**Accepted base:** `17cd6f124b96260efa32607d9c1866aa3e3e802b`.
**Base tree:** `2a4667456891cbcb1ab451ee75b7466b1db2b8e0`.
**System:** locked Bivaro Ledger / Design System 2.0. No shared theme, shell,
root navigation, README, backend, schema, dependency or feature changes.

## Page analysis and scope

| Workflow | Existing strengths | Source-level design finding | Decision |
| --- | --- | --- | --- |
| `/service-billing` | Explicit period confirmation, fixed anchor, clear no-send/no-income boundaries | Equal nested plan/period cards, tracked uppercase labels, low scan hierarchy | Recompose as one continuous plan ledger |
| Service-plan editor | Explicit tax choice, guarded save, retained input on failure | One long undifferentiated stack mixes setup, cadence and line entry | Split setup rail from flat line-item workbench; stack on narrow screens |
| Period review | Single-period decision, idempotent retry notice, busy dismissal guard | Summary and amount were an undifferentiated box | Use a ruled customer/period/amount summary and quieter confirmation well |
| `/dashboard/today` and compact dashboard preview | Prioritized source-owned destinations, exact cent strings, no totals | Date, evidence and action compete in one block; old 13rem action track can wrap long CTA | Separate date, source/reason and amount/action; size by the actual container |
| Customer work records | Existing split capture/history workbench and linked/unlinked distinction | Already follows the coherent workbench direction | Inspected, unchanged; no record or invoice-claim changes |
| Reminder workbench | Current remainder, confirmation, preview, manual-only export/record warnings | Financial evidence and action contracts take priority | Inspected, unchanged; no mail/PDF/payment mutation changes |
| `/history` | Source documents, lifecycle and recorded event evidence are explicit | Separate audit/evidence task, not plan authoring | Inspected, unchanged; retain all destinations |

This is a source-based analysis, not a claim of before/after screenshot acceptance.
No local application server or local functional browser was used.

## Concrete presentation changes

- One bordered ledger contains service plans; each plan has a distinct identity,
  status, cadence and right-aligned canonical gross amount. Horizontal rules,
  not nested cards, separate plans, services and period history.
- The next open period leads the plan body. Its exact dates, follow-up anchor,
  non-payment-deadline warning, missed/future/paused explanation and existing
  deliberate draft/skip actions remain together.
- Service descriptions, quantities, prices and tax rates remain intact. Native
  disclosure retains all calendar rules and previously processed periods.
- The editor opens as a wide workbench: plan/customer/cadence/tax setup on the
  left, flat editable service lines and one total preview on the right. At less
  than 60rem it becomes a single scrolling column; at less than 40rem numeric
  fields form a two-column grid with 16px inputs.
- The existing “Speichern erstellt noch keine Rechnung.” description is now
  visible. The existing guarded save/cancel footer remains outside the scroll.
- Today separates workflow date, evidence/reason and amount/next action. Its
  44rem container breakpoint adapts the full queue to its actual available width;
  the desktop action track is 16.5rem rather than the previous 13rem. The existing
  global dashboard rules intentionally keep the compact preview single-column
  and left-aligned, including wide tasks-only dashboard mounts.
- Loading, empty and failure paths remain present. Plan loading now has a static
  skeleton that does not rely on animation. Focus and reduced-motion rules are
  scoped, and all colours use existing role tokens, including dark-mode tokens.

## Preserved contracts and copy

All owned event bindings, hrefs, names, types, keys, values, required/disabled
conditions, numeric/date limits, close guards and request bodies have the exact
same normalized TypeScript AST hashes as accepted main. All state/effect calls,
financial calculation calls and request JSON expressions also match. New tests
pin these accepted-base hashes and every existing field/list identifier.

Money and tax calculations still call `calculateInvoiceAmounts`; no displayed
amount is recomputed by a new formatter. Today still uses the existing BigInt
cent formatter, including unknown amounts and the large-number boundary.

No legal or financial warning was reworded. The only copy/presentation changes:

| Before | After |
| --- | --- |
| `Ein Entwurf je Bestätigung · Keine automatische Abrechnung.` below the header | `Ein Entwurf je Bestätigung. Keine automatische Abrechnung.` as the header description |
| Plan counts, amount/tax, follow-up date and service metadata joined with separators | Same data/words in separate spans, lines or ruled regions |
| `Bearbeitete Zeiträume · zuletzt N` | Same label and count separated structurally |
| Today category/date and source/party joined with middle dots | Same category/date/source/party in dedicated regions |
| Hidden `Speichern erstellt noch keine Rechnung.` | The same sentence, visible in the dialog header |
| No setup group heading | Presentational heading `Plan und Kunde` |

Existing period-history status wording is retained, including its single live
state separator. No routes, links, fields, actions or warnings were dropped.
PlanCard has a named export only to support pure fixture presentation tests.

## Verification actually performed

Node **22.23.4**; existing shared dependencies used read-only, without package
installation, Prisma generation, dependency mutation, database probes or servers.

- **Passed:** 55 pure fixture tests in four files:
  `service-billing-redesign-ui` (13), `daily-actions-ui`,
  `service-billing-canonical`, and `invoice-calculation`.
- **Passed:** full `npm run lint`, zero warnings.
- **Passed:** `tsc --noEmit --incremental false`. Generated Next declaration files
  were copied locally from the accepted integration build, not committed.
- **Passed:** independent read-only source/craft review found no blocking
  defects. The reviewer identified and documented the existing compact-dashboard
  one-column override; it is preserved, not described as a three-column mount.
- **Passed:** both scoped CSS files parsed with the installed PostCSS parser;
  `git diff --check` passed.
- **Not run here:** full production build. The parent owns one coordinated
  integration build, avoiding duplicate heavy work and low-disk pressure.
- **Not run:** local app functional tests, local browser, Playwright, CI, or any
  hosted test before publication approval.
- **Not available:** automated Hallmark sloplint/capture scripts. The pinned
  reference-only skill intentionally supplies text, not executables. Static
  source/craft checks do not imply rendered visual or accessibility acceptance.

## Required hosted acceptance after publication approval

Capture `/service-billing`, new/edit plan, generate/skip review,
`/dashboard/today` and the compact dashboard queue at **1440px and 390px**, each
in **light and dark** mode. Use only approved synthetic test records.

1. Confirm page gutters, text wrapping, no document horizontal scroll, legible
   token contrast, right-aligned desktop amounts, all 44px targets, and unclipped
   mobile dialog footer/close controls. Verify the longest Today CTA remains
   single-line at desktop and readable on mobile; inspect the compact container.
2. Check all four data states: loading, empty, failure with retry and populated
   data. Never show stale plans/actions after failure or account switch.
3. Open New, cancel/Escape/backdrop, and reopen. Verify focus return and no
   unintended save; repeat with the existing fixed-schedule editor. Inspect
   keyboard order through customer, cadence, explicit tax choice, line fields,
   article selection and save/cancel. Add/remove repeated lines and long text.
4. Save with incomplete and invalid fields; retain editable inputs. Interrupt a
   save response and retry the same request. Confirm no duplicate plan and no
   stale revision overwrite. Busy close/cancel remains guarded.
5. Review Generate and Skip without confirmation, then cancel. Confirm no
   action occurred. On authorized confirmation, rapidly repeat/interrupt/retry
   the same period and verify one draft or one skip only. No number, mail,
   income/payment entry or multi-period catch-up is generated by plan review.
6. Pause/resume repeatedly and reload. It must not advance the period. Future
   plans stay non-generatable; missed periods remain explicit one-at-a-time
   decisions. Existing schedule/anchor stays fixed while editing.
7. Follow unrendered draft and rendered-history links, then Back/Forward. Verify
   the expected document, prior query state and focus; inspect skipped/removed
   periods without phantom links. Existing PDF/email/numbering flows are
   unchanged but must retain their established downstream acceptance.
8. In Today, open source workflows, dismiss dialogs and use Back/Forward. Check
   refresh, focus/tab visibility refresh and a changed business day. Preserve
   partial-result notices, unknown amounts, exact large cent strings and no
   aggregate across heterogeneous action amounts.

## Publication boundary

Local reviewable commit only. No remote branch push, pull request, merge,
publication or deployment is implied. The accepted numbering and import-profile
features remain untouched. Hosted visual acceptance is outstanding, so the
redesign is not described as released or fully accepted.
