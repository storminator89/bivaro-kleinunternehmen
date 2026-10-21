# Manually confirmed invoice/quote email outbox

## Scope

The first durable outbox slice covers explicit invoice and quote email sends.
The existing wholly unpaid reminder path remains unchanged and outside this
outbox. Payment-evidence/partial-balance reminders stay blocked from SMTP until
a separate fresh-balance/version integration is reviewed. There is no worker,
scheduler, automatic retry, bulk-send endpoint, new provider or tracking pixel.

`ACCEPTED` means only that SMTP acknowledged submission. It never proves inbox
delivery, reading, payment or other financial effects. Partial recipient acceptance
is marked separately and does not permit replaying the whole envelope. SMTP cannot provide an
exactly-once guarantee. In particular, a lost connection after submission may
leave the result unknown even when the recipient eventually receives mail.

## Confirmation and immutable source

The email preview returns the owned original's SHA-256 and an opaque tenant
storage scope. The manual send command supplies a UUIDv4 request key, the reviewed
hash, sender/reply-to, and reviewed recipients/subject/body. Changed original
bytes or a changed first-send sender require a new preview/confirmation.

The tenant-owned `EmailOutbox` envelope stores the document reference, original
hash and file reference, sender/reply-to, recipients, subject/body and semantic
fingerprint. It stores neither SMTP credentials nor a copy of transport settings.
The original file must still exist, belong to the tenant and match on retry.
Retries use the stored envelope, not newly generated text or current sender
settings. Connection/authentication settings remain target-owned and current.

Database uniqueness binds both tenant/request key and tenant/fingerprint.
Different client UUIDs cannot simultaneously submit the same envelope. SQL
triggers reject envelope mutation, evidence deletion and attempt-identity changes.

## State and attempt journal

- `PREPARED`: confirmed envelope durably stored; no attempt claimed yet.
- `PROCESSING`: a compare-and-set claim and its attempt row committed before SMTP.
- `ACCEPTED`: SMTP submission acknowledged; no automatic repeat is permitted.
- `FAILED`: explicit negative acknowledgment or known pre-handoff failure.
- `UNKNOWN`: submission may have happened; never automatically repeated.
- `CANCELLED`: an unsubmitted/rejected envelope's original was explicitly replaced
  during destructive restore. This does not cancel mail already submitted.

A retry appends a UUID-keyed attempt; replaying that retry key cannot submit again.
An unknown result requires an explicit duplicate-risk acknowledgment. A previous
unknown marker survives later outcomes, including an acknowledged retry that
fails. The next retry still requires that acknowledgment. Altering the body or
using a new request key cannot bypass an unresolved unknown result.

A processing lease expires after two minutes into `UNKNOWN`, never back into a
sendable state. Reads may record this recovery but never contact SMTP. The whole
outbox SMTP operation has a 45-second deadline using an AbortSignal-bound actual
TCP socket; the existing implicit TLS / required STARTTLS / TLS 1.2 policy remains
in place. Closing the socket cannot undo already accepted data, so timeout remains
`UNKNOWN`. No claim of safe retry follows merely from an abort.

Late outcomes may refine their own attempt but cannot overwrite a newer attempt's
current state. The immutable uncertainty marker and duplicate-risk acknowledgment
remain in history. The document list is bounded to 30 envelopes and prioritizes
unresolved risk before newer accepted records. Exact total and unresolved counts
remain visible when additional rows exist; the subset never claims to be complete.
Accepted state is persisted before the invoice status/audit
projection. A failed projection does not invite another SMTP send. A detached or
newer outbox attempt cannot update a replacement document's status.

## Backup and restore

Standalone schema identity `20261022000000_durable_mail_outbox` adds an explicit closed
`emailOutbox` capability and excludes both operational models from portable
business backup coverage. Earlier schema identities retain their exact prior
capabilities. The additive `20261022020000_combine_projects_outbox` identity
combines this capability with accepted project/service-duration capture; the
project-only `20261021160000_add_project_service_times` never gains outbox coverage
retroactively, and the outbox-only identity never gains project fields. Importing outbox/attempt arrays is rejected, including legacy imports.
A business backup does not claim to contain or restore the email attempt history.

Target-side history is never erased. Destructive overwrite marks running attempts
unknown, cancels prepared/definitely failed envelopes, and detaches all historical
invoice relations before replacement. Immutable source IDs/hashes remain evidence.
Nondestructive merge does not cancel unrelated target sends. Detached historical
receipts are shown only after resolving the tenant-owned current original and
matching its SHA-256 and document type. A retained unknown risk still blocks a
fresh envelope after numeric IDs change. Detached uncertain sends cannot be
retried or automatically rebound by this slice; a separate explicit reconciliation
contract is required. An accepted historical receipt is not a restored sent status. Neither restore nor
opening a page starts, resumes or schedules a send.

## Verification boundary

Integration tests use fresh temporary SQLite databases, synthetic documents and
mock transports only. Loopback socket tests verify actual abort closure and
STARTTLS stripping rejection without authenticating or transmitting a message.
Browser acceptance uses an isolated user and real stored synthetic invoice PDF,
but intercepts all email mutation APIs. It proves UI recovery/confirmation behavior,
not a real provider send. Production build, exact-candidate CI and rendered browser
acceptance remain separate gates; focused unit tests alone do not mark issue #88
fully delivered.
