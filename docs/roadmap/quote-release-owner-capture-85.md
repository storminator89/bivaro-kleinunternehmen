# Internal owner quote capture (#85)

The original service packet adds one server-only internal service and focused
mocked contracts. The separate owner-surface layer now supplies a default-disabled
authenticated internal caller, documented in `quote-release-owner-surface-85.md`.
There is no token/URL, public response endpoint or email/link delivery.
Invoking the service intentionally creates an internal current release/access0;
it does not itself grant any external capability. Public activation is not built.

## Exact internal command and eligibility

`captureOwnerQuoteRelease(client, { userId, quoteId, expected: { authorityId,
revision, currentReleaseId, sourceFingerprint }, expiresAt, reason })` requires
the trusted future server caller to derive userId from authenticated ownership.
The service independently rechecks every source/receipt/authority owner and never
treats supplied fingerprints as source payload or authorization. Scalar guards
are copied before async work. Unknown command fields/accessors, malformed UUIDs,
dates/reason, exhausted Int32 revisions and expired access windows fail closed.

Only modern, rendered, owned DRAFT/SENT QUOTE rows with a genuine matching
`QuoteCreateReceipt` are eligible. Request/document association, source
fingerprint and immutable original PDF hash must match. Converted quotes,
foreign/missing customers, legacy/unrendered/changed quotes or missing/divergent
receipts are rejected: **this is not complete support for every existing offer**.
No new valid receipt is invented and no PDF is rerendered. The capture window
cannot exceed a non-null stored validity instant; no end-of-day rule is invented.
Recipient display is retained only from frozen quote parsedData, never a later
live Customer name/address/email lookup. Frozen sourcePayload remains private.

## Persistence, original and failure protocol

1. A short serializable preflight rechecks source and expected fingerprint. A
   first command (`authorityId:null`, revision0/currentNULL) creates an owned UUID
   authority only if absent, with a mandatory `quote.release.authority.preflight`
   audit in that same transaction. An existing authority is never reset/relinked;
   its exact revision and current pointer must match the command. **A newly
   audited zero-state authority intentionally survives a later capture/file
   failure**, preserving the revision clock before I/O against source A→B→A.
2. Read the exact receipt-bound existing tenant PDF through the strict reused
   bounded/no-follow/nonblocking reader, without legacy/root fallback. Reuse its
   bytes, not a regenerated rendering. Create a distinct server UUID archive
   exclusively/read-only0400 and flush file/directory before metadata capture.
   The request cannot select an archive name/path or adopt an existing file.
3. A second serializable transaction rechecks source, complete receipt identity,
   immutable payload, owner binding and exact revision/current-pointer guards.
   Insert the fixed snapshot with a fresh server release UUID and an explicit
   database statement clock in fixed parameterized SQL; required createdAt has
   no ORM or SQL default. SQL alone advances CAS and revokes the previous pointer.
   The service verifies resulting authority/row, rechecks source/archive versions,
   and performs mandatory capture/replace audit **inside the same transaction**.
   No service pre-increment, background mutation or automatic retry is allowed.

Final audit/CAS/trigger failure rolls back the release, authority change and prior
revocation together. Only this call's exclusively created, fully verified,
unchanged archive may be cleaned, after all known owner-scoped quote/invoice/
purchase/expense/logo/outbox references are absent. Recheck version after reference
queries. Partial stages, changed files and uncertain/reference-check failures are
retained safe orphans, never deleted evidence. The original source and prior
archives are never modified or cleaned. Filesystem-wide atomic unlink/concurrency
is not claimed; production recovery/race evidence remains a gate.

The receipt contains only internal release/authority/revision/date/hash fields.
Same-content explicit replacement must still use a fresh release ID/generation;
old releases remain retained and old-link authority is not inferred from equal
hashes. There is no public/network retry/idempotency contract yet: stale/replayed
commands fail instead of silently issuing another release. A future HTTP command
requires authenticated explicit intent, exact guards and no blind retry. The
owner-only surface is not a public recipient or idempotent capability protocol.

## Evidence / exclusions

The focused mocked service suite passes 28 cases; focused private-client types
and scoped lint also pass. Mocked trigger advancement and transactions are not
native database or filesystem rollback proof.

Four actual-service cases passed in one fresh synthetic database using Prisma
6.19.3/native SQLite 3.46.0 with foreign keys enabled. They verify retained initial
authority/preflight audit after final-audit failure; successful DB-clock capture
and authority CAS; observed prior revocation followed by mandatory audit-FK
failure with full-row/sequence/pointer/revocation rollback and checked new-stage
cleanup; successful same-content replacement with a fresh ID/generation and old
immutable original retained. Source/prior files and unrelated tables stayed
unchanged. These cases use a 13-byte synthetic identity fixture: **not evidence
of valid real PDF content, actual-user consent or production behavior**.

Source ABA mutation, restored-authority rejection and uncertain-stage branches
remain mocked-only in this capture slice. Filesystem races, independent-client
concurrency, production migration/settings/recovery, live HTTP/auth/idempotency
flows and public consent remain unimplemented/unverified gates. The internal
service and default-disabled owner surface remain inactive. Draft publication is
not enablement or production acceptance.
The clock-corrected service separately passed three focused native cases:
mandatory final audit-FK rollback/normal cleanup with retained preflight; required
timestamp validation; and successful explicit SQL-clock capture/CAS/audit.
The original four-case replacement evidence is preserved, not relabeled as a
rerun of the corrected insertion path.
