# Incoming-original upload queue — issue #97

Date: 2026-10-21. Base: accepted `d9c26c21b12599020bf1d4d547d58ab965b6931d` (includes #93 minimal copy and #94 health heap limit).

Status: **implemented locally; independent and root source reviews accepted. Exact-candidate hosted build/CI/browser evidence and publication are still pending.** No completion or production-deployment claim.

## Scope and safety contract

- At most 20 selected files / 100 MiB aggregate, checked before file-content reads. Existing lower JPG/PNG 10 MB / 24 MP, PDF 25 MB and XML 8 MB limits remain. Mixed unsupported/empty/oversize originals get per-file errors; valid originals wait for the user's explicit upload click.
- Sequential existing `POST /api/purchase-documents` calls, one immutable original per request. Stable UUID per selected file survives targeted retries. Existing server tenant/request/hash uniqueness and replay semantics are unchanged.
- Rows distinguish queued, sending, saved, existing, failed, unknown and cancelled. Only retryable failed/unknown rows can retry; completed rows are never sent again. An ambiguous network/5xx/malformed outcome pauses new starts. Remaining rows require a separately labelled deliberate continuation, never a retry of the uncertain original. Conscious same-request reconciliation can return the already-saved original.
- Cancel stops new starts and aborts the current browser request, but labels its result unknown: it never promises server rollback. Completed originals remain archived. Late progress/results from cancelled, cleared or old-account generations cannot update the replacement queue.
- No file bytes/names/UUID queue state in persistent browser storage. Reload requires a new selection for unsent files; archived originals remain in the existing server list. Logout/account identity changes synchronously invalidate and silently dispose the queue in layout-effect cleanup before passive effects; deferred results cannot start the next file or notify the unmounted owner. A 401 clears all queue details immediately, including earlier success filenames.
- Multiple selected files always send `analysisMode=manual`. The server accepts only this exact optional opt-out (no automatic/consent mode and no duplicated field); its intake guard bypasses the automatic provider import/call. Single-file/photo intake retains existing explicit global AI opt-in behavior. Replays never enqueue paid work. No new provider, charge, schema, accounting, backup/restore or validator behavior.
- Batch success refreshes the list without opening review dialogs over an active queue. Each saved/existing row links to its original review. Existing single-file/photo auto-open is preserved. Keyboard retry/cancel/clear and review dismissal have explicit focus destinations; status and error text are accessible without relying on color.

## Local evidence

- `npx vitest run lib/__tests__/incoming-upload-queue.test.ts lib/__tests__/purchase-upload-analysis-mode.test.ts lib/__tests__/ai-receipt-extraction.test.ts lib/__tests__/incoming-document-ui.test.ts --maxWorkers=1`: **68/68 passed** (4 files).
- `npx eslint . --max-warnings 0`: passed after implementation and E2E source additions. Subsequent focus-only change passed focused ESLint.
- `npx tsc --noEmit`: passed after all implementation, E2E and focus changes.
- `git diff --check`: passed.
- `npm run test:e2e -- e2e/incoming-upload-queue.spec.ts --list`: passed (3 new scenarios plus 39 bootstrap dependencies; listing only, no browser execution).
- Existing Prisma schema generated only into private real `node_modules/@prisma/client` and `.prisma` directories in the feature worktree. Canonical shared generated-schema SHA-256 remained unchanged. All integration tests use fresh temporary fixture databases; no repository/production database is used.
- Upload-related `proxy.ts` and `next.config.ts` inspected: `/purchases` remains protected, `/uploads` remains blocked, API auth/mutation guard and private/no-store headers remain unchanged.
- `npx vitest run --maxWorkers=1`: **160 files passed, 1 skipped; 1968 tests passed, 1 skipped** (201.07 s). At first candidate `57e32ae`; after review hardening, focused 68-test queue/route/AI/UI suite re-run: passed.

## Hosted acceptance still required

New `e2e/incoming-upload-queue.spec.ts` uses only runner-owned synthetic users and originals. It covers:

1. Mixed valid/invalid selection, no upload before click, exact bytes renamed as a duplicate, commit followed by lost response, same UUID deliberate reconciliation, no second original and no financial rows.
2. Cancel after durable server commit, no next start, late response ignored, same-request replay, keyboard and clear-focus return.
3. Session expiry after two successes, no fourth request, immediate queue-detail clearing, real logout/login to another fixture account with no old queue or original exposure.
4. Reload/no browser persistence, 20-file and 100 MiB aggregate rejection before HTTP, desktop 1440 px and mobile 360/390 px horizontal bounds, keyboard review opening/dismissal and focus return.

One **normal-viewport** proposed PNG: `incoming-queue-mobile-390.png`. Integration now adds only that one basename to the accepted 35-image allowlist (expected hosted count **36**). Staging derives its expected count from `len(allowed)`; there is no separate literal-count assertion in source. No existing PNG is replaced, removed or downsampled. The 5 MiB aggregate evidence cap remains unchanged.

The existing single-photo interruption test's retry label now names the deliberate action, `Mit gleicher Anfrage abgleichen`; its remaining photo/draft/export acceptance stays unchanged.

No local full Next build or browser run was started because the parent reserved resource-heavy acceptance for hosted review/CI. Before root integration authorization, no workflow, remote branch, PR or deployment was changed. Root then approved the one-basename workflow addition only; remote publication and deployment still require the parent gate.


## Accepted-main integration gate

Root approved integration onto accepted `45acf16e662a3dbf67ebd3fd79b414478f92a199` after #92 merged. The two reviewed queue commits were cherry-picked without conflicts; all queue/API/test blobs remain identical to reviewed `9eb97ddbfa7a9975088175e2ac3ff5c8dbe4b7d5` apart from this evidence document. User #93/#94 and the complete accepted project/time/backup/schema changes remain unchanged from main.

- Focused integrated queue/route/AI/UI plus project duration/routes/backup regression: **125/125 passed**, 7 files, single worker. Lossless evidence helper: **2/2 passed**. Full ESLint, TypeScript and diff checks passed on the integration. Private Prisma generation against the accepted schema changed neither canonical nor project-owner generated schema hashes.
- Workflow delta is exactly one allowlisted basename; all prior 35 remain. Expected delivered count is 36. 5 MiB total cap, 16 MiB encoded input budget, safe-file/no-symlink/no-follow checks, metadata/full-pixel lossless proof, optional-upload behavior and one-day retention are unchanged.
- Independent source reviewer found no material findings at reviewed queue candidate; root source review accepted it for the next hosted gate. Hosted build/CI/browser/screenshot delivery and pixel inspection remain pending; no local native build or browser/OOM loop was started.
