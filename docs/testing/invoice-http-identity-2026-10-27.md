# Invoice creation on plain HTTP LAN origins — 2026-10-27

## Cause and fix

The invoice editor previously used `crypto.randomUUID?.() ?? null` to establish
its stable generated-upload identity. On HTTP LAN origins, `randomUUID` is not
available, so the editor omitted `generatedRequestId` while still transmitting
`paymentTermSelection`. The upload handler correctly rejected that combination.

The editor now uses `createBrowserRequestId`. It prefers native `randomUUID` and
otherwise creates UUID v4 from 16 cryptographically random `getRandomValues`
bytes, setting the UUID version and variant bits. `getRandomValues` works outside
secure contexts. No `Math.random`, authentication, CSRF, payment-term validation,
upload fingerprint, tenant or replay protection was weakened. The identity stays
stable through retries and is renewed only when the existing editor reset runs.

Scope: ordinary invoice creation; other browser features that directly call
`randomUUID` have not been changed or certified by this fix.

## Verification

- Four focused unit/integration suites: **110 passed**, including 45 payment-term
  API and ten upload-idempotency cases, UUID fallback and focused-browser mapping.
- Real standalone Chromium journey: **one passed**. The test removes only
  `crypto.randomUUID` before application code runs, retaining actual browser
  `getRandomValues`; loopback itself is a secure context, so this reproduces the
  missing API rather than claiming a native insecure-origin browser test.
- The browser really creates and stores XML through the production upload route.
  The harness replaces only the first committed response with a synthetic 503.
  Retry retains the same UUID and returns the same invoice idempotently. The
  original row and number counters remain unchanged; no Income/payment is made.
- `npm run lint` and `npx tsc --noEmit`: passed. The supported E2E runner built
  production Next.js, migrated a fresh temporary fixture and removed it after
  execution; `reuseExistingServer: false` and zero local retries were retained.
- Build succeeds with the existing nine tracing warnings in unrelated paths.

The first restricted integration attempt could not spawn Prisma (`EPERM`); all
110 checks passed with the required local worker permissions. The first browser
fixture lacked the mandatory XRechnung seller telephone, so client validation
correctly prevented upload. The fixture was corrected and the journey passed;
no production validation, timeout or assertion was loosened.

Deployment verification is recorded separately with the private server release
receipt. Existing invoices and issued files must not be rewritten by deployment.

## Production deployment

Runtime commit `56be237d6b0f47b8a78ba660afe5544ff04bef84` is active on the LAN
server as `bivaro:http-invoice-56be237`, image ID
`sha256:fb86e80d020fdac7667241516d9e81f5fd0046357502b56aae48f8a29f81173a`.

The clean allowlisted runtime excludes `.env`, databases, uploads and backups.
The existing native runtime and one-page layout are retained. Preflight against
an isolated data copy passed all 65 migration checksums, integrity/foreign keys,
old-column and original-file preservation plus MCP read-only boundaries.

A fresh network-isolated server container passed real registration/login,
settings, dashboard, PDF preview and final PDF/A rendering. Both PDFs have one
page with four positions and GiroCode. A real final PDF upload with MANUAL
payment-term provenance succeeded, and replay returned the same invoice;
exactly one invoice and no Income/payment/expense were created in that fixture.

Deployment held the shared updater/cleanup lock and verified a consistent
database backup and persistent-volume archive before switching. Production is
healthy; login and five static assets return 200. Database values, original files,
volumes and existing environment were preserved. MCP is enabled with writes
disabled. Private backup/receipt: `/opt/bivaro/releases/20261027-56be237d6b0f/`.

The authenticated production invoice editor was also opened read-only through
the real `http://192.168.0.126:7689` origin. It loaded the company tax profile,
customer choices and next number without failure; no production invoice was
created during that browser check. Already-open pages require reloading to use
the updated client code.
