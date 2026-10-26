# Inactive quote-history foundation (#85)

**This is not enabled online consent or a deployment instruction.** It supplies
retained history and closed backup/restore support. Owner capture and public
response/token consumers are not included.

The additive hand-written migration supplies checks/triggers/WITHOUT ROWID
semantics that the Prisma models alone cannot express. Use migrations rather
than a schema-push substitute omitting these protections. A database already
containing another quote-release schema revision needs a data-preserving upgrade;
never DROP/reset retained history to make it fit. Production migration/settings/
recovery acceptance remains outstanding.

## Storage and restore invariants

Authority has an immutable portable UUID independent of its nullable owned source
binding. Releases/responses refer to that UUID, not a portable numeric invoice id.
All three tables are WITHOUT ROWID with six restrictive owner/history FKs and 21
triggers. All named unique identities reject REPLACE before implicit deletion.
Bound source changes always advance revision, including a NULL current pointer;
Customer SET NULL and conversion-child changes invalidate atomically.

Fresh owner capture still requires a live source, exact revision/current-pointer
CAS and explicit access 0. A historical insert is a distinct permanently closed
branch: detached authority/currentNULL, release access 1, immutable historical
response. It never auto-activates. NULL binding cannot relink, access 1 cannot
become 0, and responses cannot postdate revocation (equal milliseconds allowed).
Generation history may form a forest after source invalidation.

## Versioned backup path

`20261026093000_add_quote_release_backup_identity` is an explicit capability union,
not a date comparison; format remains 3.0. The old manual-financial identity stays
supported and never gains quote-release fields. New identity requires all three
sections even empty; historical identities reject their presence even null.

The strict portable graph parser validates snapshot/response envelopes, complete
UUID associations, revision bounds, exact frozen JSON text and original bindings.
Snapshot includes all three collections in the same read transaction. Original
reads are tenant-only, regular/no-follow, hash/size/version checked and bounded;
there is no legacy-root fallback or regenerated PDF. Full ZIP includes each
independent immutable original under its validated original path and existing
entry/byte budgets. JSON remains metadata-only.

Restore repeats owner/global UUID and complete immutable graph preflight before
staging and inside the serializable write transaction. New evidence is always
source-detached/currentNULL/access 1. Existing UUIDs permit exact full immutable
history only, never an ancestor merge; live target pointers retire by exact CAS
before sticky disable. Existing target operational closure state remains
monotonic, never reactivated by incoming metadata. Any retained target authority
makes overwrite unsupported/fail-closed, including legacy inputs.

New originals require a validated ZIP, preserve their immutable basename and are
created exclusively/read-only with file/directory flush before metadata commit.
Existing paths are never adopted or overwritten. JSON may only replay exact
existing histories with independently checked target originals. Metadata and
mandatory financial restore audit share one transaction. Cleanup considers quote
archive references and only exclusively created unchanged stages; uncertain or
partial stages remain safe orphans, never deleted evidence. This is not a claim
of filesystem-wide atomicity or untrusted consent authenticity.

## Read-only preview and focused checks

ZIP inspection admits the new kind only with its exact capability, complete
quote graph and original binding. The quote-original namespace is reserved;
unknown kinds and missing/redirected originals fail closed under the shared ZIP
budget. Counts include all three collections and the warning states that restore
enables neither public access nor new consent. Schema identity constants are
pure and safe to import without server/database dependencies.

Focused CI selects the existing read-only backup inspection journey for this
exact foundation scope. Shared schema/restore mapping is explicit; unrelated
critical paths and missing required tests/journey remain blocked. Existing
server-unit/read-only journeys and ordinary unit/security/types/build checks
are retained. Core or preview selection does not certify SQL, restore, tenant
isolation or audit correctness.

## Bounded evidence

- Synthetic SQLite checks cover the baseline migration chain, UUID/closed
  history, FK/trigger/REPLACE invariants and enclosing audit rollback. Prisma
  6.19.3 mapping validation/generation was checked separately.
- Eight actual source-helper cases passed in fresh synthetic databases with
  native SQLite 3.46.0: cross-owner snapshot/manifest/ZIP roundtrip, exact JSON
  replay, UUID/text collision preflight, wrong-original rejection, mandatory
  final audit-FK failure after graph/file staging with full-row rollback and
  checked new-stage cleanup, and nonblocking FIFO rejection. Existing originals
  stayed unchanged. This is detached-history evidence, not live-bound capture,
  HTTP/auth, financial-data flows or production recovery.
- Pure parser and mocked store/original checks, focused types/lint and the
  21-case in-memory inspector suite passed. Snapshot binding/change indexes and
  both JSON/full-export size-error 413 responses are preserved with the graph.
  These are bounded checks, not whole-application or hosted acceptance.

## Still not enabled or accepted

No owner/public capture or response endpoint, token, email/link delivery,
activation switch or automatic financial operation is added. Owner-capture
original/audit atomicity, issue/replace/revoke consumers, independent clients,
production FK/settings/recovery, filesystem races/uncertain-stage cleanup and
hosted acceptance remain separate gates. Historical responses/hashes are not
genuine new consent.
