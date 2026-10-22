# Scoped PDF runtime notices

This packaging step preserves known third-party notices. Bivaro's current
application declaration is **Apache-2.0**; see the separate
[application license transition](../legal/application-license-transition.md).
The inventory does **not** relicense third-party components, establish rights
to relicense others' work, or certify the complete application/container
dependency inventory.

## Where the runtime artifacts are

`npm run build` runs the offline `postbuild` notice collector after Next creates
`.next/standalone/server.js`. Do not suppress npm lifecycle scripts when creating
a distribution. The collector writes these files into `.next/standalone/`:

- `THIRD_PARTY_NOTICES.txt`: scope, component list and explicit limitations;
- `THIRD_PARTY_SOURCES.json`: installed/locked versions, npm archive URLs and
  integrity values, declared repositories, and copied-notice SHA-256 values;
- `LICENSE`: the application's current root Apache-2.0 text, unchanged and
  SHA-256-bound in the manifest; third-party components keep their own terms;
- `licenses/npm/`: original root license, copyright and notice files plus package
  metadata for PDFKit/fontkit and their declared npm runtime dependency closure,
  and PDF.js 6.4.299's root and separately licensed CMAP/ICC/font/WASM notices;
- `licenses/invoice-fonts/`: byte-for-byte original `FONT-LICENSE.txt` and font
  provenance README. Font files and their existing adjacent notice stay unchanged;
- `licenses/MIT-reference.txt`: **reference template only**, copied from SPDX
  license-list-data v3.26.0, including unfilled placeholders;
- `licenses/shadcn-ui/`, `licenses/brotli/`, `licenses/quickjs/`: recovered
  original notices also committed in the source tree;
- `licenses/third-party-sources.json`: exact upstream URLs, commit pins,
  full-source SHA-256/Git-blob IDs, extracted-notice SHA-256 values and explicit
  provenance limits for those recovered notices.

The Docker builder runs `npm run build` before pruning dependencies and copies
that entire standalone directory to `/app`. Notice files therefore survive
Next's tracing and `npm prune`; they do not depend on Next tracing a LICENSE.
The collector does not download anything, execute PDF tools, or start a server.
Its output has no timestamps or absolute build paths.
The offline collector checks all 24 pinned recovered notice/provenance files
and byte-matches seven installed Brotli decoder sources and both shipped
QuickJS assets before writing anything. It rejects duplicate/escaped paths,
symlinked inputs/output components, excessive inputs and mismatched hashes.
Existing hard-linked output files are rejected before truncation.
Repeated writes preserve identical bytes; no mutable upstream fetch runs during
build. The source repository includes the originals and manifest, so source
distributions do not depend on a later build to recover these notices.

The pinned veraPDF installer separately writes
`/opt/verapdf/THIRD-PARTY-NOTICES.txt`, `THIRD_PARTY_SOURCES.json`, MPL/GPL license
texts, and exact surviving embedded licenses/notices/POM evidence under
`licenses/embedded/`. Docker already copies `/opt/verapdf` in full. The CLI JAR
itself is unchanged and its SHA-256 is checked before generating the inventory.
For the dual-licensed veraPDF code, the notices document use of the **MPL-2.0
alternative**, not a relicensing of the entire shaded JAR or application.

## Verified provenance and deliberate limits

- PDFKit 0.20.2 includes its original MIT `LICENSE`; it is copied unchanged.
  Primary source: <https://github.com/foliojs/pdfkit/blob/v0.20.2/LICENSE>.
- fontkit 2.0.4 declares MIT in its original package metadata and README, but
  neither the npm package nor upstream v2.0.4 tag supplies a full LICENSE or
  copyright text. See the upstream report:
  <https://github.com/foliojs/fontkit/issues/255>. The collector preserves those
  declarations and flags the gap. **It does not invent a copyright year/holder,
  reuse PDFKit's copyright for fontkit, or pretend the generic MIT template
  supplies missing attribution.** dfa 1.2.0 also lacks a full root license text;
  Brotli's missing wrapper attribution remains flagged separately below.
- shadcn/ui-derived `components/ui/` scaffolds retain the exact original MIT
  `Copyright (c) 2023 shadcn` notice from commit
  `6ea6856f5a1082d4d9c231559b6bc3ee73827493`:
  <https://raw.githubusercontent.com/shadcn-ui/ui/6ea6856f5a1082d4d9c231559b6bc3ee73827493/LICENSE.md>.
- Brotli 1.3.3's installed `dec/{bit_reader,context,decode,dictionary-data,
  dictionary,prefix,transform}.js` files byte-match foliojs/brotli.js commit
  `e36051345f6d27a56e5f39ea70d2f789b8574046` (tag `v1.3.3`). Their original
  leading Google-2013 Apache-2.0 comments are preserved **separately by source
  path**, alongside the complete official Apache text. Example source:
  <https://raw.githubusercontent.com/foliojs/brotli.js/e36051345f6d27a56e5f39ea70d2f789b8574046/dec/decode.js>.
  Package metadata/README still declare MIT. **This does not relabel the whole
  package Apache or resolve missing full wrapper MIT attribution.**
- PDF.js 6.4.299's unchanged `wasm/quickjs-eval.{js,wasm}` byte-match the
  corresponding `external/quickjs/` assets at PDF.js commit
  `7a7e4fd382481a76f55c6d735873f635c9178db1`; respective Git blobs are
  `f087fb29602352e8be9a6e7f7d766ccdb0dda038` and
  `42980e94aa4d7359e4113c968c67800b45462764`.
  Their absent packaged notices are tracked upstream:
  <https://github.com/mozilla/pdf.js/issues/22143>.
  The wrapper build pin `b62f7cd527363ca2c1fe7467f274bc9acbf78c24` identifies
  bellard/quickjs `3d5e064e9dd67c70f7962836505a7fa067bf0a4e`, VERSION
  `2026-06-04`; its original root license and leading MIT headers from
  `quickjs.{c,h}`, `cutils.{c,h}`, `libregexp.{c,h}`, `libunicode.{c,h}`,
  `dtoa.{c,h}`, `quickjs-atom.h` and `quickjs-opcode.h` are preserved. In
  particular `dtoa` has its own original 2024 Fabrice Bellard attribution;
  `quickjs.c` has the newer 2017–2025 Bellard/Gordon notices. These are not
  replaced by the root license's older date range. Primary engine license:
  <https://raw.githubusercontent.com/bellard/quickjs/3d5e064e9dd67c70f7962836505a7fa067bf0a4e/LICENSE>.
- `LICENSE_PDFJS_QUICKJS` is the **subsequently supplied official wrapper
  project notice**, from `e2c5bfc8194b16f5973eea5e4e025b67be3c1015`, not an
  original file at the asset-build revision:
  <https://raw.githubusercontent.com/mozilla/pdf.js.quickjs/e2c5bfc8194b16f5973eea5e4e025b67be3c1015/LICENSE>.
  Upstream explains the missing license-file correction at
  <https://github.com/mozilla/pdf.js.quickjs/issues/1>. The exact build wrapper's
  `Dockerfile`, `compile.sh` and patch source URLs/hashes are in the manifest.
  Its Dockerfile uses `emscripten/emsdk:latest`; **exact shipped compiler and
  libc-runtime provenance remains unresolved**. Matching source pins/assets
  does not prove reproducible compilation or complete binary-license coverage.
- Exact original font OFL notices remain authoritative. No font license changes.
- veraPDF CLI 1.30.3 is from the installer archive pinned in
  `scripts/own-invoice-pdfa/install-runtime.mjs`. The inspected CLI SHA-256 is
  `19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70`.
  Original dual-license statement:
  <https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/README.md>.
- Nine observed veraPDF Maven modules provide version **1.30.3** in the actual
  JAR's `pom.properties`: `org.verapdf.apps:{cli,apps}` and
  `org.verapdf:{parser,metadata-fixer,feature-reporting,validation-model,
  verapdf-xmp-core,pdf-model,core}`. Their exact-coordinate Maven source JAR URLs
  are recorded in the runtime manifest; all nine returned HTTP 200 during this
  packaging review. Example:
  <https://repo.maven.apache.org/maven2/org/verapdf/apps/cli/1.30.3/cli-1.30.3-sources.jar>.
  Links identify published Source Code Form; source-to-binary reproducibility
  and full source coverage are **not** claimed.
- The embedded `verapdf-xmp-core` POM declares BSD 3-Clause while its source header
  also offers GPLv3+/MPLv2+. Both original texts are retained. The collector does
  not apply a blanket MPL selection over that module's separate file licenses.
- The CLI has 20 surviving Maven metadata entries, but also shaded namespaces
  without complete coordinates (Rhino, Saxon, XML Resolver, JCommander and
  stax-utils). Surviving embedded notices may omit notices lost during upstream
  assembly. Their remaining source/version/license inventory needs audit.

The application license declaration does not resolve the limits above. Before
claiming complete binary/container compliance, resolve missing upstream
attribution and audit **the final release artifact**:
all veraPDF shaded dependencies/resources, PDF.js fonts and Canvas's native and
transitive components, existing sharp/libvips and other npm/native
libraries, the other invoice validators, Debian packages and the JRE. Keep
applicable source-availability/relinking obligations and original notices for
each component; a top-level MIT/Apache/MPL label is not a bundle-wide license.

## Verification

Pure unit tests use synthetic package trees and ZIPs only:

```sh
npx vitest run scripts/__tests__/pdf-runtime-notices.test.ts scripts/__tests__/runtime-notice-inspection.test.ts scripts/__tests__/own-invoice-pdfa-installer.test.ts
```

They cover deterministic byte preservation, nested dependency versions, missing
upstream-text flags, standalone packaging, lock/version mismatch rejection,
MPL selection boundaries, source-coordinate mapping and CLI hash rejection.
They also execute the actual default-root notice CLI against synthetic package
files and an inert standalone marker, and check trailing-separator equivalence.
They do not run Java, a validator, browser/server, or container. A final image
build/inspection remains separate release evidence; do not infer it from unit
results.

## Read-only final-image evidence

The existing native container smoke inspects the actual `/app` and
`/opt/verapdf` image files without rewriting them or invoking another tool.
It rejects non-regular, symlinked, escaped, oversized, missing or hash-mismatched
notice paths; checks the pinned PDFKit/OFL/CLI digests and declared versions;
and retains the separate-license/source-mapping limits. Only a compact
`runtimeNotices` hash/count summary is added to the existing synthetic
`manifest.json` artifact. No license texts, JARs or image layers are uploaded.
The production smoke uses fixed roots and digests; synthetic unit tests extract
only the isolated inspection function and supply synthetic expected digests.
They never import/run the full container smoke, server, database or native tools.
The inspection additionally pins the recovered-notice manifest, verifies all
its original notice/provenance bytes and nine unchanged runtime inputs, and
checks the copied application license. Only their counts/digests are included
in the existing compact result; no full private artifact is uploaded.
A summary with `status: passed` is scoped file-preservation evidence for that
particular image, **not** complete license clearance, AI/foreign-PDF closure
coverage, or evidence of an emulated arm64 build.

## Build-only version startup bound (2026-10-22)

Docker Publish run `39792213510` for main `3c4fd511` failed during the
emulated arm64 build's installed `verapdf --version` probe. The existing
30-second probe reported `killed: true`, `SIGKILL` and empty output. Native
x64 and arm64 acceptance had passed. This supports a build-time startup-bound
hypothesis; it does **not** prove OOM, a broken validator, or the exact QEMU
startup duration.

The build-only version probe now has a hard 120-second limit, matching the
already-existing installer Java execution ceiling. It retains a fixed 192 MiB
maximum Java heap, 32 KiB captured-output bound per stdout/stderr stream,
SIGKILL on timeout and exact `veraPDF 1.30.3` first-line check. Its explicitly allowlisted environment adds
Serial GC and `ActiveProcessorCount=1` for this startup probe only. The latter
is a JVM thread-pool sizing input, **not** an OS CPU quota; see the
[Java 21 option reference](https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html).
Operator/JVM injection variables are not inherited. There is no retry or
environment-based override.

The installed launcher file, runtime document validator's 30-second deadline
and all runtime document/resource caps remain unchanged. Pure injected-executor
tests check the exact probe options/environment, version match/mismatch and
unchanged propagation of timeout/output-limit failures without retry. They do
not execute Java or establish QEMU timing. **Successful completion with the
120-second probe is not yet demonstrated:** the combined candidate needs the
actual hosted emulated-arm64 build verification before claiming the observed
Docker Publish failure is resolved.
