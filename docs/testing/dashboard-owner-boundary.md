# Dashboard owner boundary — issue #180

Source base: `2007534a64e6a486b99233dc5e8cd9b1b7e39c17`.

The dashboard's QueryClient and all DashboardContent state now live under one
keyed client subtree. The key is the existing `reviewSessionKey`, including
authentication status, user ID, role and sessionVersion; expiry timestamps and
session-object identity do not change it. A normal authenticated session refetch
therefore preserves unsaved work. Replacement of an authenticated owner or
sessionVersion disposes the previous dashboard before a new owner's data arrives.

The retired QueryClient cancels signal-aware reads and clears its own cache
synchronously. It cannot clear the new owner's distinct client. Old form/dialog
state is unmounted, not copied or persisted. Query cleanup does not cancel,
reverse or deduplicate server writes. The component-local financial submission
cleanup from the independent #169 packet must be reconfirmed in the combined
integration; no unreviewed draft is silently included here. Navigation/auth
policies, server identity checks and global session configuration are unchanged.

This boundary covers the dashboard route subtree only, not every application
workspace or globally displayed side effect. It does not assert that a backend
write rejected after an owner change, nor that an old account's uncertain work
was rolled back. There is no server exactly-once, cross-tab or reload guarantee.

Auth source evidence: NextAuth's storage/visibility refresh can set a new nonnull
session without setting loading=true; the previously unkeyed AppShell and
dashboard provider did not force a remount on authenticated replacement. A
server-issued cookie replacement in a real sibling browser context is required
for hosted acceptance: do not replace SessionContext or inject application state
to simulate success. No navigation/reload of the original document may hide the
bug. The same-session refresh, held old/fresh reads, original draft/file/dialog
disposal and new-owner-only results must be proved before acceptance.

Four bounded SSR/session-key and actual in-memory QueryClient cancellation
regressions passed in 281 ms with installed Vitest, one worker, no cache and a
512 MiB V8 heap limit. This executed no browser, server, database or network
operation. Scoped ESLint (four TS/TSX files, zero warnings), changed-root plus
transitive TypeScript and `git diff --check` passed. These are not functional
owner-switch acceptance or a full project build.

The two authored hosted browser cases use server-issued replacement cookies and
observe that no application loading placeholder appeared during replacement;
they assert both the real owner and sessionVersion returned to the original
document. No local browser/server/API execution occurred. Exact-commit hosted
collection/CI/browser evidence and combined #169/#180 verification remain
required.

Fixture login/dashboard navigations additionally wait for the complete real
session response and its expected owner, role and sessionVersion before starting
another navigation. This is response synchronization, not an exemption for
authentication errors or evidence that every aborted fetch is harmless.
