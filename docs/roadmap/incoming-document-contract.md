# Incoming document and expense contract

Status: implementation contract for an additive pilot feature. This document describes software behavior, not legal or tax approval. Existing sales documents keep their current semantics.

## 1. Boundaries and invariants

1. An incoming original is a `PurchaseDocument`, never an `Invoice`. `Invoice`, `Customer`, invoice numbering, outgoing credit notes and `Income.invoiceId` remain sales-side concepts.
2. Upload, extraction, preview, retry, dismissal and a displayed supplier payment status never create an `Expense`, `Income` or cash transaction. Only the explicit **Als Ausgabe erfassen** action may create one expense.
3. Every record and file belongs to the authenticated `userId`, which is the current tenant boundary. Neither request bodies nor backup source identities select the target tenant.
4. Original bytes, SHA-256, byte count, upload time, original filename, detected media type and server-generated stored filename are immutable after intake. Editing review fields does not replace the original. A corrected source file is a separate document.
5. Parsed seller information is the supplier snapshot; parsed buyer information is the recipient snapshot. Neither becomes a `Customer`, and matching a company name does not establish ownership or direction.
6. Extraction is not conformity validation. Retain `validationStatus: NOT_VALIDATED`; do not label successful parsing as validated or legally compliant.
7. A document can have at most one linked expense and an expense at most one incoming source. No automatic matching or linking to an existing expense in the first release.
8. All financial effects and their financial audit entries commit together. A failed approval leaves neither an expense nor a booked document.
9. No migration infers historical direction from filenames, seller/buyer names, status, amounts or XML. No historic `Invoice`, `Income`, `Customer`, original or number is moved, deleted, relabelled or rebooked.

## 2. Minimal additive model

A separate `Supplier` table is not required for the first vertical slice. Keep supplier and buyer snapshots on the document; a future address book must not rewrite those historical snapshots.

Proposed Prisma-level shape (field names are an API contract, not a checked-in migration):

```prisma
model PurchaseDocument {
  id                  Int       @id @default(autoincrement())
  userId              String
  user                User      @relation(fields: [userId], references: [id])
  originalFileName    String
  storedFileName      String
  originalSha256      String
  originalByteCount   Int
  mediaType           String
  uploadedAt          DateTime  @default(now())
  uploadRequestId     String
  // Snapshot-only extraction; never use this JSON as an authorization source.
  parsedData          Json?
  parseStatus         String    @default("PENDING") // PENDING, PARSED, FAILED
  parserVersion       String?
  parseErrorCode      String?
  // Nullable convenience fields from extraction, not approved ledger values.
  supplierName        String?
  invoiceNumber       String?
  invoiceDate         DateTime?
  currency            String?
  totalAmount         Float?
  reviewStatus        String    @default("REVIEW") // REVIEW, BOOKED, DISMISSED
  revision            Int       @default(0)
  expenseId           Int?      @unique
  expense             Expense?  @relation(fields: [expenseId], references: [id], onDelete: Restrict)
  approvalRequestId   String?
  approvalFingerprint String?
  approvedAt          DateTime?
  dismissedAt         DateTime?
  dismissalReason     String?
  updatedAt           DateTime  @updatedAt

  @@unique([userId, originalSha256])
  @@unique([userId, uploadRequestId])
  @@index([userId, reviewStatus, uploadedAt])
  @@index([userId, supplierName, invoiceNumber])
}
```

Add only the inverse `User.purchaseDocuments` and optional `Expense.purchaseDocument` relation. Do not add a sales direction enum or modify sales uniqueness rules. `Float` convenience fields follow existing storage only; approval validates decimal EUR input and normalizes using existing money helpers. API amounts are exact decimal strings; no new floating-point arithmetic is introduced.

Enforce a state invariant in services and restore validation: `BOOKED` has `expenseId`, `approvedAt`, `approvalRequestId` and fingerprint; `REVIEW`/`DISMISSED` have none. Approval values live on the linked `Expense` and in the audit snapshot, not in extraction fields. Keep untrusted exception text, filesystem paths and XML contents out of user-facing error messages.

## 3. Original intake and preview

### API surface

| Endpoint | Contract |
| --- | --- |
| `POST /api/purchase-documents` | Bounded multipart `file` plus client UUID `uploadRequestId`. Save one immutable original and return its review preview; never financial posting. |
| `GET /api/purchase-documents` | Tenant-scoped, bounded pagination/filtering. List includes review/parse state, supplier, invoice number, warnings and linked expense ID, not raw XML. |
| `GET /api/purchase-documents/[id]` | Tenant-scoped structured preview including seller and buyer separately, extraction/validation status and business-duplicate candidates. |
| `GET /api/purchase-documents/[id]/original` | Authenticate and look up `{id,userId}` before reading a tenant file. Attachment by default, safe filename, nosniff and private/no-store. Raw XML is never served as same-origin active HTML. |
| `POST /api/purchase-documents/[id]/retry-parse` | Only REVIEW; reread and hash-check the original. Replace derived preview atomically with revision guard. No original rewrite or financial side effect. |
| `POST /api/purchase-documents/[id]/approve-expense` | Explicit confirmed ledger payload and revision; transactional contract below. |
| `POST /api/purchase-documents/[id]/dismiss` | Only REVIEW; require reason and revision. Preserve original and preview. Repeated dismissal is a no-op; BOOKED returns 409. |
| `POST /api/purchase-documents/[id]/reopen` | Explicit DISMISSED to REVIEW transition with audit and revision. Upload retry never implicitly reopens. |

Every handler authenticates with the existing user helper. Every mutation uses `protectMutation`, bounded request readers and existing resource/processing limits. Return 404 for absent or other-tenant IDs, not ownership details. No API accepts a stored filename or a user ID as authoritative input. Review `proxy.ts` and `next.config.ts`: the new page stays protected, APIs retain per-route auth, and static `/uploads` stays blocked.

### Storage/processing order

1. Validate upload size, request UUID and supported container before processing. First slice accepts PDF/XML only, with existing PDF and XML byte limits; do not promise OCR or image extraction.
2. Compute SHA-256 over exact original bytes, not normalized XML or filenames. Perform tenant-scoped idempotency/duplicate checks before expensive extraction where possible.
3. Reuse `writeTenantFile`: opaque UUID name, tenant-private directory outside `public`, exclusive write and mode 0600. New originals never use a legacy shared-root fallback.
4. Insert the source record and audit. If DB insertion fails, remove only this request's newly created unreferenced file. A crash can leave an orphan but must not leave a committed row pointing to a deliberately removed file. Reconcile crash orphans only after a reference check and safe age threshold.
5. Reuse bounded `extractEmbeddedEInvoiceXml`, `parseEInvoiceXml` and processing concurrency controls. Persist PARSED or FAILED preview under a revision check. Recoverable parsing failure retains the original; explicit retry is safe. A crashed PENDING parse can be retried from the original, without a second row.
6. Download, approval, retry and full backup verify bytes/count/hash; mismatch is an integrity error and blocks posting. A missing or changed source is surfaced, never silently reconstructed from parsed XML.

The immutable original includes a complete uploaded hybrid PDF. Extracted XML is derived data and cannot substitute for the full PDF in backup or export.

## 4. Supplier, recipient and supported types

Preview labels must be **Lieferant / Verkäufer** (`sellerInfo`) and **Empfänger / Käufer** (`buyerInfo`); the parser's legacy `customerName` alias must not select the supplier. The first release stores both snapshots within `parsedData`; it creates neither supplier master data nor customer rows. Recipient mismatch is a warning requiring review, not evidence to flip direction.

The existing parser can extract CII/UBL invoices and UBL credit notes. The existing `getEInvoiceImportRejection` is deliberately stricter than extraction and must gate approval (or be wrapped by an equivalent purchase approval policy). Initial approval supports only an ordinary EUR invoice with valid date, finite nonnegative gross total, due amount equal to gross, no nonzero prepayment and no nonzero payable rounding. Ordinary parser success does not imply support for debit/credit notes or foreign currency.

Unsupported originals may be retained and inspected, but **Als Ausgabe erfassen** is disabled with an explicit reason. Credit notes, including positive-total UBL type 381 and negative-total CII documents, are never converted into positive expenses or `Income`. Supplier credits/refunds, partial payments, payment allocations and cancellation accounting require their own subsequent contract. A plain PDF without embedded XML or a malformed XML is retained as FAILED/no structured extraction and is not postable in the first slice. Existing manual expense entry remains available separately; do not imply that it is automatically linked to this source.

## 5. Explicit expense approval

Required JSON:

```json
{
  "approvalRequestId": "client-generated UUID",
  "expectedRevision": 1,
  "description": "Büromaterial – Rechnung R-17",
  "amount": "119.00",
  "expenseDate": "2026-10-20",
  "category": "Büromaterial",
  "taxRelevant": true,
  "taxDeductiblePercentage": "100",
  "depreciationYears": null,
  "confirmPaymentDate": true,
  "confirmReviewedOriginal": true,
  "acknowledgedDuplicateIds": []
}
```

- Date is the user's expressly confirmed expense/payment date, not invoice/due/upload date inferred by the server. The UI explains the distinction and does not claim bank payment verification. Require a real calendar date in strict YYYY-MM-DD format, validate by round trip and persist UTC midnight. Missing date is a validation error, never `new Date()`.
- Amount is explicit, positive, finite and at most two decimal EUR digits. Parse with `parseMoneyEUR` in strict mode and require integer cents to fit `Number.MAX_SAFE_INTEGER` before conversion into the existing Float-backed Expense. Apply the same safe-cent bound to parsed gross. First slice requires normalized amount to equal parsed gross total. No split/partial posting or quiet amount correction; source errors need separate review outside this flow.
- Category is explicit and nonempty using the existing allowed UI choices; deductibility is an explicit 0–100 value, never a hidden 100% default. Tax relevance must be a boolean. Any depreciation duration must obey existing positive integer constraints and supported expense semantics.
- Parsed invoice date and tax values remain suggestions/source information, not a tax-regime or deductibility decision. No VAT input-tax calculation or legal compliance claim is added.

### One database transaction

Before the transaction, validate payload, normalize the approval fingerprint, and read/hash-check the immutable source. Within `inTransaction`:

1. Load `{id,userId}` and existing linked expense. Reject cross-tenant or inconsistent links. Recheck persisted original hash/name and revision to detect changes between the initial read and transaction.
2. If BOOKED and the saved request ID **and** normalized fingerprint match, return the existing document/expense with `replayed: true` before rejecting its old revision. No new audit. Same key with different payload is 409; a different key on a booked document is 409.
3. Require REVIEW, current revision and supported parsed data. Re-evaluate blocking business duplicates and require acknowledgment of the current candidate set.
4. Create one `Expense` with the explicitly confirmed date, amount, description, category, deductibility, tax relevance and depreciation duration. The original's safe stored filename/original filename are copied into the existing receipt fields for existing receipt downloads/exports; no file is copied or rewritten.
5. Conditionally claim document where `{id,userId,reviewStatus: REVIEW,revision: expectedRevision,expenseId: null}`; set BOOKED, expense ID, approval metadata and increment revision. Require exactly one updated row, otherwise throw so the new expense rolls back.
6. Write financial audit records for expense creation and document approval with actor/tenant, original SHA-256, source/document ID, approval request ID and confirmed values. Never create an `Income`, customer, invoice number or cash transaction.
7. Commit and return `{document,expense,replayed:false}`. Prisma uniqueness/concurrent-write conflicts return a safe retry/conflict response. Retrying the same successful request cannot create a second expense.

The frontend keeps the approval UUID until a definitive response, disables double-click submission and invalidates document, expenses, expense summaries and backup-preview query caches after success. Browser cancellation is not a rollback: after an ambiguous response, retrieve the document or retry the same key.

### Linked expense protection

Because `Expense` currently has generic mutations, shipping approval requires guards in **all** expense mutation surfaces (session API, v1 API, receipt replacement/deletion and cash-book-linked operations). A linked source expense cannot be silently changed/deleted through a generic editor. Return 409 with a clear source-linked explanation. Do not unlink, clear receipt fields, remove the original file or recreate the expense as a workaround. Cash transactions and financial reversals are outside this first slice. The `PurchaseDocument.expenseId` foreign key uses Restrict; application guards provide useful errors before DB failure. Restore overwrite is a separate authorized controlled transaction with dependency-aware deletion order.

## 6. Duplicate and cancellation semantics

Two different checks must never be conflated:

- **Exact file:** unique `{userId,originalSha256}`. Same request ID and same hash returns the existing document; same request ID with different bytes is 409. Same bytes under a new request ID returns 409 with the existing document ID and `duplicateKind: EXACT_FILE`, preserving REVIEW/BOOKED/DISMISSED state. This rejected duplicate key is not recorded as an accepted upload operation; clients navigate to the original document rather than treating it as a new success. Fully binding arbitrary duplicate-request aliases would require a separate idempotency-operation table and is outside this minimal model. A race on either unique key rereads the tenant row; only the losing unreferenced file is cleaned up. Never disclose cross-tenant duplicate existence.
- **Business candidate:** distinct files may contain the same supplier invoice. Compare conservatively normalized seller snapshot/name + invoice number (and show invoice date/currency/gross as evidence). A name-only match is not supplier identity proof. Missing identifiers produce an explicit incomplete-check warning, not a claim of uniqueness. Supplier tax/registration identifiers are not presently exposed by the parser; do not invent them or key on the buyer.

Business matches are a review warning; they do not silently merge files or automatically book both. Approval requires explicit acknowledgment of current candidate IDs, visible to the same tenant, recorded in the audit. Recheck inside approval to handle concurrent uploads. If a candidate was approved after preview, require refreshed review rather than silently accepting a stale acknowledgment. Exact-file duplicates cannot be bypassed with acknowledgment.

Dismiss means “do not book this incoming source,” not an outgoing invoice cancellation, supplier credit, payment reversal or original deletion. Dismiss/reopen never touch financial rows. Cancelling after BOOKED is intentionally blocked until a separate reviewed correction/reversal design exists.

## 7. Export, backup and restore are release gates

The feature must not ship with source records that existing backup silently drops.

- Add `PurchaseDocument` to the single-read tenant snapshot, model coverage/checksum, preview counts, audit entity-ID mapping and restore result counts. Advance schema identity while retaining explicit acceptance rules for pre-feature manifests; old backups produce an empty incoming collection, never inferred records.
- Extend `BackupFileManifestEntry.kind` with `purchase-document`. Include every original, including FAILED and DISMISSED documents, with stored source reference, safe archive path, exact byte count and SHA-256. When the same file is also an expense receipt, deduplicate bytes but retain both model references. A JSON-only backup visibly warns that originals are not embedded.
- Full export/backup uses stable reads and requires the stored source hash to match current bytes. Missing/tampered originals are a hard integrity error, not silently counted as successfully backed up. Do not regenerate originals.
- Restore preview validates states, duplicate hash/request keys, SHA/size formats, allowed media, supported parse fields, approval metadata, unique expense links and same-tenant semantics before mutation. BOOKED requires a mapped expense; REVIEW/DISMISSED may not reference an expense. The linked receipt filename must resolve to the mapped original. Do not replay approval to recreate an expense already present in the backup.
- Stage and verify full-backup bytes before committing DB changes. Allocate new target-private names and map source stored filename to target filename for both `PurchaseDocument.storedFileName` and linked `Expense.storedReceiptFileName`. Remap expense IDs with the existing expense ID map. Replace source `userId` with authenticated target ownership, while retaining audit provenance. No backup can select another tenant.
- Merge: an exact-hash document collision must be resolved with the **whole linked expense component**. Skip it only when existing and imported normalized source/expense state are equivalent and map the imported expense to that existing expense before importing cash links. Ambiguous BOOKED/REVIEW or differing expense values are a preview/restore conflict; do not import an orphan expense then skip its source. Reuse of an upload UUID with another hash is a conflict. Never auto-merge by business identifier/name.
- Overwrite: validate everything first, delete dependent purchase documents before expenses in the restore transaction, preserve append-only audit handling, restore expenses, then source documents with mapped links; unrelated tenants and sales numbering stay untouched. Failure rolls back all business rows; clean only staged unreferenced files. Final orphan cleanup must consider both Expense and PurchaseDocument references.
- If a JSON-only restore lacks a new incoming original, reject restoration of that incoming component with a clear full-backup-required message. Do not mark BOOKED source provenance usable when only its metadata survived. A future explicit metadata-only recovery state needs its own contract.
- Existing expense receipt downloads/ZIP exports can reuse the copied receipt references, including XML media handling. Add incoming document ID and original hash to a source index in the ZIP/CSV without counting the document again as an expense. An incoming-inbox export includes unbooked/failed/dismissed originals and status separately from financial export.
- A document with displayed payment information never enters income export, sales reporting or revenue thresholds. Only its one confirmed linked expense participates in existing expense reporting.

## 8. Small implementation units and rollout

1. **Originals foundation:** additive schema/migration, immutable tenant intake/list/detail/download, exact-file/request idempotency and state audit. Implement backup/restore support in the same release unit before exposing upload. No posting UI.
2. **Structured review:** shared parser reuse, PARSED/FAILED/PENDING recovery, seller/buyer preview, supported-type warnings, exact/business duplicate presentation, dismiss/reopen. No financial effects.
3. **Confirmed expense:** approval transaction, replay/conflict semantics, guards across every existing expense mutation and compatible receipt export/download. UI exposes one explicit confirm action with payment date/category/deductibility confirmation.
4. **Release evidence:** build/type checks, isolated local functional and browser tests, and commit-bound GitHub CI. Do not confuse a passing local test or published container with verification of a live deployment. Review original bytes, tenant isolation, totals and backup round-trip before treating the slice as accepted.

The page belongs under authenticated `/dashboard/purchase-documents`, labelled **Eingangsbelege**, separate from **Ausgangsrechnungen**. Provide list, original preview, supplier/recipient cards, parse/validation limits, duplicate warning and one review panel. A first upload does not alter dashboard financial totals. Rollout is additive and can hide the incoming UI if needed, but retaining/restoring newly created originals and financial links remains mandatory. Do not roll back by dropping populated tables.

Legacy documents remain in their existing sales list with no guessed relabelling. Any future cleanup needs a separate explicit per-document user decision and review of existing Income/cash/audit links, not a bulk migration.

## 9. Required regression evidence

These are acceptance scenarios, not a claim that tests have been run:

- Upload an incoming CII and UBL invoice: exactly one private source, correct seller/buyer, no Customer/Invoice/Income/Expense/cash mutation or number reservation.
- Identical bytes with renamed file/new key, identical retry key, concurrent same-file uploads: one original; same key/different bytes: 409; no cross-tenant duplicate leak.
- Same invoice number from two suppliers is not an exact duplicate; same supplier/number with a different PDF shows business warning; missing identifiers show limited-check warning; stale candidate review cannot silently approve.
- Plain PDF, malformed XML, parser timeout, UBL credit note, debit note, non-EUR, prepayment, rounding and negative total: original retained with clear state; unsupported financial approval blocked.
- Client abort before/after commit, server crash after file write, parse retry, dismissed exact-file retry: no duplicate rows, no implicit reopen and no silent financial entry.
- Approval missing date/category/deductibility/confirmation, invalid decimal/nonfinite amount, parsed-total mismatch and stale revision: no expense; valid approval: one source-linked expense and both audits atomically.
- Identical approval replay returns the same expense; changed payload/key, concurrent approval, audit failure or conditional-claim failure cannot create another expense.
- Incoming paid information never calls `updateInvoiceStatus`, creates `Income`, changes sales totals or appears in outgoing credit-note cancellation.
- Other-tenant record/download/approval/expense IDs return 404; path-like filenames, active XML and oversize inputs cannot escape private storage or bypass resource limits.
- Generic edit/delete/receipt replacement on a linked expense is blocked through every API surface; financial-source originals remain downloadable after dismissal and are never removed as generic receipt cleanup.
- Backup with failed/dismissed/booked sources, shared expense receipt bytes, merge collisions, overwrite, old-schema backup, missing/tampered files, invalid link, second-tenant restore and rollback preserves original hashes, mapped links and totals without duplicate posting.
- Existing sales invoice upload/generation, PAID-to-Income, quote conversion, cancellations and every historical row retain their prior behavior; no direction backfill occurs.

## Existing reusable boundaries

- `lib/e-invoice-parser.ts`: format extraction, separate seller/buyer snapshots, import support rejection.
- `lib/upload-path.ts`, `lib/upload-ownership.ts`: private tenant filenames and controlled legacy reads; new incoming originals require tenant-only resolution.
- `lib/resource-limits.ts`, `lib/request-security.ts`, `lib/db-transaction.ts`, `lib/audit-log.ts`: reuse current request, transaction and audit controls.
- `lib/backup-snapshot.ts`, `lib/backup-manifest.ts`, `lib/backup-preview.ts`, `lib/backup-restore.ts`, backup API handlers: extend all snapshot/manifest/file/link/restore layers together.
- `app/api/expenses/route.ts`, `app/api/v1/expenses/route.ts`, expense downloads/exports and cash-book services: add source-linked protection and preserve a single financial expense.
