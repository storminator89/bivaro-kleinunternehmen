# Early browser failure receipt — partial #196

This is the diagnosis-lag slice only, not a cancellation/staging optimization.
No test case, original reporter, exit status, timeout, trace policy, screenshot,
native/security gate or existing failure/cancellation artifact stage is removed.
Issue #196 stays open.

## Why

The public #185 browser failure was emitted at 23:28:44 UTC on 25 October 2026,
but the complete job log became available after terminal completion at 23:46:50:
about 18 minutes later, after image staging. This is an observed diagnosis lag,
not a measured saving from this new implementation.

## Additive contract

- Keep the GitHub reporter and its automatic progress reporter. Add one sidecar
  reporting no standard-output ownership and never returning a suite-status
  override. The supported runner and its signal/exit/database cleanup are untouched.
- Write a fresh, privately owned runner-temp receipt outside the temporary DB
  fixture. Bind it to the public head SHA, run ID and attempt. Emit a directory
  output only after this invocation creates and atomically writes its own file.
- Checkpoint on begin, each result and global error; observe the terminal hook
  separately from complete case execution.
- An always-run optional finalizer immediately after the suite validates a
  no-follow bounded regular-file read and exact schema/identity/completeness.
  Missing, stale, malformed, oversized, unsafe or inconsistent inputs produce a
  NEW, schema-safe unavailable/incomplete receipt; raw input is never echoed.
- Include the actual functional-step outcome. Upload only receipt.json, before
  final-PDF rendering and every expensive image stage, with one-day retention.
  This optional diagnostic cannot make a failed, cancelled or incomplete suite
  pass. All existing image and final-byte delivery gates remain unchanged.

## Privacy and resource bounds

The maximum receipt is 64 KiB, with at most 64 failure entries and explicit
overflow/omitted counts. Only public identity, numeric counts, repo-relative
test-file location, an allowlisted project/status, and fixed hint tags are stored.
No test titles, raw errors, stacks, annotations, stdout/stderr, config, environment
dump, request/response bodies, credentials, user values or URLs are serialized.
Error-prefix inspection is limited to 4,096 characters for eight errors; tags
are hints, never a proved diagnosis. Outside paths/projects are redacted and
explicitly make the receipt incomplete. Optional reporting errors are swallowed
without changing the original suite result or exposing exception details.

## Status matrix

| State | Receipt semantics | Existing evidence |
| --- | --- | --- |
| Every planned case ended; terminal passed/failed | Complete execution, actual end status and functional outcome; never acceptance evidence | All original gates preserved |
| Failed cases, then cancellation | Retain already-checkpointed failures; incomplete/cancelled outcome | All existing always-run failure/cancel stages preserved |
| Interrupted/timed-out/unknown terminal, missing cases, global errors, redaction or overflow | Explicit incomplete; no clean/pass inference | Original failure remains authoritative |
| Startup/config failure before reporter begins | Fresh unavailable/incomplete receipt with actual step outcome | No raw errors copied; original logs/gates preserved |
| Missing/malformed/stale/symlink/nonregular/oversized/forged-completion input | Reject and build fresh schema-safe unavailable receipt | Never upload the rejected input |

## Frozen evidence workflow preservation

The workflow has four exact additive changes: a suite step ID, explicit public
head binding, one extra reporter, and the early finalization/upload block.
A strict inverse requires each reviewed addition exactly once. Removing only
those changes reproduces the entire accepted 103,071-byte workflow and SHA-256
18f4700c90176f53ce97257fda3b05e8332a30c57ae68c7b2841d4551d3b0249.
All eight historical prefix hashes and pinned lengths remain unchanged. Only
historical hash/length inputs use this inverse; screenshot names, budgets,
always-run delivery, native and security guards still inspect the raw workflow.
An independent whole-file inverse/round-trip and tampering test protects this.

## Verification boundary

Focused pure/mock reporter, status, privacy, overflow, IO and source-preservation
cases, scoped TypeScript/ESLint and diff checks are required before publication.
No local browser, server, database, installer or native execution belongs to this
packet. Full automatic exact-head CI/browser acceptance and a real early receipt
artifact are still required. No measured improvement, merge or deployment is
claimed from authored or mocked checks.
