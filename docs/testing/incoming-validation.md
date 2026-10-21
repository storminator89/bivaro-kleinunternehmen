# Incoming e-invoice technical validation

Issue #84, first bounded runtime slice. Extraction and accounting approval remain
separate. A technical pass is **not** identity verification, proof of payment,
tax approval, a legal certification, or an automatic expense booking.

## Support matrix

| Original | Technical support |
| --- | --- |
| Standalone UTF-8 CII, UN/CEFACT D16B, XRechnung standard profile, invoice type `380` | Official CII XSD, EN 16931 and XRechnung Schematron |
| Standalone UTF-8 UBL Invoice 2.1, same XRechnung standard profile, type `380` | Official UBL Invoice XSD, EN 16931 and XRechnung Schematron |
| Any `xsi:schemaLocation` / `xsi:noNamespaceSchemaLocation`, at any depth, including HTTP, file or relative hints | `UNSUPPORTED`; schemas are selected only by pinned scenarios; original bytes are never stripped or rewritten |
| Missing required field in a supported profile | Official rules determine rejection; a failed XSD can stop Schematron |
| CII type `381`, other present non-`380` types, UBL CreditNote, extensions/CVD, older or unknown profiles | `UNSUPPORTED`, never a positive fallback result |
| EN 16931-only CII/UBL, Factur-X/ZUGFeRD profiles, PDF or photo containers | `UNSUPPORTED`; existing extraction/manual workflows remain available |
| Missing/mismatched tools or rules, timeout, incomplete or inconsistent engine report | `NOT_RUN`, never a pass |
| Unsafe/malformed/oversize XML or an original-hash mismatch | `FAILED`, with a distinct preflight reason; this is not a claimed Schematron result |

The exact supported guideline/customization URI is:

```text
urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0
```

Recognition is namespace- and path-aware, not based on file extensions or a text
substring. CII uses `CrossIndustryInvoice/ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID`;
UBL uses `Invoice/CustomizationID`. The matching official scenario itself is
preserved byte-for-byte. The adapter selects just one standard invoice scenario
for the detected format, retaining the official header and fallback. It does not
rewrite XSD, Schematron, severity overrides, or acceptance rules.

## Official tools, versions and integrity

* [KoSIT Validator 1.6.3](https://github.com/itplr-kosit/validator/releases/tag/v1.6.3),
  standalone JAR, Apache-2.0. The upstream parser disables DTD processing,
  XInclude and external functions.
* [XRechnung configuration v2026-08-31](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31),
  XRechnung 3.0.2, CEN Schematron 1.3.16, XRechnung Schematron 2.6.0,
  Apache-2.0 configuration. Embedded dependencies retain their upstream notices.

SHA-256 pins:

| Artefact | SHA-256 |
| --- | --- |
| Official standalone JAR | `799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9` |
| Official configuration ZIP | `2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8` |
| Derived CII scenario configuration | `f79b645e9dbe3ad568024861dfcaa2f4d2736be25b6a57e96f39464055b1179e` |
| Derived UBL scenario configuration | `292fdd6b8646f8a36a8ce1edd4e56e866a8085728f5c76c737baa7887b5816ca` |
| Complete extracted rule-file tree | `eaa60afa23c735dc9ff21717a0bc586e6c63a6f8ba36fbd46b4b9650ced1a63a` |

The tree digest hashes UTF-8 `JSON.stringify` of `{path,sha256}` entries sorted
lexicographically by relative POSIX path. All 97 files are checked, not just a
version label. Symlink entries, missing files and changed bytes fail closed.
The original release archive and both derived scenario digests are verified at
installation; the JAR, complete rule tree and derived scenarios are checked for
every runtime invocation.

The pinned CLI calls `Configuration.load(...).build(...)` without overriding
the loader's **`STRICT_RELATIVE`** default, not `STRICT_LOCAL`.
See the exact-version [CLI source](https://github.com/itplr-kosit/validator/blob/v1.6.3/src/main/java/de/kosit/validationtool/cmd/Validator.java)
and [configuration loader](https://github.com/itplr-kosit/validator/blob/v1.6.3/src/main/java/de/kosit/validationtool/config/ConfigurationLoader.java).
The [relative strategy](https://github.com/itplr-kosit/validator/blob/v1.6.3/src/main/java/de/kosit/validationtool/impl/xml/StrictRelativeResolvingStrategy.java)
uses file-only XSD access and repository-relative transformation/unparsed-text
resolvers. Fixed local paths, exact JAR/config/tree hashes and no custom resolver
or caller-controlled CLI options preserve that selection.

`install-runtime.mjs` downloads only these official hash-pinned assets and their
versioned licenses during image/CI preparation. It never receives invoice data.
The Docker runner includes a Debian headless JRE and read-only root-owned
artefacts under `/opt/bivaro/einvoice`. Validation uses no network service or
document upload. The existing generator validation harness is unchanged.

Measured tool/rule/license installation: **16,380,201 bytes**, including the
10,648,594-byte JAR and 5,696,701 uncompressed rule-file bytes. A synthetic
two-scenario cold-start probe took 2.97 seconds with peak RSS 180,212 KiB.
The already-present OpenJDK 21 installation occupied 202,337,439 bytes; this is
**not** a measurement of the additional Docker layer. No new image-size or
production-host measurement is claimed.

## Resource and XML boundaries

* Explicit `sax@1.4.1` reuses the exact package already present in the lockfile;
  no package version or integrity changes. Production dependency audit: zero
  reported advisories at the recorded check.
* UTF-8 only, at most 2 MiB XML, 64 nested elements, 20,000 elements, 64
  attributes per element, bounded profile/type text, and a one-second streaming
  gate budget. DTD/entities, XInclude and non-declaration processing instructions
  are rejected before the official engine. All XML Schema-instance location hints
  are unsupported, identified by resolved namespace URI and local attribute name
  anywhere, including foreign/lax extension content and alternate prefixes. This
  deliberately excludes otherwise legitimate invoices that carry schema hints;
  they are not declared invalid and their archived bytes are never changed.
  SAX has no resource resolver.
* One validator subprocess at a time **per application process**, plus the
  existing per-tenant document-processing guard. No unbounded job queue.
* 30-second wall deadline; 25/26-second soft/hard CPU limit; 192 MiB Java heap;
  2 GiB virtual address-space limit; bounded metaspace, class space, direct
  buffers, code cache and thread stacks. The virtual-address cap is not a claim
  that 2 GiB resident memory is required.
* 64 file descriptors; 2 MiB per generated file/report; 64 KiB combined engine
  stdout/stderr. A timeout or output overrun kills the private process group with
  `SIGKILL`, including descendants. Capacity is released only after process/output
  closure. Private temporary files are removed on both success and failure.
* No shell, daemon, user-provided CLI arguments, or inherited Java-option
  variables. JAXP remote DTD access is disabled and schema/stylesheet access is
  restricted to local files. The pinned KoSIT repository-relative resolver
  provides a second boundary for transformations. This bounded process is
  **not an OS network or filesystem sandbox**.
* Engine reports are parsed as bounded XML, never rendered as their embedded
  HTML. Engine identity, exact original hash and required XML/XSD/Schematron step
  evidence must agree. Up to 256 plain-data findings are retained with rule ID,
  severity, XML field/line reference and bounded text. Errors beyond the display
  cap still prevent a pass. Informational guidance is shown as `WARNINGS`, not
  hidden behind an unqualified pass.

## Durable evidence and restore

`PurchaseValidationReport` is append-only, including SQLite update/delete
guards. There is no edit/delete endpoint. Each report binds the original hash,
checker, engine, release hash, rule version, profile, check time and findings.
The current owned original must be resolved and integrity-checked before reports
can be created or read. An arbitrary hash or an old numeric source ID is never
an authorization token.

Tenant plus original SHA-256 is the authoritative source identity across
restores. `sourceDocumentIdAtCheck` is an informational snapshot only; it is
neither a foreign-tenant link nor a download target. Portable UUIDs are scoped
by tenant; internal database UUIDs can be remapped. Explicit reruns append new
reports and preserve previous ones. Request retries reuse one request UUID.

Backup schema `20261022010000_add_purchase_validation_reports` adds an explicit
`purchaseValidationReports` capability/section. Historical schema
`20261021150000_add_payment_adjustments` retains its old meaning. Older schemas
reject even an empty future report field. Reports must bind to included original
hashes and pass a closed version-1 structure and semantic fingerprint check.

The combined project/validation release uses the separate capability identity
`20261022011000_combine_project_purchase_validation`. The project-only
`20261021160000_add_project_service_times` does not gain reports; the standalone
validation identity does not gain projects or duration/capture fields. The
existing project import, capture-fingerprint and invoice-assignment guards are
preserved unchanged.

The release combining project capture, durable mail outbox and validation uses
`20261022030000_combine_projects_outbox_validation`. The project/outbox identity
`20261022020000_combine_projects_outbox` and outbox-only identity
`20261022000000_durable_mail_outbox` do not gain validation reports. Conversely,
the standalone and project/validation identities do not gain outbox capability.
Runtime mail jobs and attempts remain excluded from backups at every version;
restore never imports or reactivates them. Target-owned mail evidence and
append-only validation history both survive destructive business-data restore.

Imported reports are always `IMPORTED_HISTORIC`, never current technical passes.
Restore performs no automatic validation. Reimport is idempotent; same portable
UUID with changed immutable content aborts the complete transaction. Target
history is never deleted during overwrite. Proof whose original is no longer in
the target remains retained but is neither exported nor queryable without a
currently owned, verified matching original. A rule/checker update requires an
explicit new check; old reports are not silently promoted or overwritten.

Validation does not change the source revision, extraction flag, review status,
supplier assignment or financial records. Existing expense-approval guards are
unchanged. `PurchaseParsePreview.validationStatus: NOT_VALIDATED` continues to
describe extraction only; the technical report has its own independent status.

## Verification and remaining gates

Recorded source checks on 2026-10-21:

* 24 focused tests passed: real pinned CII and UBL positives, official wrong
  totals/missing required field/XSD rejection, informational findings, unsupported
  profile/type, missing tools, unsafe XML, preflight external-entity rejection,
  reachable schema-hint canaries with zero requests,
  timeout/group kill, capacity and cleanup; owned/replayed/stale requests,
  immutable history, no financial changes, audit rollback, cross-tenant historical
  restore, reimport/overwrite and collision rollback.
  The canary first proves loopback reachability, then supplies schema-location
  hints on CII/UBL roots and in foreign lax UBL extension content. Final behavior
  is early `UNSUPPORTED`, no endpoint requests and no engine call. Separate
  relative/file/jar/encoded-location cases preserve the original hash and expose
  no referenced content. No-hint CII/UBL positives still reach and pass the real
  engine. This is not a claim of exhaustive network isolation; the gate avoids
  trusting upstream file-only XSD access as a repository filesystem sandbox.
* Existing affected backup suites: 40 tests passed in the final focused pass.
* After integrating the project release, all 200 tests across 20 backup,
  billing-note and project-route suites passed. Two additional tests preserve
  the exact standalone/combined capability meanings; the existing manual-duration
  suite also passed. Historical test fixtures omit the new empty report section
  rather than relabelling a future field as an old schema.
* Full TypeScript check passed. Focused changed-file ESLint passed.
* The full native ESLint process was killed under concurrent memory pressure;
  this is not recorded as a successful full lint check.
* Production build, full unit suite and real browser acceptance remain required
  on the exact final candidate. No native production build or browser run is
  claimed here.

The hosted unit job installs the pinned artefacts and enables the real-engine
tests. The hosted functional job installs the same artefacts before running the
normal isolated runner. `e2e/incoming-validation.spec.ts` covers CII/UBL acceptance,
invalid/unsupported results, version/hash/stale requests, safe retry, reload,
history, keyboard/focus, 1440/390/360 widths, unchanged originals and zero posting.
It is authored acceptance coverage, not a claim that the browser run has passed.
Only `incoming-validation-desktop-1440.png` and
`incoming-validation-mobile-390.png` are added to the existing exact screenshot
allowlist; the aggregate 5 MiB and lossless full-pixel verification policy is
unchanged.

For a fresh local synthetic check, install into an empty temporary directory:

```sh
node scripts/einvoice-validation/install-runtime.mjs /tmp/bivaro-offline-invoice
BIVARO_EINVOICE_TEST_ASSETS=/tmp/bivaro-offline-invoice \
  npm test -- lib/__tests__/purchase-validation-runtime.test.ts \
  lib/__tests__/purchase-validation-process.test.ts \
  lib/__tests__/purchase-validation-report.test.ts \
  lib/__tests__/purchase-validation-service.test.ts --maxWorkers=1
```

Set `BIVARO_EINVOICE_ASSETS` to the same directory for the application/browser
runner. Use only the runner-owned temporary database and synthetic originals.
