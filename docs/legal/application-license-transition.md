# Bivaro application license transition

## Current application declaration

This release package changes Bivaro's application license declaration from
`AGPL-3.0-only` to **`Apache-2.0`**, after the accepted Ghostscript-removal base
[5fdc757971ce98e2351e0ed5cc8ce7da06f9bbd3](https://github.com/storminator89/bivaro-kleinunternehmen/commit/5fdc757971ce98e2351e0ed5cc8ce7da06f9bbd3)
(tree `a73d13695934f2189636345bcc60f5048900c15e`). The declaration applies to
Bivaro's own application work, not every file or component distributed with it.
Root [`LICENSE`](../../LICENSE), root package/lock metadata, public application
copy and the generated application's runtime notice record agree on Apache-2.0.
Docker Publish explicitly sets `org.bivaro.application.license=Apache-2.0`
with an app-only scope label. The standardized `org.opencontainers.image.licenses`
label is deliberately **empty**, suppressing repository auto-detection rather
than claiming a complete image-license expression. Third-party terms remain
authoritative. The [OCI annotation specification](https://github.com/opencontainers/image-spec/blob/main/annotations.md)
permits empty values; [metadata-action v5's custom-label merge](https://github.com/docker/metadata-action/blob/v5/src/meta.ts)
retains that explicit override. This is not a final-image label inspection.
The independently authored foreign-verifier entrypoint remains separate
application work; its bytes and pinned identity are unchanged. Importing
veraPDF interfaces does not change their license.

The root license is the complete, unmodified official Apache License 2.0 text:

- Primary source: <https://www.apache.org/licenses/LICENSE-2.0.txt>.
- Retrieved and byte-verified on 2026-10-22.
- SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

## Historical releases are not overwritten

The exact pre-transition root text is retained as
[`licenses/historical/AGPL-3.0-only-pre-apache.txt`](../../licenses/historical/AGPL-3.0-only-pre-apache.txt),
SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`.
It byte-matches `LICENSE` at the accepted base above. Earlier release/commit
license statements and revision-bound audit records remain historical evidence;
this package does not retroactively replace their terms or amend their original
release artifacts. It does not establish that a live service matches this source.

## Third-party rights and obligations remain separate

No dependency version, original third-party copyright/license text, source URL,
source-availability obligation, validator rule or resource limit is changed by
this application declaration. In particular:

- Exact imported veraPDF code remains **GPLv3+ OR MPLv2+** where upstream offers
  that choice. The existing scoped inventory selects the MPL-2.0 alternative
  only for eligible veraPDF components, preserves both original texts and
  handles separately licensed XMP/dependency files separately. It does not
  label the whole shaded JAR Apache or MPL.
- Java remains required for **both veraPDF and KoSIT**. Their distributions,
  the JRE/Debian packages, npm/native components, PDF.js resources and all fonts
  retain their own applicable notices, licenses and source obligations.
- The original notices and pinned provenance under [`licenses/`](../../licenses),
  validator license files and adjacent font notices are retained. The build
  collector still copies current application `LICENSE` separately and
  byte-preserves its scoped third-party notice inputs.

The [PDF runtime notice inventory](../operations/pdf-third-party-notices.md)
explicitly records unresolved attribution/provenance and final-artifact audit
limits. This transition is **not** a complete container SBOM, universal legal
clearance, proof of source-to-binary reproducibility or a conclusion about rights
to relicense work owned by others. Ghostscript removal alone would not establish
any of those claims. Apply component-specific terms and audit the exact release
artifact before claiming complete distribution compliance.

**Deutsch:** Die Apache-2.0-Angabe betrifft die Bivaro-Anwendung, nicht pauschal
den Container oder Drittkomponenten. Frühere AGPL-Releases, Originalhinweise und
jeweilige Quellcodepflichten bleiben nachvollziehbar und unverändert erhalten.
Die Umstellung ersetzt keine vollständige rechtliche Prüfung des Auslieferungsstands.
