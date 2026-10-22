# Scoped PDF runtime notices

This packaging step preserves known third-party notices. It does **not** change
Bivaro's AGPL-3.0-only license, clear rights to relicense the application, or
certify the complete application/container dependency inventory.

## Where the runtime artifacts are

`npm run build` runs the offline `postbuild` notice collector after Next creates
`.next/standalone/server.js`. Do not suppress npm lifecycle scripts when creating
a distribution. The collector writes these files into `.next/standalone/`:

- `THIRD_PARTY_NOTICES.txt`: scope, component list and explicit limitations;
- `THIRD_PARTY_SOURCES.json`: installed/locked versions, npm archive URLs and
  integrity values, declared repositories, and copied-notice SHA-256 values;
- `licenses/npm/`: original root license, copyright and notice files plus package
  metadata for PDFKit/fontkit and their declared npm runtime dependency closure;
- `licenses/invoice-fonts/`: byte-for-byte original `FONT-LICENSE.txt` and font
  provenance README. Font files and their existing adjacent notice stay unchanged;
- `licenses/MIT-reference.txt`: **reference template only**, copied from SPDX
  license-list-data v3.26.0, including unfilled placeholders.

The Docker builder runs `npm run build` before pruning dependencies and copies
that entire standalone directory to `/app`. Notice files therefore survive
Next's tracing and `npm prune`; they do not depend on Next tracing a LICENSE.
The collector does not download anything, execute PDF tools, or start a server.
Its output has no timestamps or absolute build paths.

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
  supplies missing attribution.** The observed closure also lacks root license
  texts for brotli 1.3.3 and dfa 1.2.0; these remain flagged, not silently cleared.
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

Before a license transition or a claim of complete binary/container compliance,
resolve missing upstream attribution and audit **the final release artifact**:
all veraPDF shaded dependencies/resources, PDF.js fonts and Canvas's native and
transitive components if introduced, existing sharp/libvips and other npm/native
libraries, the other invoice validators, Debian packages and the JRE. Keep
applicable source-availability/relinking obligations and original notices for
each component; a top-level MIT/Apache/MPL label is not a bundle-wide license.

## Verification

Pure unit tests use synthetic package trees and ZIPs only:

```sh
npx vitest run scripts/__tests__/pdf-runtime-notices.test.ts scripts/__tests__/own-invoice-pdfa-installer.test.ts
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
