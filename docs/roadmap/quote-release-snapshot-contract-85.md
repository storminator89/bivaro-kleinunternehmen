# Quote snapshot and response contract (#85)

**Partial, inactive foundation. No public electronic-consent feature is enabled.**
The pure contract supplies fixed identities and response planning. Persistence
and closed-history backup behavior are described in
[the integration notes](quote-release-persistence-integration-gates-85.md).

## Pure v1 contract

`lib/quote-release-contract.ts` exports no route, database client, storage,
network call, token generator, scheduler or financial write.

- `createQuoteReleaseSnapshot` accepts a numbered QUOTE source with known finite
  nonnegative total and exact supplied original bytes. It reuses the existing
  portable quote-create content fingerprint and separately hashes the original
  bytes. A domain-separated v1 snapshot hash binds both hashes and byte count.
  It does not regenerate, parse, render or certify a PDF, reconcile PDF text
  with metadata, recalculate totals, or decide fiscal/legal validity.
- The frozen reference contains only version, source fingerprint, original
  SHA-256/byte count and snapshot SHA-256. It is **not the original archive or
  recipient-view payload**. No customer/owner/local storage identifiers or
  manual follow-up fields are returned. Existing parsed source content remains
  part of its content fingerprint, not a source of public display permissions.
- Metadata copying rejects lossy/non-JSON values, accessors, symbols, hidden
  properties and sparse arrays. Work is bounded to 20,000 visited nodes,
  32 nesting levels and 512 KiB cumulative UTF-8 string/key content. Original
  byte size uses the unchanged 25 MiB invoice-upload ceiling. These new helper
  bounds change no existing endpoint's accepted input.
- `parseQuoteReleaseSnapshot` checks exact v1 shape and the recomputed binding.
  An attacker can recompute an unkeyed hash: **this is not authentication,
  authorization, provenance or an authenticity signature**.
- `parseQuoteResponseCommand` requires exact v1 fields, canonical UUIDv4 request
  and release identities, snapshot SHA-256, ACCEPT/REJECT and a nullable literal
  plain-text comment of at most 500 UTF-16 code units. Empty/padded/control-
  character comments are rejected, not silently normalized into a different
  command. Rendering/escaping remains a future recipient-UI obligation.
- `planQuoteResponse` only returns APPEND, REPLAY, CONFLICT or UNAVAILABLE. It
  receives an explicit server instant, already-authoritative release state and
  a separate target-owned `currentReleaseId` (UUIDv4 or null after invalidation).
  Current source/PDF hash equality is necessary but never establishes that an
  access release is still current. Missing/malformed release authority fails
  closed; null or a different current release suppresses APPEND and REPLAY.
  Exact command replay preserves the original receipt time; any other command
  after an existing receipt conflicts. Restored-disabled, revoked, expired,
  not-yet-active and replaced snapshot/release states disclose no prior receipt.
  Creation is inclusive and link expiry exclusive. Malformed or contradictory
  stored evidence fails closed.

**APPEND is an in-memory plan, not a persisted response or a concurrency
guarantee.** Two concurrent callers can both obtain a plan while no previous
receipt exists. A regression explicitly demonstrates this limit and the later
conflict once a real receipt is supplied.

## Authority and lifecycle invariants

- Authority uses a portable immutable UUID, owned nullable source binding,
  monotonic revision and nullable current-release pointer. Initial preparation
  creates an absent authority only; it never resets or deletes retained state.
- Every deliberate release gets a fresh UUID/generation. Source or eligibility
  changes clear the pointer and advance revision atomically, **even when already
  NULL**, so an outstanding capture cannot survive source A→B→A.
- Source-change triggers own that advancement; services must not double-increment
  it. Explicit replacement/revocation requires exact revision/current-pointer
  CAS. Int32 exhaustion fails closed, never wraps or resets.
- Immutable source/original bindings, generations and responses are retained.
  Equal hashes never select an old release again. Request and response identities
  cannot overwrite historical evidence, including through SQLite REPLACE.
- Customer deletion's indirect SET NULL and conversion-child insertion/update/
  deletion are bound changes too. Quote-column-only enforcement is insufficient.
  Recipient display must stay frozen, never rebuilt from a later live customer
  name/address lookup.
- Released quote deletion cannot remove history or originals. Canceled preparation
  without release evidence preserves a non-relinkable authority tombstone.
- Restore preserves history, never usable access. Newly imported authority is
  detached and its releases permanently access-disabled. Existing UUIDs require
  exact full immutable history rather than ancestor merging.

## Remaining public-feature requirements

Owner original-byte/capture-audit atomicity, issue/replace/revoke consumers,
authenticated recipient access, high-entropy hashed tokens, rate limits,
retention policy and secure confirmation UI remain separate gates. Only an
explicit protected POST may record a response; GET/prefetch/link scanners must
not. Business-date quote validity is distinct from link expiry and must not be
inferred by this planner.

A response service must read authority/release/source and persisted response,
apply uniqueness/CAS, and commit response plus mandatory audit in one serialized
transaction. A race must not blindly retry an opposite decision. Electronic
response, manual status and private notes remain distinct. No automatic invoice,
payment, revenue, SMTP delivery or guaranteed signer/legal-identity claim follows
from a hash or response. Production recovery, independent-client concurrency and
hosted recipient/accessibility acceptance are not established here.

## Bounded validation

The pure contract has 84 synthetic cases covering golden snapshot identity,
exact-byte/metadata changes, portability, bounded malformed inputs, replay/
conflict, time boundaries, same-content replacement and unavailable receipt
suppression. These are not database/API/browser or whole-application acceptance
checks. Persistence/restore evidence and limitations are listed separately in
the integration notes.
