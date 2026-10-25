# Issue #47: reviewed remaining-balance PDF download (partial scope)

Prepared locally on 2026-10-25 against main
`c805e38c519f9d907c01af13430ce3d5926ac702`. Initial implementation commit:
`ddd29a41b70d861a388e80f7f89b68380280b90f`.

This is a bounded implementation checkpoint, not a completed issue, hosted
acceptance, publication or release-readiness claim.

## Implemented contract

- The existing reminder workbench offers an explicitly triggered PDF draft
  download alongside TXT and internal recording. The same owner-bound journal
  selector supplies the existing 120 EUR total / 40 EUR received / 80 EUR open
  example; the renderer never calculates a new receivable.
- The PDF endpoint requires the reviewed balance version, server-returned
  preview timestamp and complete document revision. It re-reads current owned
  data and rejects a changed balance or document with HTTP 409 rather than
  silently exporting replacement content.
- The revision covers the subject, text, remaining-balance evidence, recipient,
  level, fee and deadline. Reusing the preview timestamp preserves the reviewed
  deadline across midnight. Reviews older than 24 hours, future timestamps or
  malformed timestamps require a new preview. The revision is a change detector,
  not a digital signature or independent evidence of delivery or authenticity.
- PDF and TXT label their snapshot timestamp and revision. New workbench TXT
  downloads also bind the exact reviewed content; older TXT clients remain
  compatible with their existing balance-only confirmation contract.
- New HTTP 409 responses clear the dialog's old preview and confirmation. A
  PDF charset/size rejection keeps the TXT alternative available. Existing
  keyboard-native controls, disabled-while-busy behavior and close handling are
  preserved; successful download preparation is announced with a status region.
- The PDF contains the reviewed amounts, manually entered fee only, unchanged
  reminder text, journal payment evidence, page numbers and explicit draft/no
  delivery-proof notices. Unsupported font characters are not silently removed
  or replaced: HTTP 422 directs the user to unchanged TXT. Output is bounded to
  1,000 history rows, 100,000 input characters and 100 pages.

## Unchanged boundaries

No schema, migration, backup contract, journal service, invoice renderer,
financial/tax rule, original invoice bytes or PDF/A validation rule changed.
PDF generation has no database write or email transport path. It does not
internally record a reminder, mark a payment, open an outbox or prove sending.

Existing guards for settled, zero/uncertain, unsupported-currency, service-plan
draft and payment-adjustment cases remain in the shared reminder eligibility
path. Correction-aware fresh reminders and partial-payment SMTP remain blocked.
No provider credentials, new service, automatic fees or autonomous dunning were
introduced. Manual per-send control remains necessary outside this download.

## Actual local verification

- Changed-file ESLint with `--max-warnings 0`: **passed**, exit 0.
- Full `tsc --noEmit`: **passed**, exit 0, including the new test source. It also
  passed again after the build-generated Next route types were present.
- `git diff --check`: **passed**.
- Normal production build: **incomplete / not passed**. The first setup attempt
  failed because Turbopack rejected a cross-root dependency symlink. Dependencies
  were copied into this isolated checkout with the identical package lock; no
  package version or production configuration changed. The next normal build
  compiled successfully, then exited 137 while reporting its TypeScript phase.
  One memory-capped retry compiled successfully and reported only `Failed to type
  check`, exit 1, with no concrete TypeScript diagnostic. Nine existing dynamic
  filesystem tracing warnings were reported. The precise failure cause is not
  established; separate TypeScript success is not a successful aggregate build.
- Ten focused regression cases in `lib/__tests__/reminder-pdf.test.ts` and
  `lib/__tests__/reminder-pdf-route.test.ts`: **authored, not executed**. They cover
  PDF content/date/revision, long unbroken text/page bounds, charset/size failure,
  no financial/send side effects, concurrent payment, changed options/company
  text, midnight/expiry, tenant/auth/origin boundaries and settlement.
- No local unit, integration, API, browser or PDF-rendering functional tests
  were executed. No local application server or fresh GitHub CI run was started.
  No PDF was visually rendered or accepted. No real mail was sent.

## Remaining acceptance / integration

1. Complete a normal build for the exact integrated candidate without weakening
   checks. Preserve the failure logs if the current execution limit recurs.
2. On the separately authorized hosted candidate, verify PDF and TXT downloads
   for 120/40/80, unchanged original file bytes and no reminder/payment/outbox
   writes; inspect actual PDF text and layout, including long content and glyph
   fallback.
3. Verify a competing payment, full settlement, changed options/company text and
   expired preview yield a clear re-preview boundary, never an old exported debt.
4. Check cancel/back/reload, keyboard confirmation/error understanding, focus
   restoration, repeated actions, and readable 390/1440 px dialog actions.
5. Reconcile the central paired ticket checkpoint through its single integration
   owner. This note deliberately does not independently edit shared status files.

Issue #47 remains partial. Its broader corrected-document/SMTP acceptance and
existing dashboard/report consumers are not declared complete by this slice.

## Authorized hosted acceptance preparation, 2026-10-25

The user subsequently authorized a draft PR and complete GitHub CI, browser and
PDF acceptance, but no merge or deployment. This does not retroactively turn the
local verification above into a successful build or functional pass.

- Two real standalone browser cases, 1440/390 px, now cover keyboard open,
  cancellation/focus return, reload, explicit confirmation, actual PDF download
  bytes, original-file identity, no download-induced financial/outbox writes,
  expired review, competing payment (80 to 70), fresh download and settlement.
  All setup payments belong exclusively to the runner's exact fresh synthetic
  fixture. No reminder/email endpoint is mocked and no real mail is sent.
- The programmatically opened dialog explicitly restores focus to its still-live
  opening control on cancellation; no shared dialog primitive changed.
- The complete accepted 235-image browser workflow remains byte-for-byte intact.
  A separate required artifact retains two actual reminder PDFs, four native UI
  captures and every rendered page (at most eight per PDF). Its safe regular-file
  read budget is 14 MiB, each input PDF is at most 1 MiB, each PNG at most 3 MiB,
  and the complete staged output is at most 8 MiB with one-day retention. Missing,
  duplicate, unsafe or incomplete evidence fails the hosted gate. Existing
  invoice PDF/A and every prior screenshot partition remain required and unchanged.
- Five additional source contract tests guard that separate artifact and the
  exact baseline workflow. They and the two new browser cases are **authored,
  not locally executed**. Hosted results must be recorded against their exact
  eventual PR head; successful artifact staging is not itself human visual QA.

The new acceptance source received changed-file lint and full TypeScript checks;
no local functional test or additional local build was started for this stage.

The existing native container workflow now additionally watches only the exact
reminder renderer, PDF API and new E2E path in both existing PR/push filters.
Its jobs, permissions, conditions and budgets are unchanged. The unrelated
foreign-PDF conversion workflow is not an applicable gate for this delta.
