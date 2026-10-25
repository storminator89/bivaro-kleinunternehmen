# Catalogue selection freshness — issue #168

Source base: `2007534a64e6a486b99233dc5e8cd9b1b7e39c17`.

Every explicit open/retry invalidates the preceding read/selection generation
synchronously and clears selectable rows before React commits. Closing and
unmounting invalidate old callbacks; obsolete read effects abort their consumed
fetch signals. A successful response must satisfy the existing canonical
`readServiceArticle` contract. Loading, HTTP/parse/shape errors and closed states
cannot expose an older price as an actionable current catalogue entry. Errors
offer an explicit read-only retry, never a document write.

The current successful row still copies the same explicit net cents into the
draft editor and reports the same source tax. Invoice, quote and service-plan
callers retain their own tax-mode/issuance rules and existing document positions
are never rewritten by a catalogue refresh. This does not add a shared cache,
change accounting policy, solve every workspace's session boundary, or claim
live financial execution. The read generation is component-local.

Authored pure/model/SSR sources cover generations, queued stale row callbacks,
unmount, exact price data, malformed responses and the initially closed surface.
Three authored real-browser journeys exercise invoice, quote and service-plan
controls with real fresh-fixture catalogue rows and unchanged successful backend
responses: successful copy, reopened held read
with no old action, cancellation/reopen with a newer price, late retired read,
503 without old actions, retry and preserved document-owned zero tax. The test
updates only its fixture catalogue to model independent price changes; held
responses are checked against that row and price before delivery. They use
the standard fresh fixture, real UI authentication and block every mutation
HTTP calls; no saved document/plan/booking is asserted from draft price changes.
After login, auth diagnostics are blocked and counted as unexpected writes too;
they are not exempted. Every fresh document's actual session response is read
and checked for the expected owner, role and sessionVersion before the fixture
initiates another navigation.

Eleven bounded pure/model/SSR regressions passed in 299 ms with installed
Vitest, one worker, no cache and a 512 MiB V8 heap limit. No local browser,
server, database, network or API operations were executed. Scoped ESLint over
the four TS/TSX files (zero warnings), changed-root plus transitive TypeScript
and `git diff --check` passed; no full project build is claimed.

Exact-head hosted collection/full CI and the three real-browser journeys
remain required; the narrow in-memory pass is not functional acceptance.
