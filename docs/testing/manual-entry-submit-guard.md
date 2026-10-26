# Manual capture submission guard — issue #169

Source base: `2007534a64e6a486b99233dc5e8cd9b1b7e39c17`.
Scope: generic new income/expense, generic edit and explicit duplicate only.
No schema, endpoint, server idempotency, amount precision/sign, business-date,
source-linked protection or manual-record finalization/correction contract changes.

## Local state contract

Each form owns an immediate, synchronous lease before the first await. Repeated
pointer/keyboard submissions share that lease. Pending fields and dialog
dismissal are disabled; values and the selected File are snapshotted before
sending. Generation checks and hook disposal prevent late responses from
changing an obsolete component. This is **not cross-tab, reload or server-side
idempotency**. Navigation cannot revoke work accepted by the server.

An accepted response is a nonredirected JSON success containing a positive
integer row ID (the same ID for PUT). Once accepted, a failed list refresh is
never reclassified as a failed save. New-entry drafts are cleared and the native
receipt input is remounted; edit dialogs close. The lease releases only in an
effect **after** the empty form/editor-close commit, not while an old form can
still submit. Ordinary subsequent new entry remains possible.

A stalled fetch/body is not an undismissable trap: the pending feedback offers
“Warten beenden / Liste prüfen”. This explicitly moves the lease to unknown
before aborting browser waiting. It does not cancel or roll back the server
operation. Its late response cannot overwrite a newer draft, and no replay is
enabled. The user can inspect the list and explicitly discard the local editor.

Transport errors, timeouts, 5xx, unsupported response shapes, redirects, malformed
JSON or mismatched IDs remain unknown. The draft stays locked. Only a read-only
list refresh and explicit local-draft discard are offered. A matching list row is
never used to infer this request's success. Discard does not undo server work;
it enters its own locked `discarding` phase and releases only after the cleared
form/file input or closed editor commits. No automatic write retry occurs.

## Why the recognized rejections cannot have committed a financial record

The classifier also requires a nonredirected JSON object with an `error` string.
Status alone is not enough, and no timeout/5xx/429 assumption is made.

| Status | Actual current control paths | Financial write boundary |
| --- | --- | --- |
| 400 | `incomes/route.ts` ID/amount/customer/date/tax parsing, POST 69–84 and PUT 219–240; `expenses/route.ts` POST validation 24–102/117–162 and PUT 275–327; `request-security.ts` 49–64 | Validation/body parsing precedes the service call. Typed service validation either precedes the transaction or throws inside it. |
| 401 | `requireUserId` is the first awaited route operation; `get-user-id.ts` 74–88/104–106 and each route catch return `unauthorizedResponse` | No mutation service was entered. |
| 403 | `protectMutation`, `request-security.ts` 44–46 | Origin guard returns before invoking the handler. |
| 404 | `income-service.ts` customer ownership 49–52 and update lookup 87–91; `expense-service.ts` current lookup 29–35 | Lookup/ownership failure is before mutation inside the transaction. The exception rolls back the transaction. |
| 409 | Finalized/source-linked/cashbook checks in `income-service.ts` 87–98 and `expense-service.ts` 29–40; `manual-financial-record-evidence.ts` 69–70 | The protected-record check throws before the update. Typed exceptions propagate through `inTransaction`; no postcommit 409 is manufactured. |
| 413 | `request-security.ts` 49–61; `expenses/route.ts` 24–25/72–88; bounded body parsing via `RequestBodyLimitError` | Size checks/body reads precede record creation/update. |

`lib/db-transaction.ts` returns only after `prisma.$transaction(work)` commits.
Income/expense creation/update and their financial audit entries are in that
same transaction. The routes then return the row; unexpected post-service errors
become 500 or an unhandled server error, **not one of the recognized rejections**.
Multipart receipt storage precedes expense insertion; failed input/service paths
attempt file cleanup. A possible orphan file is not claimed absent, and the
classifier's rejection promise concerns the financial record, not every possible
filesystem side effect. This patch does not rewrite that existing server path.

## Acceptance evidence

Unit/model, static-component and actual browser regression sources are authored
alongside this change. Runtime tests must be executed only through the authorized
hosted workflow using its fresh fixture. No local unit/browser/server execution
is an acceptance result. Pending gates: exact-commit full CI, actual collection
and pass counts, held-response one-POST/one-record browser journeys, unknown
outcome/no replay, discard commit barrier, receipt input reset, known rejection
retry and accepted-write/read-refresh failure separation.
