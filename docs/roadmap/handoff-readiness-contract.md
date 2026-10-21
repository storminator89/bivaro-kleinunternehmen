# Guided accountant handoff: bounded readiness contract

The control page at `/handoff` is a review aid for the existing version-1
accountant ZIP, not a second accounting calculation or a completeness approval.
The chosen year (including years unsupported by EÜR adapters) or bounded custom
period remains in the URL. Reload/back restores only this selection; it does not
restore a checked approval, successful download message or an automatic export.

## Read-only tasks

`GET /api/handoff-readiness?year=YYYY` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
reuses the accountant export period parser. It requires the current validated
user and returns only that owner's unresolved `REVIEW` purchase-document counts
and up to five ID/filename examples per group:

- Saved source `invoiceDate` inside the inclusive UTC period: dated open items.
- Source `invoiceDate = null`: unknown year, explicitly workspace-wide, even when
  uploaded outside the chosen period. Upload-in-period is a separate subset,
  never a substituted invoice date.
- `BOOKED` and `DISMISSED` are not unresolved. Unposted review drafts are not
  accounting evidence and their draft dates do not establish the source year.

Counts are not amounts and do not certify original integrity. Missing originals
and uncertain historical payments are derived exclusively from the existing
package manifest's original counters and `PAYMENT_DATE_UNCERTAIN` warnings.
They are not independently recomputed. Unknown payment dates are not zero
payments. Package context may include invoices/payments outside the period;
the guide explicitly retains that limitation.

The task response is a separate time-stamped snapshot from the package preview,
not an atomic financial statement. The UI requires both responses before
review. Opening a task and returning requires a refreshed preview. The refresh
button clears approval. The original ZIP download still sends
`expectedFingerprint` and a changed source still returns 409; no guard or
accounting adapter is replaced. Incoming unbooked items remain excluded from the
ZIP and are not part of its fingerprint. A newly arriving inbox item alone does
not invalidate the package fingerprint; refresh tasks before a handoff.

## Manual receipt note

`GET/POST /api/handoff-acknowledgement` use the validated current user; POST is
origin protected and bounded to 2 KiB. The accepted identity is only `from`,
`to`, `sourceFingerprint` (64 lower-case hex characters), and `formatVersion=1`.
POST also requires `selfRecorded=true`. Unknown keys, invalid periods and
unsupported versions are rejected. No arbitrary recipient, message or private
payload is stored or transmitted.

An explicit user action creates a required (not best-effort) AuditLog write:

- `action: REVIEW`, `entityType: AccountantHandoff`
- `entityId: {from}:{to}:{sourceFingerprint}`
- `entityName: Manuelle Empfangsnotiz`
- bounded metadata: `operation: SELF_RECORDED_RECEIPT`, the identity above and
  `acknowledgement: USER_RECORDED_NOT_VERIFIED`
- timestamp: server-created `createdAt`

The UI enables this optional action only after it has started a ZIP download
for this preview, and separately requires the user's own confirmation of an
outside-of-Bivaro receipt check. This is a self-recorded assertion, not proof
that a download completed, that another person received it, or that the package
was accepted. The endpoint does not pretend to verify a client assertion.
Nothing is emailed, uploaded or delivered to a third party.

Identical POST retries are idempotent: an atomic SQLite insert-if-absent statement
inside the existing serializable/retry transaction helper preserves the first
retained note. This does not rely on a check-then-create sequence or a process-local
mutex for cross-client safety. First creation returns 201; replay returns 200 with
`replayed=true`, without advancing the receipt timestamp. If all prior notes were
removed by retention or restore, a later deliberate action creates a new note;
there is no claim of permanent deduplication across removed history.

GET returns the first retained timestamp for the **same user, period and
fingerprint**, or null. Null means no note is currently available, not proof
that no handoff ever occurred. Notes inherit the existing audit-log retention
and backup/restore limitations. They are not included in the accountant ZIP,
and this feature does not promise a permanent record or a guaranteed restored
receipt history. Users must keep independent external receipt evidence.

## Scope and verification boundary

No schema, incoming mutation, payment calculation, EÜR adapter, DATEV mapping,
ELSTER submission, tax return, certification or host configuration is changed.
Warnings remain reviewable exports, not silent blockers or completeness claims.
Focused contracts cover tenant isolation, date boundaries, unresolved/unknown
versus zero, bounded examples, strict receipt input, origin/size/auth rejection,
required-write failure, sequential/ambiguous retries, independent-client concurrent
deduplication and honest guide rendering. The isolated browser journeys
cover source-review/back/refresh, ZIP/manual note/reload, empty unsupported year,
readiness retry and stale-preview 409. Hosted browser acceptance is a separate
release gate; test-source existence is not a claimed browser pass.
