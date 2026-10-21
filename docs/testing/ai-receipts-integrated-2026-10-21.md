# Optional AI receipt integration — local evidence, 2026-10-21

## Frozen inputs and reconciliation

- Accepted photo/annual/EÜR source: local `437f627eb27b0f33c99aac89695831c641c03199`, tree `639173cd7f5fd3848eb5e0925647a4dcbde8b353`; independently confirmed equivalent to accepted main `e5398712700dac38baa5333f8d3922777eafef07` after PR #78.
- Provider: `a485ed0baae45992e1a6a822648eda2407217750` then `18ac5bc8f554ab07e0ada74a8aeb0d2098e709a4`.
- Extraction: `36163c32faa01887a1af63daed3b17587e639062` then deadline fix `05f4e15545e89c1d9584b56cfe3cfe122002950e`. Its ancestors `340fff7`/`ab7676c` contain the same provider sources, so they were not reapplied.
- UI: complete seven-commit chain `71b0c95` → `88f9e41` → `cc72da0` → `58a67b8` → `168b31a` → `2b9bb91` → `6e2d45eadab52f9823407c59b368e13fb40f6a46`.
- Sole cherry-pick conflict: public help. Kept accepted dynamic supported-EÜR-year text, added reviewed optional AI destination/cost/manual-approval disclosure. Provider and extraction runtime/API files remain byte-identical to their reviewed source tips.
- Additional integration changes: real backend journey test; preserve target provider settings under both merge and overwrite restore; explicitly retain standalone 054/061/070, combined 080 and additive AI 091 backup capability identities; exact two AI screenshot additions with count derived from the allowlist.
- Existing EÜR implementation files are unchanged. Original-backed approval → real EÜR handler/SQLite regression, full original ZIP/restore and concurrency evidence remain in the focused suite. Historical `docs/backlog` files are untouched.

## Verification actually executed

- Private Prisma Client generation passed. Both `node_modules/@prisma/client` and `node_modules/.prisma` are real worktree-local directories, not shared symlinks. Generation used an explicit temporary, generate-only `DATABASE_URL`; database suites each create their own fresh temporary migrated database.
- Final focused single-worker Vitest run: **25 files, 415 tests passed**, zero skipped in this run (25.39 seconds). Suites: all ten `ai-provider-*`/`ai-receipt-*` files; photo/annual capability registry; annual business context backup; purchase expense approval; purchase document backup/intake/summary; incoming-document UI; billing-note/fiscal-profile/payment-journal/partial-payment backups; EÜR 2026 contract/line mapping/export accounting/year route.
- Scoped ESLint on every changed TypeScript/TSX/MJS file: zero warnings. `git diff --check`: clean.
- Playwright **inventory only** (`test --list`, with supported temporary fixture path): **62 cases in 12 files**, preserving accepted **39 bootstrap + 22 dependent**, plus one mocked AI UI contract case. Initial inventory attempt used a deliberately incompatible temporary directory prefix and failed the fixture guard; rerun used the supported `bivaro-e2e-` prefix. No browser, web server, build or fixture migration ran for inventory.
- Screenshot workflow exact union: accepted **17** names plus `ai-receipt-settings-desktop.png` and `ai-receipt-review-mobile.png` = **19**. Executed the actual isolated staging script against harmless PNG-signature fixtures: accepted all 19; rejected duplicate basename, symlink, combined size above **5 MiB**, and non-PNG input. Existing inode/path/no-follow guards and **one-day retention** remain. These staging fixtures are not visual screenshots and do not prove image appearance.

### Actual backend journey (not API-intercepted UI evidence)

`lib/__tests__/ai-receipt-journey.test.ts` executes actual settings GET/PUT/test and receipt extraction/apply/review-draft/upload route handlers, real SQLite migrations, storage, encryption, SSRF policy and HTTP transport. Only the authenticated identity seam and Prisma connection location are mocked. A bounded HTTP mock server binds a random loopback port; the exact base URL is operator-allowlisted only in this test process, restored on teardown. No production test bypass, real provider key/account or paid request is introduced.

Five cases passed, also included in the final 415:

1. Disabled/auto-off defaults; masked no-store DTO; encrypted key at rest with tenant-bound AAD; other tenant sees no settings; missing paid consent/stale opaque revision rejected without dispatch; actual saved `/synthetic-v1/chat/completions` endpoint receives only a synthetic connection prompt, `store:false`, `stream:false`.
2. Other tenant cannot analyze the owned original. Exact server-known original bytes go via data URL; a validated reply fills only an `AI_UNREVIEWED` draft, leaves payment/note empty, and reuses completed work without another provider call. Original bytes/hash remain unchanged.
3. A manual draft save during a held real HTTP response survives completion; explicit free apply fills only empty fields, preserving supplier, amount, note and payment date without another provider call.
4. Enabling analysis is not automatic-upload consent. Opt-in applies only to a new suitable upload; replay/exact duplicates do not pay for more calls. Upload remains archived and unposted.
5. HTTP 503 becomes durable `unknown`, redacted error content, no draft fill and no automatic retry. Status/read/repeated request reuse that outcome; only explicit consented retry starts a second request.

Every case asserts no Expense, Income, cash transaction, Invoice or payment-journal rows, and no synthetic key in audit records. Separate extraction lifecycle tests retain overall-90-second expiry, durable unknown and late-reply rejection evidence; provider/input tests retain single-attempt 30-second transport and four-page/prlimit PDF limits. The backend journey uses a provider failure rather than waiting for a real 30-second timeout.

## Deliberate verification limits and next gate

No local native build, full typecheck, browser execution, new GitHub CI launch, Docker build, remote write, merge or deployment was performed. No real provider network call or compatibility certification. The added browser case intercepts AI APIs and remains UI-contract evidence only; it is not the backend journey above. Root review of the exact final commit/tree, followed by the separately authorized external acceptance/publication process, is still required. This document records local implementation/integration evidence, not hosted runtime acceptance.
