# Final Ghostscript dependency cutover

## Source scope

The production Docker recipe and browser dependency setup no longer install
Ghostscript. The obsolete container PostScript-to-PDF-to-PNG smoke is removed;
it tested a dependency the application no longer calls. No replacement PDF
assertion is removed, skipped or weakened.

`scripts/assert-no-ghostscript.sh` is a read-only, fail-closed inspection:

- `command -v gs` must find no executable; it never invokes `gs`.
- `dpkg-query` must succeed with a nonempty coherent package inventory.
- No payload-bearing package may match `ghostscript`, `ghostscript-*`, `libgs`,
  `libgs-*` or `libgs<version>*`, including architecture-qualified names.
  Unpacked/partially configured payload also fails. Removed-package metadata in
  `config-files`/`not-installed` state alone is not installed payload.
- `libgsf`, `libgssapi`, `libgsasl` and `libgstreamer` are unrelated and permitted.
- Only a fixed positive JSON receipt or fixed failure category is emitted; the
  complete package list is not printed. No host packages/settings are changed.

The actual final Docker stage runs this guard after all application copies.
Both native non-root container gates and browser setup run it again. Workflow
path filters include the guard so later changes cannot silently evade the gates.
The test-only AI browser derivative repeats it after Playwright's dependency
installation, without modifying the captured production application closure.

## Unchanged functionality and security

Optional, explicitly consented AI preparation continues through isolated PDF.js
and native canvas. Provider consent, complete-page checks, byte limits and
network/process/filesystem confinement are unchanged. There is no hidden AI
transfer or new PDF-provider fallback. Original uploads, attachments, archive
hashes and download bytes are unchanged.

Own invoices still use direct PDF/A generation and independent official
veraPDF validation. Java remains: the image contains the JRE, not a JDK or
compiler. The small build-only compiled foreign entrypoint delegates to the
unchanged official CLI/profiles/report/exit behavior. Its per-newly-materialized
stream bound and every existing JVM/CPU/wall/output limit remain unchanged.
Oversized materialization fails closed. The parent run's specific N+2,048-byte
font fixture returned unavailable 503 on both architectures; this does not make
every cap rejection a 503. Coherent unsupported/noncompliant input remains 422.

The stateless legacy XML-attachment endpoint accepts only supported already-valid
PDF/A-3b and independently validates the final bytes. It rejects signed,
encrypted, form-bearing or already-attached PDFs rather than repairing or
silently damaging them. It does not archive submitted files or certify all
invoice XML/business rules. Arbitrary foreign-PDF normalization is not restored.

Credit-note `GS-...` identifiers, negative must-not-call-Ghostscript tests and
historical evidence are deliberately retained. This is not a license change;
the existing project license and all third-party notices remain in force.

## Acceptance boundary

The parent candidate's [native foreign run
39845788313](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39845788313)
passed both architectures at its own immutable source. This established genuine
source/final conformance, rejection/archive/stateless checks and independent
whole-page pixel/text preservation before package removal. It is not proof of
the successor image's package absence.

This source-only cutover still requires its own exact-checkout production-image
build and real amd64/arm64 replacement gates, independent compiled-adapter and
artifact/visual review, own-invoice conformance, complete browser/security
acceptance, and ordinary type/lint/pure/build checks. The actual image must pass
both executable and package absence checks; source grep or mocked tests alone
cannot establish removal. No local JVM/compiler/native/browser result is claimed.
