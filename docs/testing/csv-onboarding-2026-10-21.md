# Guided customer and service/article CSV onboarding

Date: 2026-10-21. Base: `e5a00e8d7b8725b2be224fbbba541326e0531d9b`
(tree `4e1400f756656bc5aad00c026cd8570b32e69d6b`).
Worktree: `csv-onboarding`, branch `feat/guided-csv-onboarding`.
Related: [customer import #75](https://github.com/storminator89/bivaro-kleinunternehmen/issues/75),
[first-class service catalog #76](https://github.com/storminator89/bivaro-kleinunternehmen/issues/76),
BV-068 roadmap. Neither issue is complete pending hosted acceptance.

## Product story and concrete prior gap

A small business can bring existing contacts and reusable sales positions into
Bivaro instead of retyping them. The base had customer CRUD, dated customer-specific
billing notes and full invoice templates, but no guided CSV import or independent
service/article catalog. This adds an actual onboarding path, not a renamed upload.

- `/customers` links to CSV import and the reusable catalog.
- `/customers/import` offers customer or article templates, bounded UTF-8 selection,
  recognized but editable column mapping, full row preview and explicit confirmation.
- `/customers/articles` lists/searches imported catalog entries with exact stored net
  price, original price basis and original tax rate.
- Invoice and quote editors expose a catalog picker. An explicit selection adds a
  position (replacing the lone empty placeholder); no financial document is issued.
  The imported tax rate is shown as source information, never inferred as the user's
  fiscal status or automatically substituted for the document's fiscal choice.

## Bounded contract

`POST /api/data-import` authenticates the existing validated current session and
uses the existing trusted-origin/body-limit guard. Input is `{kind,csv,mapping,action}`.
`kind` is `customers` or `articles`; mapping is field key to zero-based source column
(or `-1` for unmapped). Preview writes no upload/draft/receipt/business row. It returns
all row statuses, explicit counts and a tenant-bound SHA-256 review fingerprint.

Confirm additionally requires `reviewed:true`, the reviewed fingerprint and a stable
16–80 character request ID. In one serializable transaction it checks a durable
unique `(userId,requestId)` receipt first, rejects changed-payload replay, recalculates
the preview against the current own-tenant state, rejects stale review with 409, then
creates **only** ready rows, one bounded result receipt and one count/hash/ID audit.
A failure rolls back all rows, receipt and audit. No raw CSV or customer values are
retained in the receipt or audit. Confirm is the only import write path.

`GET /api/data-import?requestId=...` only reads the caller's receipt (private/no-store).
The browser stores only this opaque ID in session storage for reload recovery, not
CSV/customer data; storage is optional. An ambiguous response preserves the same
request ID for safe retry. Back/cancel or preview reload never auto-confirms.

- UTF-8 with optional BOM; semicolon, comma or tab; quoted multiline/escaped quotes.
- 256 KiB source, 500 data rows, 20 columns, 2,000 characters/cell; names 255 customer /
  200 article; unit 100; malformed rows/formulas/control characters rejected.
- Formula-like leading `=`, `+`, `-`, `@` is rejected even in ignored columns; mapped
  international phone numbers may begin `+` only with digits and phone punctuation.
  Nothing evaluates spreadsheet formulas. No external migration provider is used.
- Customer duplicate identity: normalized name + email + street + postal code + city.
  Article duplicate identity: normalized name. Existing matches are skipped, never
  overwritten or merged; within-file duplicates use the first **valid** row.
  Invalid and duplicate rows are explicitly counted and skipped by confirmation.
- Article prices are nonnegative EUR amounts with max two decimal places, max
  9,999,999.99 EUR, no thousands separators. Missing is not zero. NET/GROSS and
  explicit tax 0/7/19 are required. Gross-to-net uses integer BigInt half-up rounding
  once; both original price and exact net integer-cent strings remain stored.
  The preview explains that recomputed gross totals can differ by rounding cents.

`GET /api/service-articles` returns only validated own-tenant catalog DTOs, never
other tenants, template JSON, internal normalized keys or user IDs.

## Persistence and backup

Additive migration `20261021080000_add_service_catalog_and_import_receipts` creates
first-class tenant `ServiceArticle` and operational `DataImportBatch`. There are no
changes to `InvoiceTemplate` CRUD or its semantics. ServiceArticle has a tenant/name-key
unique constraint and canonical cent strings, source price meaning and explicit tax.

Catalog rows are covered by the existing consistent backup snapshot, schema coverage
and hashes, preview counts, strict field/price-consistency validation, transactional
restore and audit ID mapping. Current-schema catalog data must be an explicit array;
pre-CSV schemas cannot carry injected unbound catalog rows. Legacy fixture helpers
remove future catalog data/models before assigning an old schema version. Merge
preserves an equal existing catalog entry but rejects same-name differing prices or
other fields atomically rather than silently discarding them.

Import receipts are operational target state, explicitly excluded from backups.
Overwrite restore clears them. Exact old request replay is not promised after a
restore; current business-duplicate checks still run before any new import. Imported
customers/catalog remain backed up. The UI explicitly explains this distinction.

Integration note: this standalone branch supports its base's purchase-review schema
`20261021054000` plus the new catalog schema `20261021080000`. Quote follow-up and
manual photo-approval branches are **not** silently included. A combined artifact
must explicitly combine those schema capability lists and legacy fixture removals;
merely renaming `CURRENT_SCHEMA_VERSION` is not sufficient.

## Verification and remaining gates

- Focused serial Vitest: **179/179, 11 files** (48 parser; 11 transaction/ownership/
  replay/backup; 5 HTTP boundary; existing backup regressions), 15.34 s.
- Changed production/new test files ESLint: passed, zero warnings.
- `git diff --check`: passed.
- One root-authorized 768 MiB full typecheck: **terminated 137 by the environment**,
  with no TypeScript diagnostic output. No retry, no type-validity claim.
- No native full build, no local browser functional run and no new GitHub CI run.
- Authored `e2e/csv-onboarding.spec.ts`, **not executed**. It covers customer template,
  size limit, mapping, preview/no-write, keyboard Back, Cancel, lost committed response,
  same-key retry, preview reload without writes, result reload; catalog 390px preview with unknown vs zero prices,
  119.00 GROSS→100.00 NET, desktop overview, explicit invoice/quote-position reuse without
  fiscal inference/document issuance and backup inclusion.
- Exact synthetic PNG targets (not yet produced/visually verified):
  `csv-customer-preview-mobile.png`, `csv-service-catalog-desktop.png`.
- Required before release: independent review, successful applicable typing/build on
  the immutable combined artifact, hosted full journeys including mobile375/390,
  keyboard/focus, reload/Back/retry and quote/invoice picker, then root-owned publication.

No production database opened, no financial postings, no inferred VAT status, no
EÜR2026 changes, no paid services, no real customer data, no workflow allowlist/config
changes, no push/merge/publication was performed by this feature task.


## Independent review correction: customer round-trip contracts

The immutable `035ca4858d03c40e5efbc89180e676fd25db044c` artifact had two
release-blocking customer backup mismatches. Neither is hidden by the original
179-test result:

1. An actual CSV import accepted a 256-character customer name, then its own
   snapshot could not pass backup preview or restore (`customers[0].name`). A
   one-test isolated reproduction confirmed this before the correction. Other
   CSV fields could also exceed existing restore budgets, and preview only checked
   name length before actual restore checked optional fields.
2. An actual CSV import of two `Muster` customers at `Weg 1` and `Weg 2` was merged
   by the original restore onto a single target `Muster` at `Weg 1`: imported 0,
   skipped 2, target count 1 and no `Weg 2`. A one-test reproduction loaded the
   exact original restore implementation; temporary reproduction files were removed.

The correction adds the shared `lib/customer-field-contract.ts` consumed by CSV
and both backup preview validation and restore writes. Budgets remain the existing
strict backup budgets, not widened or truncated: name255, contactPerson255,
email320, phone64, address1000, zipCode32, city255, taxNumber128. Overlong CSV fields
are visible invalid rows and are never persisted. Every exact limit is tested
through actual import → snapshot → preview → restore, with byte-for-byte field
assertions. Every inherited overlong field is rejected before restore writes or
file resolver calls.

The same shared module defines customer identity as normalized name, email and
postal address (street, postal code, city), exactly matching CSV duplicate checks.
Restore now preflights this full identity **before staging files**, then repeats
that plan inside the authoritative write transaction. Same-name/different-address
customers remain distinct. Multiple matching targets or multiple source IDs trying
to reuse one target cause an explicit ambiguity rejection, never arbitrary mapping.
An existing same-number invoice for a different mapped customer also fails closed
before staging and is guarded again during transactional mapping. New tests verify
empty-target restore, repeated merge, a target containing just one of two same-name
customers, invoice/billing-note foreign-key mappings, ambiguous targets and invoice
customer collisions without rows/files changing.

Inherited manual-CRUD inconsistency remains a clearly separate follow-up: the web
customer route still allows name500 and optional fields2000, and v1 customer writes
lack the same per-field budgets. Prisma SQLite String fields themselves impose no
length cap. This correction neither retroactively truncates existing customer data
nor changes unrelated CRUD permissions/behavior; existing overlong rows now fail
backup preview honestly instead of only failing during restore. A broader CRUD
contract alignment and operator-facing remediation flow needs its own review.

No further heavy typecheck, build, browser or CI run was attempted for this correction.

Final correction verification: **201/201 focused tests across 13 files**, 17.31 s,
including 15 new customer boundary/identity regressions plus existing CSV, backup,
payment-journal and restore invariant suites. The issuance-only legacy regression
fixture now uses an explicitly matching customer; all issuance-marker assertions
remain and additional customer-ID assertions protect the mapping. No safety budget
or financial assertion was relaxed. The prior full-typecheck137 and hosted/build
acceptance gates remain unresolved.
