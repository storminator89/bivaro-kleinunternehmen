# Internal owner version surface (#85)

This internal layer is **not public online consent**. Its server-only
`BIVARO_INTERNAL_QUOTE_CAPTURE` gate accepts only the exact value `1`; absence
and all other values disable both methods and hide the dashboard controls. No
setting is enabled by this change. It requires the inactive persistence/backup
foundation with required timestamps and all retained SQL protections.

## Boundary and data

`/api/quotes/[id]/releases` derives ownership from the validated current session.
GET uses a bounded read transaction only: no authority creation, audit, files or
rate-limit bucket writes. It returns the latest 20 redacted versions, total count,
exact revision/current-pointer/source guards and receipt-bound eligibility. It
never returns private source JSON, original paths or customer contacts. Missing
or changed modern receipts do not become eligible. This does not support every
legacy quote; original bytes are verified again during capture, not by GET.

POST is protected by the existing origin/body guard, a 4 KiB JSON limit, owner
rate limit and nonqueued processing capacity. Its exact owner-free body contains
only expected guards, explicit expiry and reason. It invokes the internal service
once and returns six internal receipt fields. Mandatory capture audit/CAS rollback
and initial preflight-audit retention remain the service's contract. The rate
limiter may write operational buckets; it never retries the capture. Requests
cannot select owner, archive, token, public URL or delivery target.

## Owner interaction and failure

The dialog is mounted only from the server-enabled, authenticated quote view and
keyed by session and quote. It clearly identifies internal evidence, no delivery, no
online access and no verified customer consent. Historical restored rows remain
permanently closed. The UI shows bounded history explicitly rather than claiming
the first 20 are the complete graph.
The new-version form is the single primary action; history and technical IDs/
hashes appear on demand. An uncertain write opens the history for deliberate
review instead of hiding the important exception behind routine detail.

No POST automatically retries. A synchronous gate blocks repeated clicks and
pending closure. Late/aborted GETs and changes in quote/session cannot repopulate
old state. A 401 immediately removes history, receipt, private draft inputs and
quote label and requires reauthentication. Network,
5xx or malformed-success uncertainty latches: an explicit fresh read and owner
review/acknowledgement are required before a deliberate new attempt. Matching
hashes never prove that the prior request succeeded. Known conflicts also require
a new read, not replay of old guards. A write-ahead uncertainty bit in same-tab
session storage is scoped to exact owner-session/quote identity and set before
POST. It retains no source, draft, hash, archive, credential or raw token content.
Closing, tab navigation and reload cannot clear it. Storage failure disables
capture rather than falling back unguarded. Only an exact confirmed receipt, or
an initial known rejection without prior uncertainty, may clear the bit. A GET
alone never does. Independent tabs/clients and a new owner session are outside
that browser latch's scope; database CAS still applies. Closing and reopening
starts a fresh read, not a retained or automatically retried command.

## Bounded evidence and remaining gates

Focused mocked tests cover state ownership/redaction/read-only delegates, actual
mutation-wrapper origin/body rejection, derived-owner POST controls, error
redaction and the pure client uncertainty gate/transport contract. Focused types
and lint are separate from browser/HTTP proof. The synthetic service fixtures
prove only their stated SQL-clock/CAS/audit/original slices, not actual login,
browser rendering, concurrent recipients, valid real PDF content or legal consent.

No public capability/token/response model consumer, raw token, recipient DTO,
email/link delivery, external access or financial transition is created here.
Authentication/UI/native route composition and production migration/recovery
acceptance remain explicit later gates before any enablement. The owner-only
surface is separate from the inactive persistence/backup foundation.
