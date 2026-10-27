# MCP LAN server — implementation and verification, 27 October 2026

Implemented against main `8470cf46e347dfec4146590792949aebe8aae107`:
stateless official-SDK Streamable HTTP; explicit MCP-only API keys; optional JWT
OAuth resource server; exact tenant ownership; 27 closed business projections,
validated invoice/payment reads, original byte chunks, five separately enabled
write tools, expiring/revocable key UI, opt-in Compose configuration and LAN guide.
No schema migration or business-record backfill. Defaults: MCP off, writes off.

Actual local evidence, Node 24.22.1:

- 191 tests passed in 9 focused suites: MCP transport/data/auth/key management,
  existing API auth/boundaries, payment journal/adjustments, request security and
  browser selector. All database tests use fresh temporary SQLite fixtures.
- Production Next build, TypeScript and zero-warning ESLint passed.
- Dedicated production-server browser/real SDK journey passed on isolated port
  3197. Read-only denial, explicit writer, real synthetic contact write, immediate
  revocation, no financial records, desktop/mobile screenshots verified.
- Base, Docker Hub and combined production Compose configurations passed
  `docker compose ... config --quiet`; no resolved secrets printed.
- No financial/security assertions removed, fixture or production isolation
  weakened, or retry/timeout inflated.

The additional shared focused-core attempt on local port 3198 was refused by its
existing GitHub-Actions/exact-port-3100 guard **before account writes**. That guard
is unchanged. This is not a passing shared core/hosted CI claim. The new explicit
selector maps the MCP packet to core plus its one real SDK/browser journey and
retains fail-closed handling of unrelated/missing critical evidence.

OAuth signature/issuer/audience/type/expiry/client/subject-binding tests use real
synthetic signatures and a test JWKS. A real external identity provider has not been
configured or certified; key authentication is the operational default.

Productive activation was explicitly requested after the isolated verification.
Deployment evidence and runtime checks are retained separately on the server and
in the task's local artifact directory; synthetic test results do not imply a
production financial write.
