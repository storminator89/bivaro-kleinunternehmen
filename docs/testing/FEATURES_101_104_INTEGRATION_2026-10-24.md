# Combined #101/#104 integration verification

Local integration only. No push, PR, CI request, production migration, hosted functional test, merge or publication was performed.

## Source state

- Integration worktree: `bivaro-features-integration`; branch: `feat/bivaro-features-integration`.
- Base: `1e6d9fe` (includes PR #138). The existing catalog/inbox redesign and README remain unchanged by this integration.
- #101 source chain: `63fa2df`, `9b16e89`, `8772a43`; integration equivalents: `ac774d0`, `3dd7bae`, `9b1e29a`.
- #104 source: `417c5294a8aa16071e0e17afe3e899e4a3cae222`; integration equivalent: `7e3f330`.
- Invoice retry-race source: `90e8133a7bea5baa19d4b0076de7e24e3ee6d624`; integration equivalent: `4be82d2`.
- Shared backup source chain: `e99f527`, `3cbc0df`; integration equivalents: `5078306`, `4ba72d5`.
- The only cherry-pick conflict was additive `prisma/schema.prisma` content. The resolved schema retains the committed #104 schema and adds the committed #101 tenant-composite profile/revision models and User relation. No model or existing schema field was discarded.

## Integration defects found and fixed

1. **Strict recurring-draft backup allowlist:** the runtime no-file draft guard knew about the two nullable quote-create fields, but the separate backup scalar allowlist did not. Genuine current snapshots were rejected. The backup allowlist now includes only those scalar fields; the existing guard still rejects populated quote metadata on an invoice planning seed. The canonical fixture now matches the generated Prisma scalar inventory and tests both non-null rejections.
2. **Profile event timestamps:** parent metadata was written before the immutable revision's independently generated creation time. A real database snapshot could therefore reject its legitimate newest revision as later than `updatedAt`. Saves now use one explicit event timestamp for the profile and its revision; deletion uses one timestamp for `deletedAt`/`updatedAt`. No immutable validator was weakened and no data rewrite was performed.

## Verification

Runtime: Node `22.23.4`; Prisma `6.19.3`; Next.js `16.4.1`.

- Full `npm run lint`: **passed, zero warnings**.
- Full `tsc --noEmit --incremental false`: **passed**.
- Combined focused regressions: **967 tests passed in 65 deduplicated suites**. This includes every `*backup*`, `*migration*`, `bank-*`, `document-numbering-*`, `quote-create-*`, and `service-billing*` library suite, money/schema capability fixtures, plus the two new integration suites below and the retry fix's seven-suite regression set. Overlapping suites are counted once.
- Full migration chain applied to an explicitly named fresh temporary SQLite fixture; `prisma migrate diff --from-url=<fixture> --to-schema-datamodel=prisma/schema.prisma --exit-code`: **no difference detected**.
- Full unmodified `npm run build`, including its normal `prebuild` worker preparation and `postbuild` notice generation: **passed**. Standalone server output exists; `.next` uses approximately 572 MiB. No application server/browser was started.

New database/file fixtures:

- `feature-schema-integration.test.ts` verifies coverage for every generated Prisma model, all four new tenant models across source/target owners, tenant-composite revision FK rejection, immutable deletion tombstones, repeated overwrite retaining a continuous custom counter floor, and complete new-model user-deletion cascades without touching the source owner.
- `quote-restore-sqlite-integration.test.ts` uses an isolated SQLite database and private temporary upload tree. It verifies newly target-owned filenames and composite receipt links, exact active-target original retention while the real FK temporarily tombstones/relinks during overwrite, retired UUID resurrection rejection, and database rollback plus newly staged file cleanup after a later numbering conflict.

The fixture helpers always supply explicit newly created temporary database URLs. No repository or user database was opened or migrated.

## Invoice retry / numbering seam

The duplicate-number decision now follows verified request-marker replay inside the same FIFO transaction and precedes `consumeDocumentNumberSelection`, quote claims and invoice creation. #104's bounded provenance parsing, revision checks, atomic reservation and errors remain intact. Other PDF cleanup and P2002 recovery logic is unchanged.

A combined controlled-barrier regression also configures numbering, makes both requests observe the initial marker miss, commits the winner with sequence 100, changes the numbering revision before releasing the retry, and proves the retry still returns the original invoice/bytes with no second reservation. Changed content, unrelated requests, original XML/PDF retention, tenant isolation and retry-file cleanup remain covered. Independent read-only review signed off the exact combined route.

The fix owner recorded a pre-existing rare P2002/mismatched-fingerprint cleanup edge; it was not expanded into this bounded race correction. No broader cleanup guarantee is claimed for that unchanged branch.

## Build isolation and evidence

The workspace filesystem had only approximately 345 MiB free, insufficient for the production output. `/tmp` initially had approximately 4.5 GiB free. A tracked-source build copy and a complete private dependency copy were placed at `/tmp/bivaro-features-integration-build`; Prisma generation and build hooks wrote only into that private tree. Dependencies were copied from existing installed packages: no package installation, shared dependency modification, hook bypass, security change or new service was used.

The official PDF.js worker SHA-256 remains `bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf` in both the source dependency tree and private build copy.

Local evidence paths:

- `/tmp/bivaro-integration-focused-final.log`
- `/tmp/bivaro-integration-focused-files.txt` (58 original suites; the two integration suites above were added to the final run)
- `/tmp/bivaro-integration-lint-final.log`
- `/tmp/bivaro-integration-types-final.log`
- `/tmp/bivaro-integration-migrate.log`
- `/tmp/bivaro-integration-schema-diff.log`
- `/tmp/bivaro-integration-build.log`
- `/tmp/bivaro-integration-retry-files.txt` (final 65-suite deduplicated list)
- `/tmp/bivaro-integration-retry-focused.log`
- `/tmp/bivaro-integration-retry-lint.log`
- `/tmp/bivaro-integration-retry-types.log`
- `/tmp/bivaro-integration-retry-build.log`

## Remaining gates

Publication and any hosted functional/browser acceptance remain under the root task's authorization and review gate. The invoice-upload concurrent-retry correction is now integrated and the final aggregate lint/type/test/build checks were rerun afterward. Its deterministic reproduction demonstrates a concrete race; the original hosted failure response body remains unavailable, and no hosted rerun was performed here. No README proposal or unrelated release is included.
