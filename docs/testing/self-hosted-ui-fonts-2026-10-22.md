# Deterministic UI font builds

## Observed failure and upstream behavior

PR121 head `2edca6997b26471e36d0f2595648a19b4d376f06` passed ordinary
unit/build/type/lint/security and native amd64/arm64 gates. Its browser job
`119800798972` failed during the production web-server build, before test
bodies ran: Newsreader's generated stylesheet could not resolve the internal
font module, ending with `next/font/google queries have exactly one entry`.
No screenshots were produced. PR123 security job `119801271424` encountered
the same startup failure.

The repository has no Google-font mock-response hook or custom font loader.
The original three font declarations are identical on the accepted integration
and feature branches. [Upstream issue 99114](https://github.com/vercel/next.js/issues/99114)
documents a valid extensionless Google CDN URL with query parameters triggering
this parser failure. The actual failed CSS response was not captured, so that
specific response shape remains an inference, not recovered byte evidence.

Stable Next 16.4.2 retains the same faulty
[font-parser source](https://github.com/vercel/next.js/blob/v16.4.2/crates/next-core/src/next_font/google/mod.rs#L482-L493) as 16.4.1;
upgrading to it would not address this failure. The full fix is present in
[16.5.0-canary.13](https://github.com/vercel/next.js/releases/tag/v16.5.0-canary.13),
but the [official support policy](https://nextjs.org/support-policy) advises
against production canary use. The application therefore retains 16.4.1 and
removes this external build-time font dependency instead.

## Exact-font contract

- Preserve all 16 existing WOFF2 payloads, 395,736 bytes total: Inter 4.001,
  Geist Mono 1.701 and Newsreader 1.003 with its existing 16 pt optical-size instance.
- Recover the original versioned `fonts.gstatic.com` source URLs, fetch each
  once using normal HTTPS verification, and compare every response byte and
  SHA256 against the previously generated asset. All 16 comparisons matched.
- Preserve the 19 web-face declarations, three fallback declarations, normal
  style, weight ranges/500-and-600 selections, all Unicode ranges and `swap`.
  Latin-only preload configuration was never a restriction of glyph coverage.
- Preserve the exact three CSS variable stacks and three anonymous Latin
  preloads, including the request CSP nonce.
- Keep every authentication, theme, shell, history and progress wrapper intact.
  No framework/dependency, engine, container, routing, CSP or workflow change.
- Include the three official Google Fonts OFL 1.1 notices, source URLs and
  hashes. Font internals and embedded copyright notices remain unchanged.

The descriptor baseline digest, replacing each source with its payload SHA256,
is `e19294df3390582e548e0f1bad343d013da74600ab8d75ff3714a4c294aa9ef2`.
`public/fonts/ui/manifest.json` contains the complete source/payload/license
inventory. Fallback metrics remain:

| Family | Local fallback | Ascent | Descent | Size adjustment |
| --- | --- | --- | --- | --- |
| Inter | Arial | 90.44% | 22.52% | 107.12% |
| Geist Mono | Arial | 74.67% | 21.92% | 134.59% |
| Newsreader | Times New Roman | 69.68% | 25.12% | 105.48% |

All three retain zero line-gap override. Explicit CSS avoids recomputing these
metrics differently through another font loader. Build-time font network access
is eliminated; browser font files are served only from the application origin.

## Verification

The following local checks used the PR121 `2edca699` source tree plus this
font-only change; they do not claim fresh CI results for another branch.

1. Initial focused font suite: 29 passed. Original variable quoting was then
   preserved literally and a genuine WOFF2-format regression case added.
2. Full ordinary suite: 2478 passed, 0 failed, 8 skipped across 192 test files,
   including all 30 font invariant/SSR tests. All eight skips are listed below.
3. Full nonincremental type check and zero-warning lint passed.
4. Production build passed (116 generated pages). Its emitted CSS matched all
   22 original face descriptor maps and all three original variable stacks;
   the Next font-loader manifest is empty. The two existing dynamic-filesystem
   tracing warnings remain; no font error occurred.
5. After adding the browser regression definition, focused font tests again
   passed 30/30; full nonincremental type and zero-warning lint passed again.

Local skipped tests:

- `dashboard-performance.bench.test.ts`: `measures 100, 10k and 100k rows without changing product code` — `BIVARO_RUN_BENCHMARK` was not `1`.
- `purchase-validation-process.test.ts`: `enforces one process across requests and removes private originals/reports on interruption` — official validator assets were not provisioned (`BIVARO_EINVOICE_ASSETS_DIR` unset).
- `purchase-validation-runtime.test.ts`: the following six cases have the same explicit official-assets prerequisite, which was unset:
  - `verifies the complete official rule tree and both derived scenario configurations`.
  - `validates synthetic valid-cii.xml with the real offline engine`.
  - `validates synthetic valid-ubl.xml with the real offline engine`.
  - `rejects reachable remote schema hints before either CII/UBL engine can consult them`.
  - `rejects wrong sums and a required missing field through official rules, not heuristics`.
  - `keeps accepted informational guidance visibly distinct from an unqualified technical pass`.

No skip was added or changed. Provisioned CI must execute all seven official
validator cases; these local counts are not a substitute for that gate.

Independent source review matched all 22 ordered face descriptor maps, all 16
payloads, license hashes and three preloads. Existing static routing, CSP and
standalone-public copying support these paths without changes.

The new browser regression loads all 19 genuine web faces, verifies all 16 HTTP
payload hashes against the manifest and rejects external font requests. It
adds no screenshot names and has not been run locally. Local Chromium launch
is unavailable because its process-singleton socket is denied by the operating
system. Fresh hosted browser assertions and the complete branch-specific
50/52-image visual/integrity evidence remain mandatory before merge. Neither
allowlist changes; prior green gates are not acceptance of this font change.
