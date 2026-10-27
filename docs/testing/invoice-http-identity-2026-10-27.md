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
