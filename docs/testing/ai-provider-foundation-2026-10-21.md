# Optional AI provider foundation — source verification

Base: 352a35f2e241016cc6c1a83cc0891724cf2a2bf9. Source-only; not deployed or hosted-accepted.

## Verified
- Prisma client generation succeeds against schema containing the additive provider migration. Both `node_modules/@prisma/client` and `.prisma` are private copies resolving within this worktree; no shared generated client was written. Generation used explicit unused `/tmp` database URL; no database opened or migrated.
- Focused mocked policy/crypto/settings/transport/API tests: 56/56 passed, one worker. Synthetic credentials only; mocked DNS/HTTPS, zero external provider or paid requests.
- Focused ESLint passes for provider modules/routes and tests.
- `git diff --check` passes.

Coverage: disabled default and separate automatic-upload opt-in; explicit key keep/replace/remove and version conflicts; random configuration revision; tenant-bound AES-GCM and missing-secret failure; private/special IPv4/IPv6 and mixed DNS rejection; exact operator-allowlisted HTTP/private endpoint support; DNS address pinning; no redirects/retries; request/response caps; cancelled pre-dispatch requests; authenticated tenant-only/CSRF routes and stale opaque revision rejection before paid calls; static provider error redaction and charging uncertainty.

## Limits
- One bounded full TypeScript check with 768MiB heap failed by resource exhaustion (exit134, heap OOM, ~18s). It was not retried. This is not a successful typecheck and not evidence of a source type error either.
- No native fullbuild, local/browser functional tests, real credentials/provider calls, persistent runtime configuration, GitHub CI, push, merge or publication performed.
- Integration must include explicit AI backup capability identity and extraction provenance. Provider settings/ciphertext are excluded entirely; target configuration must remain target-owned during restore. Independent integration review and hosted acceptance remain required.

API subset and operator policy: see `docs/ai/provider-contract.md`.
