# Serial growth + AI receipt union — 2026-10-21

## Scope and ancestry

Local integration of existing independently reviewed artifacts, not a new feature implementation:

- Growth parent: `1a959084ddfa1411fdfab88c2f041e85feaa19e6`, tree `2c5d3ef2340fc61edb72265c1887cc6504b4ad64`.
- AI merge parent: `2a742e2404bef62f389b50e6d75e40b702689ba3`, tree `41d0c47b1aab13c5ce2ff9cc5c394e33b25ef3fb`.
- Common accepted photo/annual base: `437f627eb27b0f33c99aac89695831c641c03199`.

The merge retains both reviewed histories. All non-conflicting AI application source is byte-identical to its reviewed parent. The accepted EÜR/payment/source/photo/annual behavior is retained. Historical backlog files and earlier evidence documents remain unchanged; this document records only the union work.

**No remote write, pull request, merge, deployment, CI launch, real provider credential or paid request occurred in this union task.** AI publication/acceptance is owned separately. This union must not be published until that exact accepted/current base is verified and any hosted source corrections are carried forward.

## Exact schema union

New additive no-op capability migration and backup identity:
`20261021110000_combine_growth_ai_receipt_context`.

The explicit frozen feature registry now has **nine** exact identities, in addition to the existing older historical schema support:

| Exact identity | Photo | Annual | Catalog/import | Quote | AI extraction |
|---|---:|---:|---:|---:|---:|
| `20261021054000_add_purchase_review_drafts` | no | no | no | no | no |
| `20261021061000_add_manual_photo_approval` | yes | no | no | no | no |
| `20261021070000_add_annual_business_context` | no | yes | no | no | no |
| `20261021073000_add_quote_followup` | no | no | no | yes | no |
| `20261021080000_combine_photo_annual_context` | yes | yes | no | no | no |
| `20261021080000_add_service_catalog_and_import_receipts` | no | no | yes | no | no |
| `20261021091000_add_ai_receipt_extraction` | yes | yes | no | no | yes |
| `20261021100000_combine_customer_catalog_quote_context` | yes | yes | yes | yes | no |
| `20261021110000_combine_growth_ai_receipt_context` | yes | yes | yes | yes | yes |

The two `080000` names remain distinct. Neither the reviewed `091000` AI identity nor `100000` growth identity is relabeled to claim the other's capabilities. No timestamp/prefix inference is used. Provider-settings migration `090000` adds target-owned configuration, not a separate business-backup capability identity. `AiProviderSettings` stays excluded; its configuration and encrypted key fields are never imported, deleted, enabled or replaced by business restore. Non-null AI fields remain rejected under every non-AI identity, including reviewed growth `100000`; non-null catalog/quote data remain rejected under standalone AI `091000`.

## Actual verification

Private physical `@prisma/client` and `.prisma` directories were generated inside `worktrees/growth-ai-integrated`; shared generated clients were not modified. All database tests use newly owned temporary fixtures and explicit fixture URLs.

- Prisma generation and schema validation: passed.
- **461 focused tests / 31 files passed**, including all prior growth backup/import/quote/source selections plus `lib/__tests__/ai-*.test.ts`. Command:
  ```sh
  node node_modules/vitest/vitest.mjs run lib/__tests__/*backup*.test.ts lib/__tests__/photo-annual-schema-capabilities.test.ts lib/__tests__/data-import*.test.ts lib/__tests__/csv-customer-boundaries.test.ts lib/__tests__/quote-workflow*.test.ts lib/__tests__/file-security-integration.test.ts lib/__tests__/navigation-dashboard-controls.test.ts lib/__tests__/purchase-expense-approval.test.ts lib/__tests__/ai-*.test.ts --maxWorkers=1
  ```
- ESLint on all changed TS/TSX/MJS files versus accepted `437f627`, zero warnings: passed.
- `git diff --check`: passed.
- Supported browser runner **discovery only**: **65 tests / 14 files** = accepted 61 + existing AI 1 + existing growth 3. This is not browser execution or acceptance.
- Exact screenshot union statically asserted: **23** = accepted 17 + AI 2 + growth 4. The same aggregate **5 MiB**, **one-day retention**, trace-off/no-retry/one-worker settings and safe-path/symlink/duplicate/PNG/TOCTOU guards remain intact. No CI run was started.

### Cross-feature restore evidence

The actual approved-photo full-ZIP regression now includes validated AI draft provenance and an `AI_ASSISTED_USER_REVIEW` immutable approval snapshot **before** explicit human approval. The same backup also carries complete customer identity, exact first-class catalog prices, a manually rejected quote response, annual declaration history and original photo bytes. It verifies all provenance survives target ownership remap/replay; source quote and approval remain unchanged; no Income appears; incompatible older identities fail before file resolution; immutable overwrite is refused; and audit failure rolls back every component and staged original.

The separate AI backup regression includes customer/catalog/quote/annual state while exercising **successful merge and successful overwrite** of an unposted AI suggestion source. Both modes preserve the exact pre-existing enabled target provider configuration, including its synthetic encrypted-key fields. Restored in-progress jobs become unknown/interrupted evidence rather than runnable analyses. No expense or Income is created; the source quote remains unchanged.

The initial union run exposed one stale test assertion that only the current schema could support AI; the reviewed standalone `091000` identity was correctly supported by production. The assertion was corrected to require both exact AI identities. No production validation was weakened.

## Evidence and remaining gates

Raw execution logs retained for independent local inspection:

- `/tmp/growth-ai-focused.log`
- `/tmp/growth-ai-lint.log`
- `/tmp/growth-ai-browser-discovery.log`
- `/tmp/growth-ai-static-evidence.log`
- `/tmp/growth-ai-crossroundtrip.log`

Full native build/types and browser runtime execution were **not run** under the current OOM/resource restriction. These remain acceptance gates, along with independent review of this exact frozen union, verification of the accepted remote base, and carrying any hosted AI source fixes. No publication or release acceptance is claimed.
