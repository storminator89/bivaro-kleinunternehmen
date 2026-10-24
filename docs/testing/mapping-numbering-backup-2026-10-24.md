# Mapping profiles and numbering history: shared backup integration

Local implementation for issues #101 and #104, based on `56c37c0`. This is not a publication or production-migration record.

## Exact capability identities

The backup container remains version `3.0`. Capabilities use a closed registry, never timestamp comparisons:

| Schema identity | Mapping profiles | Numbering policies |
| --- | --- | --- |
| `20261023010000_add_bank_payment_allocations` | No | No |
| `20261024010000_add_bank_mapping_profiles` | Yes | No |
| `20261024020000_add_document_numbering_policy` | No | Yes |
| `20261024030000_combine_mapping_profiles_numbering` | Yes | Yes |

The combined migration is a real, comment-only capability marker, matching the repository's prior union convention. It changes no business rows or counters. Both feature migrations must precede it. No migration was applied during this work.

Current snapshots read the four new collections in the same read transaction as all existing tenant data. Scalar selects omit owner fields; configuration JSON is strictly validated before export. Unknown fields, raw headers, samples and raw bank records are not allowed in mapping-profile configuration. A corrupt configuration fails export rather than leaking unknown JSON.

## Restore policy

- Mapping profile/revision sections, numbering history and independent quote-create receipts are required for their declared capability, including empty arrays. Historical schemas reject even empty future sections and cannot advertise later model coverage.
- Old backups preserve target mapping profiles, deletion tombstones, numbering history and counters. Absence never requests deletion, including overwrite mode.
- Mapping profiles use tenant-scoped portable UUIDs. Both profile and revision ownership are remapped to the authenticated target user. All reads are tenant scoped; equal UUIDs in different tenants do not alias.
- Mapping revision histories must be complete and contiguous. Overlapping immutable configuration, mutation IDs and creation timestamps must match exactly. Compatible suffixes may be appended; a newer target suffix is retained.
- Deletion tombstones cannot be undone. Divergent deletion evidence, revisions after target deletion, and an older tombstone that would delete a newer target revision reject the entire restore.
- A receipt's optional profile provenance binds its ID, revision and historical name to the exact retained configuration, not the latest name. Restore does not rerun bank import or execute a payment.
- Numbering revisions are append-only. Divergent overlapping format or creation-time evidence rejects the entire restore. Existing newer revisions survive overwrite.
- Number counters merge by maximum of target counters, imported counters and exact known-format document history. Custom high-water marks are captured before overwrite can delete existing documents. Imported custom document history contributes floors after restoration. Arbitrary legacy text is never guessed into a number grammar.
- Year-only numbering remains annual. Once a document type has any no-year format in its history, sequence continuity is permanent across all yearly counter identities, even if a later format displays a year again. Configured historical start floors also remain conservative. A year display is not authority to reset a continuous counter.
- Durable quote-create requests have independent, tenant-scoped receipts containing the semantic fingerprint, original PDF SHA-256, optional invoice link and immutable creation timestamp. Linked source receipts must match their exact source quote; deleted-request tombstones remain exportable without an invoice or PDF. Invoice request fields are retained as portable source identity. Semantic fingerprints exclude local customer IDs and stored filenames; scoped customer business identity is checked separately.
- Existing receipt rows are never deleted by restore. A retired target request cannot be relinked or resurrected by an older backup. A merged tombstone does not delete a current live target link. Explicit overwrite can delete an omitted live quote normally; its consumed request survives as a tombstone. Ordinary legacy/empty-target overwrite therefore remains available: there is no blanket ban once quotes exist.
- For a matching active request, restore verifies the saved original hash and stable file version and retains the exact target-owned PDF filename/bytes, even if incoming archive bytes differ. The transaction rechecks that original and receipt state before deletion and before commit. Only an initially active, identical receipt may be relinked to the restored mapped quote after overwrite. New linked source originals must match the receipt's PDF hash and are written into target-owned filenames; complete archive manifests must carry that same hash. Without a verified target original, JSON metadata alone cannot recreate a linked quote original and a complete ZIP is required.
- Divergent request IDs, semantic/PDF hashes, timestamps, quote identity or customer identity reject the entire restore. Target checks run before staging files and again inside the transaction. Target originals are never included in staged-file rollback cleanup.
- The shared business restore is the transaction boundary. A feature conflict rolls back profile writes, numbering writes and every other model together. No partial restore is committed.

## Verification performed

Runtime: Node `22.23.4`.

```text
vitest run --maxWorkers=1
  lib/__tests__/mapping-numbering-backup.test.ts
  lib/__tests__/mapping-numbering-backup-atomic.test.ts
  lib/__tests__/bank-import-backup.test.ts
  lib/__tests__/photo-annual-schema-capabilities.test.ts
  lib/__tests__/pre-journal-browser-fixture.test.ts
  lib/__tests__/quote-create-backup.test.ts
```

Result: **176 tests passed across six suites**. New integration tests use synthetic in-memory fixtures/mocked transactions, not a database. They cover exact standalone/combined identities, old-schema rejection, incomplete/tampered histories, receipt provenance, tombstones, cross-tenant ownership remap, source-history retention, export allowlists, preview/restore gate parity, rollback after a numbering conflict, legacy overwrite retaining a custom sequence floor of 900, and durable receipts surviving owner remap, independent deletion tombstones, no resurrection, byte-exact original retention despite malicious replacement bytes, file-version race rejection, original-hash/manifest validation, and staged-file cleanup after a later conflict.

Touched-file ESLint: passed with zero warnings. `tsc --noEmit --incremental false`: passed against a temporary merged schema and a privately generated Prisma client. Generation used an explicit unused temporary database URL and created no database. Existing dependency packages were referenced read-only; no packages were installed and no shared generated client was modified.

Not run: full production build, database-backed integration suites, browser/function tests, live database migration, GitHub CI. No push, PR, merge or deployment occurred.

## Integration order

Start from current main `1e6d9fe`, apply the complete #101 chain (`63fa2df`, `9b16e89`, `8772a43`) and #104's final feature commit (`417c5294a8aa16071e0e17afe3e899e4a3cae222`) (resolve their additive User/schema edits together), then the shared backup commit chain. Regenerate the Prisma client privately against the final combined schema; run the final integrated type/lint checks before any authorized publication. Do not apply the combined backup plumbing without both feature models and the numbering feature's backup/floor helper.
