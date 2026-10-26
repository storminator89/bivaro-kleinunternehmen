# Early delivery of public-fragment failure diagnostics — partial #183

This packet preserves diagnostics, not a product fix. It combines the unchanged
failure-only observation from draft #205 with the additive early receipt from
draft #210, then adds a separate, bounded public-fragment artifact. Diagnostic
checkpoint #186 and the published #205/#210 heads are not replaced.

## Observed delivery failure

Browser run 40279289102 failed its functional step at 06:57:18 UTC on
26 October 2026, then continued the existing screenshot stages. The public job
annotation confirms that it exceeded the maximum execution time of 45 minutes;
the job was cancelled after a displayed 55 minutes. Decoded job-log requests
returned BlobNotFound, and the available run-log response exposed no archive
bytes. The public UI required sign-in to view logs. No cancellation by a person
and no particular functional failure cause is inferred from these facts.

Playwright's installed attachment implementation keeps `attach({ body })` as a
reporter Buffer. It does not write a standalone attachment file. The nine retained
artifacts were normal visual/final-byte partitions, not this diagnostic. Thus a
console/body-only snapshot does not establish durable delivery after a timeout.

## Narrow delivery contract

- Keep both original success journeys and their 22 awaited operations unchanged.
  There is no new successful-path geometry read, request, assertion, wait,
  forced scroll, retry or timeout change.
- The original failure is immediately rethrown. Its guarded post-failure hook
  still limits reporting to 750 ms and suppresses late results. That bounded
  wait does not cancel already in-flight evaluation or attachment operations.
- Observe only failing Chromium results from the exact public-help spec and
  its two exact JSON attachment names. Inspect at most two bodies of 16 KiB
  each; the complete separate artifact is at most 32 KiB.
- Validate an explicit versioned schema and reconstruct only allowlisted public
  observations. Keep finite bounded geometry/scroll/timing, fixed public
  path/hash and target labels, visibility/hidden/stream flags and transport
  status. Do not copy arbitrary text, identifiers, origins, raw URLs, error
  messages, stacks, headers, cookies, session bodies or environment values.
- Use a fresh, privately owned runner-temp directory outside the disposable
  application fixture. Bind every output to the public head, run and attempt;
  write atomically and emit paths only after a successful safe write.
- After the suite, reject stale, malformed, oversized, unsafe or inconsistent
  files. Produce a new schema-safe unavailable/incomplete result instead of
  uploading rejected input. Missing/late snapshots and overflow remain explicit.
- Upload only `public-fragments.json`, separately from the general receipt,
  immediately before the original PDF/image stages. The optional steps are
  bounded to one minute each and one-day retention. They cannot make the
  required functional step or any required evidence gate pass.

## Preservation and verification boundary

The original GitHub/progress reporter, runner exit and cleanup, all browser
cases, security/native obligations, trace-off policy, all 256 images, budgets
and failure/cancellation stages remain. The strict additive inverse must still
reproduce the full 103,071-byte baseline workflow and SHA-256
`18f4700c90176f53ce97257fda3b05e8332a30c57ae68c7b2841d4551d3b0249`.
Raw screenshot and security guards are not normalized away.

Required local checks are pure/mock privacy, malformed/overflow/IO/status
regressions, exact successful-operation AST comparison, scoped types/lint and
independent source review. No local browser/server/database/native execution is
part of this packet. Full automatic hosted verification and an actual downloaded
diagnostic artifact remain required. A delivered observation is not a root-cause
proof, a runtime remedy or acceptance evidence. Issue #183 stays open.
