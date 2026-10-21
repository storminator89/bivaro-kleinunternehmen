# Growth PR80 hosted-gate recovery — 2026-10-21

## Actual failed hosted head

Draft PR80 head `bb951a10b8c6e36539ebf01ddb9a085a264ba0b0`, tree `f3c93542981717c351b35c0bfa5f76189c88bfc4`, exactly matched reviewed local `c61734a`. Hosted CI run `39579396982` and browser run `39579396945` exposed two issues:

1. Type check rejected the manually selected invoice-list DTO at `app/api/invoices/route.ts:248`: it lacked the new nullable `quoteFollowUpOn` and `quoteResponseNote` scalars required by the complete ledger-invoice type. Browser/security startup stopped at that compilation error; no browser case or PNG passed on this failed head.
2. The full parallel unit run returned **1536 passed, 1 failed, 2 existing skips**. The two concurrent same-tenant quote conversions produced `[200,429]`, not `[200,200]`. The real processing limiter intentionally rejects overlapping same-tenant parsing without a shared idempotency key. The original focused run did not always produce that scheduling overlap.

Raw hosted logs are retained under `/workspace/shared/growth-publication/job-*.log`; the draft publication ledger is adjacent. No unchanged-head rerun was requested.

## Minimal successor

- Add the two actual nullable quote scalars to the existing invoice-list Prisma select. No fabricated values, casts or relaxed ledger contract. A real-database list regression checks explicit nulls, valid derived payment state and exclusion of a private quote response from invoice lists.
- Keep the two simultaneous conversion requests. At least one must succeed, and at most one may return exactly the processing-capacity 429 with `Retry-After: 1` and the known capacity error body. Only that refused request is rebuilt and retried **once after both initial calls settle and the admitted call releases its slot**. Retry must return 200. The final two admitted successes must still return the same invoice ID, exactly one linked invoice, unchanged entire source row/original bytes and zero Income. Any other status, second refusal or invariant change fails the test. Production processing limits, source validation and conversion transaction code are unchanged.

## Fresh local evidence

- Targeted invoice-list/payment/quote/conversion selection: **66 tests / 5 files passed**; `/tmp/growth-hosted-recovery-focused.log`.
- Complete prior union focused selection plus the actual invoice-list regression: **494 tests / 33 files passed**; `/tmp/growth-hosted-recovery-union-focused.log`.
- ESLint on all changed TS/TSX/MJS files versus accepted base, zero warnings: passed; `/tmp/growth-hosted-recovery-full-changed-lint.log`.
- `git diff --check`: passed.

Schema, all nine exact capability identities, provider configuration exclusion/preservation, original backlog records, all 65 browser cases and the exact 23-image/5-MiB/one-day workflow contract are unchanged. Full native build/type/browser checks were not run locally under the existing resource restriction. This successor requires narrow independent review before the draft PR is amended, followed by fresh hosted full CI/security/build and all 65 browser cases plus integrity validation and visual inspection of all 23 PNGs. No merge/release acceptance is claimed.
