# Search flat icons — #228 local candidate

Observed 2026-10-26, 23:30 UTC. Issue: [#228](https://github.com/storminator89/bivaro-kleinunternehmen/issues/228).

## Source and confirmed scope

Provider `main` was freshly read at `595e5e44525ec0967b627f482bc78f607dcabe15`, tree
`7b8916a9f56a609b3b923121e9e26e8b83796254`. The local synthetic base has that exact
tree; it is not the provider commit. Provider blob SHAs for palette, navigation,
SidebarIcon, asset test and search contract matched the local tree.

The palette still used `BivaroIcon` and `/brand/icons/nav-*.webp` for command and
record rows, while navigation used `SidebarIcon` and existing flat alpha masks.
The old asset test explicitly retained that palette exclusion. Duplicate searches
for `icon`, `Icons`, `flat`, `command-palette` and `Befehlspalette` found no matching
icon ticket; #25/#28/#102 describe different work.

Only the palette renderer is changed: both row types reuse `SidebarIcon` at the
existing 26px size; the command icon union is narrowed to actual navigation names.
Existing theme SVGs are explicitly decorative. No labels, actions, requests,
pagination, focus/navigation code, CSS, artwork, API, auth, financial calculations,
schema, dependencies, workflow or test-selector source changed.

## Actual checks

| Check | Result |
| --- | --- |
| Existing sidebar asset/renderer suite | 1 suite, 16 passed, 0 skipped. No additional unit cases. |
| Original palette against updated regression contract | Expected red: 1 failed, 15 passed. Then restored candidate and reran all 16 successfully. This is source/asset evidence, not browser evidence. |
| Focused ESLint, three TS/TSX paths | Passed, zero warnings. |
| Full `npm run lint` | Passed, zero ESLint warnings. npm printed its environment/version notices. |
| Scoped TypeScript, changed TS/TSX and repository type augmentations | Passed, exit 0, no emit/incremental artifacts. Initial incomplete scope omitted `types/next-auth.d.ts`; including the existing declarations corrected the verification config, not application code. |
| `git diff --check` | Passed. |
| Full TypeScript, production build, full unit suite | Not run in this small packet. |
| Browser and screenshot inspection | Not run; remains required. |

Logs outside the source tree:

- `bivaro-search-flat-icons-228-unit-final.log`: SHA-256 `b2b2e802eeca346bfa00e5dde11690841c15945547c49e1d47ec4bb98ed22d83`.
- `bivaro-search-flat-icons-228-baseline-red.log`: `032af0e461531339a13e79d4a27af27f18ad004359705528a0cd0b6c59b7bd96`.
- `bivaro-search-flat-icons-228-full-lint.log`: `49daf7f099c607a007f42437e3799136e27dfd1b1a9d9ac42cfc7fb423114033`.
- Focused lint and successful scoped-types logs are empty at exit 0: SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## One authored browser case, not executed

`e2e/search-flat-icons.spec.ts` / `search shares flat navigation icons while labels keyboard and close remain intact`
uses the existing fresh-fixture guard and synthetic login helper. It checks both
themes across 1440/360/390px, the existing command icons and all three record icon
types, decorative markup, inherited ink, keyboard active descendant, Escape/focus
return, and the unchanged keyboard command destination. It captures six bounded
screenshots for later visual inspection. Synthetic record responses deliberately
do not claim backend, tenant or financial acceptance; no records are opened.

Exact palette-to-single-title focused selection still needs integration with the
selector owner's separate packet. No broad record-search/full-suite fallback.
The existing local socket-EPERM/denied-bootstrap boundary was not retried or
bypassed. No browser/server/API/database execution, installation, Prisma
regeneration, new CI run or source publication occurred. Only the authorized new
issue was created remotely. No remote branch/PR, merge, release, deployment or issue
closure; this remains a locally checked implementation with browser acceptance
and publication pending. Historical backlog counts remain unchanged.
