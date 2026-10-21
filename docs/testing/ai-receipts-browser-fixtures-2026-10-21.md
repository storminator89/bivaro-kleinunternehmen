# AI receipt browser fixture correction — 2026-10-21

Predecessor: reviewed local `4c2fb5919a60f0fdefffb985d58605b31b32eb15`, remote PR #79 head `d96923ea916ea709f111bd8a897fd192e865e9d1`, tree `57e3cae6699cdec0f8909816d3ced8220b390463`.

## Hosted observations preserved

- CI `39573136173`: all jobs passed (1,397 unit tests passed / two existing skipped, full lint/typecheck, security browser one passed, production-only audit zero vulnerabilities, production build).
- Browser `39573136314` attempt 1: 15 passed, one existing bootstrap focus-return failure, 46 not run. Payment test/return-focus code were byte-identical to accepted main. One bounded exact-head job retry was authorized; its initial policy denial misapplied the ForgeCommunity-only restriction. After unchanged trusted user evidence of separate Bivaro CI permission, the single evidence-backed retry was accepted. Raw failure, denial, authorization-result and retry observations remain outside source.
- Attempt 2: **60 passed / two failed**. The prior focus-return assertion passed. Deterministic fixture failures: the AI uncertainty assertion matched both the AI alert and an independent photo-preview alert; the synthetic photo DTO claimed 100 bytes rather than the actual PNG length. The old-schema 3.0 browser fixture retained newly introduced `AiProviderSettings` coverage while claiming a pre-journal schema.
- Attempt 2 produced only **18** allowlisted images. Artifact `12333661728` was downloaded through the connector's returned Sediment ID, SHA-256 verified against GitHub (`df88a4e308a1658827d73951dd1c601a20335885fa129941ab29a459fe0c80b9`), CRC/path/mode/duplicate/PNG/count/5-MiB checked. Total uncompressed 3,459,504 bytes; exactly `ai-receipt-review-mobile.png` missing. This is partial evidence, NOT complete acceptance.

## Fixture-only correction

- Scope the unchanged uncertainty text assertion to the actual named AI region (`Optionales KI-Auslesen`), not every alert in the receipt dialog.
- Bind served synthetic photo bytes and SHA-256 to its DTO; explicitly assert the original photo is visible. No application preview check is relaxed.
- Genuine pre-journal fixture removes only unavailable `PaymentJournalEvent` (already excluded) and new `AiProviderSettings` coverage. Production backup validation is unchanged. Added focused registry regression proves new provider coverage is rejected under the old identity and the genuine historical shape passes.
- Actual partial settings PNG was inspected: the tall element capture in a 1,000-pixel viewport let the sticky global header obscure its URL/model row. The final capture preserves the real 1,440×1,000 viewport and visible header, individually scrolls every critical setup control below it with geometry/center hit-tests, then captures an ordinary viewport of the main settings fields. It does not hide/restyle the header or claim the entire form fits. An intermediate local-only tall-viewport proposal was superseded before publication. Final actual imagery still requires inspection.
- No runtime code, financial/focus behavior, production backup guard, existing paid-consent assertion, browser test count or screenshot allowlist change.

## Actual local verification

- Three focused suites / **24 tests passed**: schema capabilities, AI UI pure component/helpers, backup v3. Raw `/workspace/shared/ai-receipts-publication/browser-fixture-focused-tests.log`.
- Scoped ESLint zero warnings; raw `browser-fixture-eslint.log` in the same evidence directory. Whitespace clean.
- Playwright inventory only (supported fresh temporary fixture path): **62 tests / 12 files**; raw `browser-fixture-inventory.log`. No local browser, native build or full typecheck run.
- New exact successor requires independent review before remote amendment and fresh hosted CI/browser plus all **19** actual image checks. No further same-head retries, real keys/provider calls/fees, merge or deployment.
