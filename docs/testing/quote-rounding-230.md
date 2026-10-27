# Quote rounding #230 — prepared publication evidence

Publication authorized 27 October 2026; current provider main `7db6563afc228ab5b8c458446ac9df49d4f80875`, tree `d1444fa7f3d6ec8f79312437f036ae0ef2738050`.

The quote editor uses the existing shared invoice calculator for current UI totals, new PDF data and save requests. Invalid monetary input invalidates pending generation, cancels its timer and clears/revokes the stale preview; no general lifecycle refactor. Stored historical quote originals are not rewritten. No schema, migration, financial action or security-setting change.

Frozen runtime v2 patch SHA-256: `7c848d5fdc12cba89c67184753ab5425b222726e2f7fda3dda78902d207e9e24`. Separate browser packet SHA-256: `259c2d8d87cf4c235d2511d5a85ecb26c81b8ed01b4193a3200d4950d9509fdb`. Historical v1 patch is untouched.

Prepared-packet evidence: 15 focused quote/calculator tests, focused lint and TypeScript passed. Five independent real-PDF/save/XML fixture comparisons agree at 10.02, 11.92, 226.00, 0.07 and 2.00. This is not standards certification or browser acceptance.

Two authored synthetic browser journeys cover 0% and 19% half-hour rounding. They assert UI, saved totals, actual downloaded PDF text, stored-original byte equality and persisted totals after reload, while checking no invoice/customer/income/expense/payment/outbox/reminder effects. Fresh temporary database, `GITHUB_ACTIONS` and exact `127.0.0.1:3100` guards precede writes. They have not yet run. Existing API-key/CORS and other focused-selector registrations are preserved additively.

Automatic exact-head required CI, focused browser acceptance, conditional normal merge and terminal main/native/Docker publication remain pending. No local browser/server/database run, dependency installation, shared Prisma regeneration, full-suite dispatch or live installation deployment is claimed.
