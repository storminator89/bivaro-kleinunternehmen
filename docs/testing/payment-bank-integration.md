# Local integration: payment terms and bank-import evidence

## Scope and immutable inputs

Prepared only in an isolated local worktree on accepted base `242db91858d103b105f129a3cd625ad2618ae5f9`.
Reused, rather than reimplemented:

- #99: `008596158df923dbe3b7d0515be62780210ca744` (three original commits).
- #95: `7ff2bf7bc2e629e8e549194e2395bc27b6cf0be0`.

The original candidate worktrees and commits remain unchanged. This is not browser acceptance or authorization to publish. No GitHub/API writes, PR, CI run, full production build, local browser, deployment, or merge to main occurred. Stopped #102/#103/#109 and blocked #108 were not incorporated or resumed.

## Semantic conflict resolutions

- `lib/backup-manifest.ts`: retain both original imports/validators and register four distinct, frozen exact identities. `300` retains projects + outbox + purchase validation; `400` adds only payment terms; `500` adds only bank evidence; new `20261022060000_combine_payment_terms_bank_import_evidence` adds both. Historical identities never acquire either future feature. Both exact standalone identities are included in explicit supported capability lists; no timestamp inference. Both names for the existing `300` identity refer to the same string, not different registry entries.
- `lib/backup-restore.ts`: import both independent feature validators; preserve the candidate-native restore bodies and transaction boundary. Bank evidence remains unallocated and cannot create payments. Customer identity remapping in parsed payment-term provenance remains intact.
- `prisma/schema.prisma`: conflict-free additive union only: nullable defaults from #99 and independent immutable bank batch/row models from #95. Original model bodies and migrations are unchanged. New `600` migration is a comment-only capability identity.

## Fixture-only reconciliation

- `lib/__tests__/photo-annual-schema-capabilities.test.ts`: explicit expectations for all four identities and 23 frozen registry entries; remove unavailable empty bank coverage from genuine legacy fixtures.
- `lib/__tests__/payment-terms-backup.test.ts`: distinguish payment-only `400` from current combined `600`, filter historical rejection cases by explicit capability, and strip empty bank-only sections from genuine `300` fixtures.
- `lib/__tests__/bank-import-backup.test.ts`: distinguish bank-only `500` from current combined `600`, and compare historic feature sets without granting payment terms to `500`.
- Existing #95 helper/fixture changes remain unchanged. Product validation was not relaxed to fit fixtures.

## New cross-feature regression

`lib/__tests__/payment-bank-combined-backup.test.ts` uses a fresh synthetic migrated database and isolated restore file directory. It checks genuine `300`/`400`/`500` histories and relabel rejection, `600` cross-tenant roundtrip, default and provenance reference remapping, manual historical dates, immutable portable bank rows/receipt and UUID replay, repeated restore with no ledger effects, and complete rollback after actual bank INSERTs when a later numbered invoice provenance collision rejects the restore.

## Verification boundary

Evidence is stored outside the repository in the immutable-commit-named local output directory. Tests run serially with a private generated Prisma client and fresh synthetic databases; no repository database is used. The focused combined suite covers backup/API/service/idempotency/ledger, project capture, outbox attempts and UNKNOWN recovery, and historic-only validation report import. 49 focused suites / 817 tests and four additional combined tests passed (50 suites / 821 tests total). Whole-repository TypeScript and ESLint passed within one bounded attempt each; the final added combined test also passed separate targeted type/lint checks. Fresh migration deployment matches the schema with an empty schema diff. An initial combined-test query assertion assumed double-quoted SQL identifiers; only that fixture assertion was made identifier-quote-independent before all four tests passed. Exact counts, protected-file hashes, original-candidate integrity, diff hashes and independent read-only review are recorded in the evidence manifest.

Hosted E2E tests from both candidates remain authored but unexecuted. Production build, browser behavior, visual acceptance and publication remain unverified.
