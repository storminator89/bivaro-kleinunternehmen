# Controlled own-invoice PDF/A-3b rendering

Issue: <https://github.com/storminator89/bivaro-kleinunternehmen/issues/117>

Status, 2026-10-22: native Linux/amd64 generation and final-byte conformance
verified with Node 22.23.4 and official veraPDF 1.30.3. Release acceptance is
still pending the integrated native arm64, container and browser gates below.

## Boundaries

- `OwnInvoiceSource` is a strict, versioned and bounded invoice-data model.
  It does not accept PDFs, XML, drawing commands, font paths, image URLs,
  executable paths or editor-only service-note claims.
- The read-only authenticated `/api/invoices/render` endpoint uses the same
  source, application-owned PDFKit layout, embedded fonts and GiroCode for
  preview and final output. Rendering does not reserve a number, post an
  invoice, overwrite originals or write an issued-document snapshot.
- Final XML is generated on the server from that same source using the existing
  monetary calculator. The existing upload, idempotency and stored-document
  download contracts remain responsible for actual issuance/snapshot storage.
- After the last PDF save and XML attachment, independent official veraPDF
  1.30.3 must validate the exact final bytes as PDF/A-3b. Missing executable,
  different version, timeout, unexpected report or any failed check is fatal.
  Metadata alone never establishes conformance.
- The Linux verifier process receives only an explicit environment allowlist,
  not application secrets or inherited JVM/classpath/loader options. The pinned
  official launcher explicitly `exec`s Java; `JAVACMD` and bounded `JAVA_OPTS`
  are application-owned. As in the existing KoSIT runtime, `prlimit` enforces
  address-space/CPU/file/descriptor limits; the heap is 192 MiB and additional
  JVM memory regions are capped. A private process group is killed on terminal
  paths, with a 30-second wall limit and 2-MiB combined output budget. The caller
  waits for output-descriptor closure before cleanup or capacity release.
  Launcher source:
  <https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/installer/src/main/scripts/verapdf.sh>.
- `/api/pdfa3` and its patched Ghostscript converter remain untouched for
  arbitrary foreign PDFs until the separately reviewed compatibility stage.
  This slice does not remove Ghostscript from the runtime or claim signature
  preservation for converted documents.
- While issuance is pending, a disabled native fieldset freezes all invoice
  fields, template/catalogue/price/service actions and output selection. `inert`
  and capture guards also block custom-control/portal interaction; the header
  preview/back controls and ordinary dismissal are blocked, and a separate live
  status explains the busy state. Queued previews are invalidated. Late default
  number/customer-prefill responses and a payment-term refresh started before
  issuance do not replace the issuing source. Refresh results, errors and busy
  cleanup are scoped to the active editor generation. A terminal
  rejection unlocks the retained editor values. The delayed-response browser
  regression definitions are not conformance evidence and remain unrun; actual
  keyboard, pointer, native/custom-control and error-recovery checks are required.

## Payment-term and service integration

The renderer is integrated with the payment-term, bank-receipt, search and
service-PDF source at
[commit f3b5c23](https://github.com/storminator89/bivaro-kleinunternehmen/commit/f3b5c231a4bb25b5cc7a3a3bfcb9c9697c534ddc).
Customer terms retain precedence over company terms and the 14-day fallback;
manual due dates remain manual. The existing upload continues to carry the
versioned payment-term selection and owns issuance/idempotency snapshots.
The read-only renderer does not update those selections. An explicitly requested
term reapply is available again after a rendering rejection, but a stale refresh
cannot alter the earlier frozen source or its retained editor values.

## Logos and typography

Logo references come only from the authenticated tenant's saved settings and
existing ownership resolver. Actual input bytes, pixels, channels, processing
time and normalized output size are bounded. Sharp must finish decoding and
fresh encoding before any bytes reach PDFKit; metadata-only acceptance is not
sufficient. Originals are never modified.

The existing invoice places its logo exclusively inside a white header card.
Normalization deliberately composites onto that same white before fresh sRGB
JPEG encoding. It therefore preserves the logo's existing alpha-background
appearance, not arbitrary-background transparency. The accompanying ordinary
synthetic alpha tests allow only small JPEG rounding differences. No uploaded
PNG bytes reach PDFKit's asynchronous PNG decoder.

Unmodified Liberation Sans Regular/Bold programs are bundled with their SIL
OFL 1.1 notices under `public/fonts/invoice`. Their internal names remain
unchanged. Missing glyphs fail explicitly instead of silently omitting text.
Invoice amounts are recalculated; long descriptions and notes continue over
bounded pages. Preview and final content share one layout. Unit names and prices
must fit completely at a bounded readable font size; an unrepresentable
combination fails explicitly instead of silently truncating the unit.

## Dates

Civil dates use strict `YYYY-MM-DD`, years 0001–9999, without rollover or the
JavaScript 0–99 constructor remapping. Display reads explicit UTC calendar
fields. The existing XML generator still reads local calendar fields; a
separate safe construction preserves that contract and XML years are padded
to four digits. A historically skipped whole local day is rejected rather than
silently exported as another date.

## Current dependency references

- PDFKit 0.20.2, MIT: <https://github.com/foliojs/pdfkit/releases/tag/v0.20.2>
  and <https://pdfkit.org/docs/guide.pdf>.
- Fontkit 2.0.4, MIT: <https://github.com/foliojs/fontkit>.
- Sharp constructor safety controls:
  <https://sharp.pixelplumbing.com/api-constructor/>.
- Official veraPDF 1.30.3 release:
  <https://software.verapdf.org/releases/1.30/>. Core/CLI are dual-licensed
  GPLv3+ or MPLv2+; the packaged distribution must retain their licenses.
- Validator report shape follows pinned 1.30.3 Java/Jackson getters, not guessed
  XML attribute names:
  <https://github.com/veraPDF/veraPDF-library/tree/v1.30.3/core/src/main/java/org/verapdf/processor/reports>.

## Runtime packaging and provenance

`scripts/own-invoice-pdfa/install-runtime.mjs` downloads only the official
1.30.3 installer, verifies its exact size and SHA-256 before extraction or Java
execution, and refuses to overwrite an existing installation directory. The
installer runs only during build/setup, not while handling invoices. The
unmodified CLI distribution, documentation, dependency notices and full
GPLv3/MPLv2 license texts are retained in the image.

- Official archive: <https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip>.
- SHA-256: `b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59`.
- Detached signature verified against the official vendor key fingerprint
  `13DD102B4DD69354D12DE5A83184863278B17FE7` before pinning this digest.
  Subsequent builds check that pinned digest, not a newly claimed GPG signature.

Docker installs this runtime at `/opt/verapdf/verapdf`, retaining Java,
`prlimit`, the patched foreign-PDF Ghostscript path and existing KoSIT assets.
Next standalone externalizes PDFKit/Fontkit and traces both licensed fonts,
PDFKit's bundled ICC profile and standard-font metrics. Their presence in the
actual successful standalone build was checked.

## Executed evidence

On native Linux/amd64 with Node 22.23.4:

- The final integrated aggregate run passed **2,584 tests in 194 files**.
  Eight tests were skipped: six existing official KoSIT integration cases and
  one interruption/lifecycle case require their separately configured official
  assets, and one performance benchmark is opt-in. The enabled own-invoice
  conformance matrix was **not skipped**.
- **229 focused tests passed in nine files**, including real Sharp alpha
  normalization, ordinary malformed-image rejection, civil dates, XML/XMP
  parity, read-only route behavior, verifier lifecycle/resource limits and
  installer integrity failures.
- **13 real conformance cases passed**: ten positive documents and three
  ordinary negative cases (incomplete logo, unrepresentable invoice identifier,
  and unrepresentable complete unit/price in preview). The latter deliberately
  tests layout: final XML correctly rejects an unknown unit earlier. Each positive final byte sequence
  was checked twice with the pinned official verifier after XML attachment.
- Positive cases cover small-business and mixed standard tax, fractional
  quantity/four-decimal unit price, 200 rows/large totals, multipage descriptions
  and notes, long unbroken text, embedded licensed fonts/glyphs, escaped title,
  transparent logo, GiroCode, and civil years 0001/9999.
- Real preview/final page streams match. Embedded XML matches the bounded
  source's generated XML; ICC/XMP/fonts, final image streams and expected QR
  payload image bytes are checked. This does not claim a separate EN16931
  schema/business-rule report for these embedded XML fixtures.
- All **43 final pages** were rendered with independent Poppler at
  **1415×2000** and inspected individually at readable resolution. No clipping,
  overlap, missing glyphs, incomplete unit, unreadable amount or footer collision
  remained. A unit-ellipsis defect found during the initial pixel review was
  fixed; the entire 13-case matrix and every affected page were then rechecked.
  This is not a camera/independent QR-decoder result.
- After the payment-term/service integration, the complete matrix was rerun and
  all 43 new final pages were independently rendered again. Every decoded RGBA
  pixel is identical to the individually inspected baseline; this is a lossless
  full-page comparison, not a contact-sheet or metadata comparison. The retained
  `visual-parity-proof.json` binds the current final-byte manifest, reviewed
  baseline manifest and each page's decoded-pixel hash.
- Type checking, full zero-warning ESLint and the production standalone build
  passed. `npm audit --omit=dev` reported **zero vulnerabilities** for the pinned
  dependency tree at verification time.
- The actual build-time installer successfully downloaded, hash-checked,
  installed and version-checked the official runtime and retained its licenses.

The first integrated aggregate run exposed two test-contract failures: an
inherited administrator verifier path changed a mocked default-path assertion,
and a static container assertion still expected three rather than five mounts.
The unit environment is now deterministic; container checks require exactly the
five approved read-only test-script/dependency/fixture paths and reject extra
mounts, privileged flags or host namespace sharing. The final aggregate rerun
passed without reducing runtime isolation.

## Required release gates

The real matrix must explicitly run with
`BIVARO_RUN_OWN_INVOICE_PDFA_ACCEPTANCE=1`. Missing fonts/runtime/official
pinned verifier fail the enabled suite; a skipped matrix is never acceptance.
`BIVARO_VERAPDF_BIN` selects an absolute administrator-configured executable;
`BIVARO_OWN_INVOICE_EVIDENCE_DIR` retains synthetic preview/final PDFs and the
manifest. The manifest requires all ten positive and all three negative cases.

`.github/workflows/own-invoice-pdfa.yml` defines native Linux x64 and arm64
jobs, verifies the actual architecture, installs the pinned runtime, enables the
whole matrix and renders every final page for review. Native arm64 is **unrun**
at this report's cutoff. Standard runner labels follow the
[official GitHub runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The existing browser workflow now installs the official verifier and explicitly
enables `BIVARO_RUN_OWN_INVOICE_PDFA_BROWSER=1` through the supported
`npm run test:e2e` fixture runner. Two real desktop/mobile flows cover tenant
logo preservation, multipage notes, QR/XML/content parity and byte-identical
native response/download/stored file and the manual payment-term snapshot.
Three delayed-503 regressions cover frozen native/custom actions, retained
values, unlocking, late response after navigation, and a stale pre-issuance term
refresh followed by an explicit reapply. These **five browser definitions remain
unrun**. Local browser
execution is unavailable because the sandbox denies Chromium's process-singleton
socket creation; no browser assertions passed. The actual retained browser PDF
pages still require readable pixel review after a supported CI run.
The screenshot stage preserves the existing exact 50-name synthetic allowlist,
verified strong lossless recompression, 5-MiB combined cap and one-day retention;
native PDF evidence is retained separately with the same one-day retention.

The native amd64/arm64 container workflow mounts an isolated smoke script into
the freshly built non-root, network-disabled runtime. It exercises ordinary
fixture registration/login and the actual authenticated read-only renderer,
including alpha-logo originals, QR, multipage output and final-byte parity.
Container stages remain **unrun** here; Docker is unavailable locally. No
privileged flags or host/security changes are part of this check.

All gates must be evaluated on the final integrated source, including any
payment-term/editor integration changes. No release should claim acceptance
from a skipped matrix, source-only definitions, metadata-only checks or earlier
PDF pixels.
