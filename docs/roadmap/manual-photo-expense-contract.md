# Explicit manual photo → paid Expense contract (#43 / #42 follow-on)

Status: locally implemented follow-on contract, **not** hosted acceptance or fiscal certification. This follow-on branches from frozen `c9626de`; it must not be mixed into the preceding three-feature integration.

## Small units and schema boundary

1. **Source approval**: one nullable `PurchaseDocument.reviewedSourceSnapshot` JSON column, bounded canonical validator, manual-image branch inside the existing exactly-once expense transaction. Database triggers prevent update/delete of approved manual-source evidence; restore requires an empty target where immutable evidence would otherwise be overwritten. Existing PDF/XML parsing/policy/fingerprint behavior stays unchanged.
2. **Review UI**: only complete explicitly saved JPG/PNG drafts can enter manual confirmation; current document revision and exact saved values/timestamp are sent. No unsaved approval, OCR, silent posting or inferred payment date. Separate source/buyer/ordinary-EUR/full-payment attestations, plus existing explicit category/tax/business-share controls. Current original is displayed and hash-checked.
3. **Recovery/export**: explicit new backup schema identity; strict snapshot binding, mapped target ownership and expense amount/date/description validation before writes; full ZIP roundtrip and deterministic replay after restore. Original-backed accountant pack contains one expense, one original and manual-review provenance, selected by actual payment date. No extra Income/payment/cash transaction.
4. **Evidence**: focused validator/flow/security/backup/period/export tests and hosted browser source for image → save → deliberate approval → exactly one readonly linked Expense → original pack. No local full build/browser; hosted validation remains required.

## Saved work versus immutable evidence

`reviewDraft` is incomplete-capable, mutable and unposted. `parsedData` remains extraction-only and null for photos. Neither is an approval authority.

`reviewedSourceSnapshot` is set atomically with the first successful explicit approval and remains immutable. It records policy version, provenance `MANUAL_PHOTO_REVIEW`, original SHA-256/byte count/media, stable upload request identity, current owner binding, historical reviewing tenant, reviewed document revision, exact saved-draft fingerprint/timestamp, manually confirmed supplier/invoice number/invoice date/gross amount/currency, actual full-payment date, named buyer/business purpose and required attestations. Snapshot text/date/money limits and canonical shape are closed; unknown fields and false/missing attestations are rejected.

Supplier contact selection is still explicit and owner-scoped. A manually typed supplier name is not supplier identity verification. Buyer/business ownership and full payment are human attestations, not bank or external identity checks. Ordinary purchase invoices in EUR only; no credit/debit note, refund, partial/prepayment or currency conversion support.

## Transaction, duplicates and replay

- Read owner-scoped source and verify original bytes/hash before approval; revalidate source identity, saved work and revision in the existing serializable transaction.
- Require exact saved-draft fingerprint and saved timestamp, complete source fields, amount and actual payment date equal to the deliberately confirmed draft. Category, tax relevance, deductibility and business purpose remain explicit inputs. No source/upload date substitution.
- Re-evaluate tenant-local business duplicate candidates across image/PDF/XML using normalized confirmed supplier-name + invoice-number hints, including saved manual draft and approved manual snapshots. These are hints, not universal duplicate coverage or supplier identity proof. Revisions and source hashes bind acknowledgment; never auto-merge.
- Use the existing unique one-source/one-expense link, explicit idempotency request ID and atomic two-audit transaction. A race rolls back the tentative expense. Same request and canonical fingerprint returns the same expense; changed review/attestations/key cannot create another expense.
- Fingerprint contains immutable original/upload identity, normalized values, historical contact content, canonical manual evidence and duplicate source hashes/revisions, never target-local surrogate IDs/private filenames. Runtime owner binding is validated but excluded from the replay fingerprint; restore remaps it while preserving historical reviewing-tenant provenance. No approval is replayed during restore.

## Recovery boundaries

A valid BOOKED image requires a canonical manual snapshot consistent with source hash/media/byte count/upload ID/current owner, saved draft fingerprint/timestamp, reviewed revision and linked Expense amount/actual date/description. A REVIEW/DISMISSED photo cannot carry approval evidence. PDF/XML cannot carry this manual-photo snapshot. Recomputed checksums do not relax semantic validation. A conflicting merge or attempt to overwrite existing immutable manual-source evidence is rejected before mutation.

Backup inserts the validated component into authenticated target ownership with new private filenames and mapped expense IDs; only runtime owner binding is remapped inside the snapshot. Original bytes and historical reviewing-tenant evidence remain unchanged. Existing readonly source-expense guards apply to all generic editors and receipt replacements/deletion.

## Remaining risks / explicit gates

Cross-format business matching is conservative and incomplete; missing identifiers block manual approval rather than imply uniqueness. Exact source hash cannot identify a photograph and a PDF as the same economic transaction. Human transcription and tax treatment cannot be machine-certified. Exact final hosted build/native-image/browser/visual validation and independent immutable-commit review are required before publication or an issue-completion claim.

## Local evidence (2026-10-21; no hosted acceptance claim)

- Frozen core commit `3ce245bd7d35945342b0bf71a897c728eae11245` passed 105 focused tests across approval/backup/accountant/summary suites. Subsequent UI and adversarial full-restore additions passed 159 tests across five focused suites, with focused lint/diff checks green.
- A disposable detached worktree at exact `c9626de` with only the new paid-photo regression copied in failed at its first explicit approval: HTTP **409 instead of 200**. No frozen worktree/branch was modified. The same full regression passes on the follow-on, including raw SQL immutable update/delete rejection, safe replay and no extra financial rows.
- Adversarial restore recomputes the manifest checksum, then tests owner/hash/byte count/upload identity/media/revision/amount/date/purpose/draft-fingerprint/attestation/unknown-field mismatches through both validation and actual restore; existing target expense/source evidence remains unchanged. Real full ZIP target remapping, same-key replay and merge are exercised; immutable-evidence overwrite is deliberately refused.
- Hosted source `e2e/manual-photo-expense.spec.ts` covers mobile upload/save/contact selection, unsaved blocking, fresh source/buyer/ordinary-EUR/payment attestations, response lost **after server commit**, identical-key safe retry, readonly source Expense, reload and actual-year accountant pack with exact PNG bytes. It adds no screenshot/artifact outputs. This browser case has **not** been run locally.
- Exact final hosted build/native image/browser/visual checks and independent review remain required. No tax certification, universal duplicate coverage or bank/identity verification is claimed.
