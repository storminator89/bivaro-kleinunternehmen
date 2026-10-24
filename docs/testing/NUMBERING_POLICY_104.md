# Issue #104 — bounded document-number policies

Implementation candidate based on `56c37c0`; not a delivery or legal-compliance claim.

## Contract

- Invoice, quote and cancellation-credit-note formats support only a bounded
  uppercase prefix (0–16 characters), optional year and minimum sequence width
  (1–10). No templates, new document types, customer or article numbering.
- Revision 0 preserves the previous `2026-01`, `AN-2026-01`, `GS-2026-01`
  defaults. Up to 100 append-only format revisions per type preserve exact known
  historical formats; unknown or ambiguous legacy formats block changes.
- Starts move only forward against counters, exact-known historical numbers and
  already configured start floors. PostgreSQL-style sequence semantics are not
  invented: existing SQLite tenant/type/year counter identities remain unchanged.
- Types that have only used year-qualified formats keep the existing annual
  counter contract. **Once any revision omits the year, that type permanently
  remains continuous across all existing yearly counter identities, even if a
  later revision displays the year again.** The UI explains this before saving.
- Preview and cancel do not reserve numbers. Settings preview must be explicitly
  confirmed and is rechecked with its revision and exact next number in the save
  transaction. An intervening edit/allocation rejects the stale preview.
- Generated invoice/quote editors submit their exact preview provenance. Settings
  changes and competing allocations reject persistence rather than changing the
  already rendered XML/PDF number. Manual/imported numbers remain untouched.
- Generated quote editors also retain a stable create UUID. A database unique
  key on tenant/UUID is authoritative, not an advisory JSON lookup. Identical
  retries return the retained original quote, even after a settings change; a
  changed semantic payload or customer conflicts. An independent, tenant-bound
  receipt survives ordinary quote deletion as a nullable-link tombstone; the same
  request then returns 410 without reserving or recreating a quote. Its original
  PDF SHA-256 stays immutable. Normal delete capability is preserved.
  No replacement PDF is saved or
  downloaded on replay. Portable version-1 fingerprints exclude local customer
  IDs and stored filenames; restore separately checks mapped customer identity.
- Cancellation credit notes still mean the existing cancellation document only;
  they do not introduce a refund, payment or new credit-note workflow.
- Tenant-wide number uniqueness and conservative cross-type namespace checks
  prevent shared formats. Existing serializable/retried transaction handling and
  the database unique constraint remain authoritative.
- Sequence values stop at signed 32-bit maximum; overflow fails closed. Bounded
  checks support 10,000 tenant documents/counters, then request manual review.
- Restore preserves append-only policy histories and rejects conflicting immutable
  revisions or overlapping active namespaces. Old backups do not remove current
  policies. Exact-known custom historical high-water marks survive overwrite
  deletion; restored documents contribute additional maxima. Quote-create
  identities are paired, source-hash-validated, unique and preserved on restore. Shared backup
  capability/snapshot/restore integration is a separate coordinated change.

## Verification

2026-10-24, Node 22.23.4:

- Focused numbering policy, settings API and generated-persistence tests use fresh
  temporary fixture databases, XML fixtures and synthetic quote bytes. No native
  PDF renderer or local browser was used.
- Regression scope: bookkeeping integrity, existing XML upload idempotency,
  cancellation (mocked PDF generator), quote workflow API and backup v3, plus
  service-billing lifecycle/note/financial boundaries, payment terms, allocation
  consumers and quote listing. The strict no-file service-draft detector permits
  the new quote metadata only when null and any receipt relation only when empty.
- Historical documents, XML and stored paths are compared unchanged; parallel
  exact previews cannot create two documents or reserve twice. Per-tenant upload
  capacity can reject a simultaneous request with 429 before numbering; retry
  with the consumed preview safely returns conflict.
- Exact final focused/regression result: 231 tests passed across 16 focused/regression suites.
- Quote-create tests separately distinguish actual best-effort audit DB failure
  (success, bytes retained), a hypothetical unexpected post-commit wrapper error
  (committed original bytes retained and replay succeeds), and receipt insertion
  failure (document/counter/bytes rolled back). No current audit-loss defect is
  claimed.
- Quote save is synchronously duplicate-guarded; controls and cancel are locked
  while pending, and an unmounted editor does not start a later upload or redirect.
- Full ESLint, TypeScript and schema validation results are in the handoff.

## Remaining acceptance gates

Combined backup integration, the exact integrated candidate's production build
and existing CI, plus real rendered browser QA at 1440 and 360/390 px remain
required before release. Cover keyboard/focus return, edited/manual numbers,
preview/cancel, stale settings tabs, year changes, errors/retry, reload and
uncertain network outcomes. No publication, push, merge, migration on user data,
or new CI run is performed by this implementation package.
