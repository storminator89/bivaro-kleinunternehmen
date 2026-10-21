# PR80 payment-dialog keyboard-focus recovery — 2026-10-21

## Observed hosted result

On reviewed successor head `86fe57971fe1c597ce3ebce650442693ae3141ea` (tree `4be51eaff6ebae0d5a9cccf60472bad262b2b76a`), all four hosted CI jobs passed: unit tests, lint/type check, security and production build. Browser run `39580509622`, job `119156651052`, started the unchanged 65-case suite and stopped after **15 passed, 1 failed, 49 not run**. The desktop partial-payment journey's unchanged Escape-close assertion found the `Zahlungsstatus: Offen` trigger inactive (`auth-dashboard-invoice.spec.ts:863`). The assertion immediately before it confirmed the payment journal was unchanged. No new CSV/quote journey had yet run.

The parent also reported the same focus-return failure on an earlier accepted-AI attempt, so this was not handled by blindly rerunning an unchanged head. Raw current failure evidence is `/workspace/shared/growth-publication/job-119156651052.log`.

## Bounded lifecycle repair

The old dialog captured `document.activeElement` during render after an asynchronously closing status menu. It accepted a still-connected hidden/menu origin and otherwise used one selector union for invoice anchors, search and generic main buttons. A selector union returns document order, not priority: an unrelated earlier main button could beat the requested invoice anchor. The hosted log does not identify the exact captured DOM element; these deterministic code defects and the capture/row-rerender race are handled explicitly rather than claiming an unobserved DOM trace.

- Mark the actual payment-status trigger with the invoice ID in **both** responsive invoice layouts.
- Resolve focus in a browser-safe pure helper. Preserve a connected, visible, enabled legitimate invoker; reject body, hidden responsive copies, detached old rows, disabled controls and menu/dialog origins.
- If the origin is unavailable, resolve separate ordered candidates: the current same-invoice payment trigger, then same-invoice detail anchor, then invoice search, then another usable main control. Never use a document-order selector union.
- The dialog's existing close-autofocus handler focuses that resolved target with `preventScroll`. Escape/submission guards, initial date focus, payment requests, drafts, identity, ledger and success handling are unchanged.

No financial or provider write path changed. No browser assertion, retry setting, test count, schema capability or screenshot contract was weakened or removed.

## Fresh focused verification

- **75 tests / 4 files passed**: ten deterministic fake-DOM/SSR/wiring regressions plus existing payment-form, refresh and navigation coverage. These verify legitimate origin preservation, hidden/menu/dialog/disconnected/disabled rejection, live-row replacement, responsive duplicate filtering and explicit fallback priorities. SSR verifies the concrete invoice trigger marker; the existing Escape browser assertion is retained.
- **554 tests / 36 files passed**: the complete prior 494-test focused union selection plus the focus/payment-form/refresh coverage.
- All changed TS/TSX/MJS lint passed with zero warnings; `git diff --check` passed.

Raw local logs:

- `/tmp/growth-focus-recovery-targeted.log`
- `/tmp/growth-focus-recovery-union-focused.log`
- `/tmp/growth-focus-recovery-full-changed-lint.log`

Fake-DOM/SSR coverage is not browser runtime acceptance. No local full native build/type/browser run was started under the existing resource restriction. The exact successor requires independent diff review before draft amendment, then fresh hosted full CI and all **65** real browser cases plus integrity verification and visual inspection of all **23** allowlisted PNGs. The existing **5 MiB / one-day** staging contract and original historical backlog documents remain untouched. No merge/release acceptance is claimed.
