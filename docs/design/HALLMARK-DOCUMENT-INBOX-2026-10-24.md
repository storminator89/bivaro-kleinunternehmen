# Belegeingang and expense detail — Hallmark redesign

Base: `56c37c0`. Locked system: `design.md`, existing Bivaro Ledger tokens.

## Composition

- Belegeingang starts with the existing review queue, search and status filter.
  The header opens the upload area. It remains mounted when hidden, retaining
  local selection and queue state; collapse is disabled during uploads so
  progress, errors and cancellation stay reachable.
- Receipt rows align identity, review state and amount. Mobile rows stack
  identity above status and amount. Existing unknown/extraction/draft labels remain.
- Expense details separate saved bookkeeping facts from the linked original
  and provenance. The split layout stacks on mobile; legal, payment and
  source-verification disclosures remain unchanged.
- Styles are isolated in `document-workspace.module.css`; no global token,
  API, auth, navigation-guard, OCR, upload-queue or finance calculation change.

## Deliberate presentation changes

Upload starts collapsed; its action reads “Original hinzufügen”, “Upload
ausblenden”, or “Originale werden gespeichert…”. List column labels are added.
The empty booked filter now reads “Keine als Ausgabe erfassten Belege”, rather
than incorrectly saying there are no receipts to review. Invoice number/date
metadata uses separate text spans instead of a middle-dot separator. The expense
record identifier is sentence case rather than tracked uppercase.

## Verification

- Node 22 focused ESLint: passed, zero warnings.
- TypeScript `tsc --noEmit --incremental false`: passed, including the repeat after the final
  busy-disclosure correction.
- Five targeted pure suites: 99 tests passed (incoming presentation, review
  queue, navigation, workspace lifecycle, upload queue). The added lifecycle
  regression checks disclosure visibility/expanded state, stable upload
  component identity, busy-collapse lock and no navigation.
- CSS parser and existing-token reference check: passed.
- Independent static review: corrected row-focus selector specificity and
  prevented hiding the pending upload controls; confirming review found no
  further concrete issue.
- No full build, local browser, new CI, push, PR, merge or publication performed.
  Hosted visual/interaction acceptance is still required, especially keyboard
  focus, upload interrupted/repeated flows, 320px layouts and light/dark modes.
- Reference Hallmark package has no scripts directory; no sloplint/render pass
  is claimed. No photos or invented numeric material needed for these app screens.
