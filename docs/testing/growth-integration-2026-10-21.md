# Customer onboarding, catalog and quote-workflow integration — 2026-10-21

## Frozen scope and source

Local integration only; no push, pull request, merge, deployment, customer data, provider key or paid provider request occurred in this work package.

- Accepted base: `437f627eb27b0f33c99aac89695831c641c03199`.
- Reviewed CSV/catalog source: `702dd833af14bca92ece5f1f5d326ead3b086d39`; integrated `c856722`, `9b02aff`, `035ca48`, `702dd83` in order.
- Reviewed quote source: `5a756e5c2bc28432ef2887b19fb27204970c3d21`; integrated `a6a3377`, `b043ccd`, `5a756e5`. The unrelated historical backlog-only commit was deliberately omitted.
- The original `docs/backlog/TICKETSTATUS.md` and `docs/backlog/ticket-status.json` remain byte-identical to the accepted base. Existing LOCAL ONLY history was not rewritten.

Customer CSV preview stays read-only. Confirmation retains explicit acknowledgement, transaction, CAS and audit requirements; customer limits and complete restore identity matching remain shared. Catalog data uses first-class `ServiceArticle`, not invoice-template storage. Catalog copy into invoice and quote editors does not change fiscal settings, issue a document or create Income. Quote responses remain explicitly manual; conversion preserves source status, existing immutable source and idempotent target mapping.

## Exact schema capability union

New migration/backup identity: `20261021100000_combine_customer_catalog_quote_context`. It is an additive **no-op capability migration**, not a replacement or renaming of older migrations.

| Exact immutable schema identity | Manual photo | Annual context | Catalog/import | Quote workflow |
|---|---:|---:|---:|---:|
| `20261021054000_add_purchase_review_drafts` | no | no | no | no |
| `20261021061000_add_manual_photo_approval` | yes | no | no | no |
| `20261021070000_add_annual_business_context` | no | yes | no | no |
| `20261021073000_add_quote_followup` | no | no | no | yes |
| `20261021080000_combine_photo_annual_context` | yes | yes | no | no |
| `20261021080000_add_service_catalog_and_import_receipts` | no | no | yes | no |
| `20261021100000_combine_customer_catalog_quote_context` | yes | yes | yes | yes |

The two `080000` strings remain distinct. No prefix, timestamp ordering or current-constant replacement grants capabilities to another identity. Older source identities reject unsupported non-null photo, annual, catalog and quote metadata even when manifest hashes are rebuilt. Genuine older fixtures remove later empty sections/coverage explicitly rather than relabeling a current snapshot. Quote-capable backups must carry both nullable quote workflow fields.

AI receipt and reminder work are separate concurrent packages and are **not** granted capabilities by this growth identity. A later reviewed release must preserve each existing standalone identity and register its own complete union; it must extend all relevant exact support lists, not only replace `CURRENT_SCHEMA_VERSION`. Provider configuration remains outside this package.

## Actual verification

Executed in the private `growth-integrated` worktree with private physical `node_modules/@prisma/client` **and** `node_modules/.prisma`; no shared generated client was modified. Each database-backed test owns a fresh temporary SQLite fixture with an explicit `DATABASE_URL`; no repository database was used.

- Prisma client generation and `prisma validate`: passed.
- Focused Vitest selection: **329 tests / 21 files passed**. Command:
  ```sh
  node node_modules/vitest/vitest.mjs run lib/__tests__/*backup*.test.ts lib/__tests__/photo-annual-schema-capabilities.test.ts lib/__tests__/data-import*.test.ts lib/__tests__/csv-customer-boundaries.test.ts lib/__tests__/quote-workflow*.test.ts lib/__tests__/file-security-integration.test.ts lib/__tests__/navigation-dashboard-controls.test.ts lib/__tests__/purchase-expense-approval.test.ts --maxWorkers=1
  ```
- ESLint across every changed TS/TSX/MJS file versus accepted base, `--max-warnings 0`: passed.
- `git diff --check`: passed.
- Supported runner discovery only, `node scripts/run-e2e.mjs --list`: **64 browser tests / 13 files discovered**, preserving the accepted 61 and adding the existing two CSV/catalog journeys and one quote journey. **This is not browser execution or acceptance.**
- Workflow static assertions: all accepted 17 screenshot names retained; exactly four authored CSV/catalog/quote names added (21 total). Aggregate budget remains **5 MiB**, artifact retention **one day**, traces off, no retry, one worker, symlink/duplicate/PNG/TOCTOU checks retained. No CI run was started.

The real approved-photo full-ZIP regression now includes the complete customer identity, exact catalog gross/net strings and manual rejected-quote response together with annual history and original photo bytes. It verifies remapped target ownership/customer link, repeated merge without duplication, source quote immutability, zero Income, explicit older-identity rejection before file resolution, immutable-source overwrite refusal, and rollback of all components plus staged originals when the required audit fails.

A broad focused run initially exposed a synthetic old quote fixture missing the newly mandatory nullable fields; only that fixture was corrected. Earlier empty annual/catalog fixtures were also made genuinely historical. No production guard was loosened to satisfy tests.

## Still required before publication

Independent review of the exact source/tree, then serial integration with any other approved packages and fresh exact union validation. Full native build/type checking and real browser execution were intentionally **not run** under the current OOM/resource restriction. The 64 discovered journeys and 21 screenshot allowlist are obligations for a later authorized capable executor, not claimed passing evidence. Preserve the accepted EÜR/payment/source/photo/year behavior during that final union.
