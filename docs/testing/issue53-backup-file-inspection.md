# #53: Read-only file integrity in the full-backup preview

Date: 2026-10-26. Partial implementation of
[issue #53](https://github.com/storminator89/bivaro-kleinunternehmen/issues/53),
not completion of the backup/recovery roadmap or operator disaster recovery.

## Missing behavior and new user-visible slice

The source-equivalent main `83cabefef1fa4c0ee311125ff82420ec4d62149f`
(tree `990ea095719e054a86bacebd1d94bc2df31f0294`, represented locally by
`338fe04b9fd216a98f779e88b9ee40adebed8bd3`) validates `backup.json` during
full-ZIP preview but previously only counted the other ZIP entries. It did
not read their bytes. Missing or changed originals could therefore first be
noticed after the user selected restore.

The existing ZIP selection now performs an archive-only inspection before
showing a successful preview. Settings displays referenced/read/hash-checked
file counts and checked bytes, with honest legacy and extra-file notices.
Missing/empty originals, absent required manifest entries, conflicting shared
file proofs, and size/SHA-256 mismatches block the preview. No restore is
performed by this inspection.

This is separate from PR #188, whose provider file list covers export
resource errors and snapshot/allocation indexing, not this preview route.

## Contract and limits

- The unchanged `createBackupPreview` graph/domain validator runs before the
  new inspector. A ZIP must declare a full backup, not JSON-only data.
- The existing authenticated, mutation-protected preview endpoint remains
  protected. Its existing success-audit helper is invoked only after file
  checks; logging retains its existing best-effort persistence semantics.
- Existing compressed-byte, entry-count, compression-ratio, individual-entry
  and total-uncompressed limits remain unchanged. Metadata and every unique
  inspected payload share **one** decompression budget.
- Existing `withProcessingSlot` bounds decompression/hash work per owner and
  process. Overload returns HTTP 429 / `PROCESSING_BUSY`, `Retry-After: 1`;
  there is no queued retry or automatic reattempt.
- No file is extracted or written. Shared incoming-original/expense aliases
  are checked once per physical ZIP path, without retaining every payload.
- Current manifests bind sizes and SHA-256 for every listed file. Model
  references must resolve through that manifest. Genuine unrendered service
  drafts do not invent a missing original.
- Legacy 2.0 archives can only demonstrate that their referenced payloads are
  present, nonempty and readable. They are explicitly **not hash verified**.
- Additional archive entries without a checked manifest/data reference are
  counted and reported as excluded from restore, not silently imported.
- Hash agreement is not authenticity, media-format validation, target-state
  conflict checking, a completed restore, or a claim of fiscal completeness.
  Restore retains its own independent checks; its code is unchanged. Preview
  counts unique physical payloads, while unusual distinct source identities
  sharing one path can consume a different per-reference restore read budget.
  Restore can safely reject that archive on its own resource limits. A legacy
  manifest claiming a redundant payload that is absent is not silently relaxed
  merely because a particular target restore might not read that payload.
- No schema/migration, financial write, new service, credential, permission,
  hosting, or workflow change. The existing preview audit is the sole
  pre-existing server write retained by the route.

## Executed checks

Only the explicitly authorized memory-only ZIP and mocked boundary selection
was executed. Every synthetic ZIP was asserted below 10 KiB; no compression
bomb was generated. No database, fixture directory, local server, browser,
media decoder, restore, network or production data was used by these tests.

- 26 cases in 2 suites passed: actual tiny ZIP reads, real current/legacy graph
  validators, checksum/size/missing/empty failures, omitted model manifest
  reference, shared payload deduplication/conflict, extra entries, legacy
  uncertainty, noncanonical uppercase-digest rejection, metadata-plus-payload
  budget exhaustion, safe default/logo paths, traversal rejection, genuine unrendered service drafts, static SSR
  copy, mocked auth/graph/audit gates, non-file/non-full inputs and actual
  existing processing-slot 429/release on success and failure.
- Focused changed-source ESLint: passed, zero warnings.
- Final scoped transitive TypeScript, including the authored E2E: passed with
  1024 MiB V8 heap. Its first authored-E2E check found two TS2339 diagnostics
  because a local `document` variable shadowed DOM `document` in serialized
  page callbacks; renaming it to `sourceDocument` fixed the error. The first
  diagnostics are retained separately; no browser result is inferred.
- Initial full TypeScript: **failed**, exit 134 at 1024 MiB V8 heap with
  `Ineffective mark-compacts near heap limit` / JavaScript heap OOM. No
  TypeScript diagnostic was produced. This is not a passing check.
- A diagnosed full-TypeScript retry at 1536 MiB passed on the preceding
  implementation snapshot. A later final full-source recheck was killed with
  exit 137 without TypeScript diagnostics. The reviewed final source passes
  scoped transitive types; **final full-source types remain unestablished**.
  Neither the earlier pass nor the failed attempts are presented as a final pass.
- Independent source review found that lowercasing an uppercase manifest
  digest could report a verified preview while the unchanged restore rejected
  that noncanonical digest. Preview now rejects uppercase digests instead of
  normalizing them; the new memory-only regression passes. Restore is unchanged.
- Authored-E2E source review caught the initially collapsed native restore
  disclosure. The corrected fixture opens it with the keyboard before choosing
  files and reopens it after reload before asserting the preview is absent.
  Exact same-origin auth diagnostics remain separately classified and must
  still be absent; restore and other unexpected non-reads remain blocked.
- `git diff --check`: passed.

Local evidence files live beside the worktree with prefix
`bivaro-backup-integrity-preview-53-`. They are local verification records,
not hosted/browser acceptance artifacts.

## Proposed browser acceptance — not executed or authorized by this document

Use only the supported E2E runner's freshly migrated, explicitly addressed
synthetic fixture, never `prisma/dev.db` or a real backup. Create a synthetic
user, authenticate normally, and use a current-format in-memory ZIP with one
synthetic referenced original and its exact manifest. At 1440 and 390 px:

1. Select the ZIP in Settings and verify file counts/legacy limits, keyboard
   reachability and no horizontal clipping; no restore action is activated.
2. Discard the selection and reload. There must be no retained success,
   restore call or financial/storage mutation.
3. Select missing, same-size-tampered, and truncated variants; verify errors,
   no successful preview/restore control, and a safe retry with a good ZIP.
4. Select a genuine legacy ZIP and an archive with one additional unreferenced
   entry. Verify unknown original hashes and explicit excluded-file notice.
5. Preserve the chosen synthetic user's financial/model state and the
   original's hash before/after; allow only the documented existing preview
   audits. This is **not** an upload-directory equality snapshot. The runner
   removes its temporary database; synthetic upload files remain until
   disposable-workspace cleanup. No immutable source files or rows are deleted.

The accompanying `e2e/backup-file-inspection.spec.ts` authors this fixture
journey but has **not been executed**. Its two proposed visual files require
separate delivery allowlist/budget review before publication; no images are
claimed available.

No new browser/CI run, publication, merge or deployment was started. Complete
browser/visual, ordinary build, repository regression and actual isolated
restore/rollback acceptance remain separate gates. Issue #53 stays open.
