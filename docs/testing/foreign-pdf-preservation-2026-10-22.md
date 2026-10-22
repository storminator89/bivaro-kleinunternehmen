# Narrow foreign PDF/A-3b attachment compatibility (#118)

Status: **implementation pending independent review and real native acceptance**.
This is a **local combined integration candidate**, not a claim that AI or
PR125 has merged. No foreign hosted workflow/native-worker/validator/browser
acceptance is claimed here. Local build/inspection results are scoped below. Base: accepted main `3c4fd511` (PR124); reviewed source `9e2c7a1`.

## Explicitly approved capability reduction

The user asked for complete Ghostscript removal. After the distinction was
explained, the user accepted (`Sentinel_772bb6a2823c819184e77e574211e2a9`,
“Ja passt”) the following narrower legacy API: no repair of missing fonts or
unsuitable colors; XML attachment initially only to already valid PDF/A-3b;
reject signed/encrypted PDFs and existing attachments rather than damaging them.
Own invoices, ordinary receipt upload/storage/download and ordinary PDF AI
analysis are not meant to be restricted by this legacy-route change.

`/api/pdfa3` has no remaining production repository caller after PR124; external
API clients are unknown. A missing in-repository caller is not evidence of no
external use. It remains authenticated and CSRF/origin protected. It returns
explicit unsupported errors, never a silent raster/reconstruction substitute.

## Contract and implementation

- Unchanged input bounds: PDF 20 MiB, XML 8 MiB, combined 25 MiB. The existing
  maximum derived-output bound remains 40 MiB. Invoice number is a bounded
  compatibility parameter; source title/visible content are not rewritten.
- The source **itself**, not just the candidate, must pass the independent
  pinned official veraPDF 1.30.3 PDF/A-3b profile. No metadata-only claim and no
  opportunistic acceptance of an ordinary PDF that happens to yield a valid
  candidate. No font substitution, color conversion, rasterization or repair.
- Reject encrypted input, signatures/signature dictionaries/certification rights,
  all AcroForms/XFA, embedded-file/name-tree/AF attachments (including conservatively
  detected orphan objects), active content and unsupported/malformed structures.
  No existing attachment is removed or replaced. This is not cryptographic
  signature validation or preservation of signatures on a rewritten derivative.
- Parse/serialize **all foreign PDF objects and XMP** only in the separately
  confined Node worker. It loads the document rather than copying pages; does
  not call `copy()`, `copyPages()`, render pages or run drawing operators.
- Keep source output intents and ICC streams unchanged, including non-sRGB
  profiles. Do not call the controlled-own-invoice metadata helper, which would
  replace output intents/XMP. Existing XMP RDF properties and extension schemas
  are preserved semantically; modification dates are synchronized. Add the
  Factur-X properties/schema without replacing the whole metadata tree.
  XML comments/packet serialization are not promised byte-for-byte preservation;
  page/resource stream bytes and original archive bytes are the relevant
  preservation contract. Unmergeable metadata is explicitly unsupported.
  Preexisting FX properties in element or abbreviated RDF-attribute form,
  existing FX extension namespace definitions, competing `fx` schema prefixes
  and non-scalar schema identities are rejected before adding metadata.
- Caller-supplied XML must be well-formed UTF-8 CII with the declared EN16931
  guideline identity as exact simple character data (plain text or CDATA),
  never nested/mixed content or trimmed-to-match text. A bounded streaming
  syntax/identity check rejects DTDs,
  entities, incompatible encodings and excessive nesting. This check is **not**
  an XSD, Schematron, complete Factur-X-profile or business-rule certificate and
  does not prove visible PDF contents match the XML. Exact accepted XML bytes,
  including an optional BOM, are embedded unchanged.
- Only an independently validated candidate can leave the route. Source/XML/
  candidate SHA-256 values bind the fixed worker protocol; candidate length,
  regular-file identity, link count and hash are checked after the entire
  process group and its output descriptors have closed. No mutation after the
  final independent byte gate.
- Known unsupported input is `422` plus a stable code. Unavailable confinement,
  timeout, wrong/missing validator version, malformed/unknown report or process
  failure is `503 PDF_PROCESSING_UNAVAILABLE`. A final nonconforming candidate
  after a valid source is also503, not a claim that the source requires repair.
  Size errors remain `413`;
  processing capacity remains `429` with Retry-After. Internal paths, report
  content, input strings and process diagnostics are not returned or logged.
- This endpoint is **stateless**. It does not archive its submitted files, save
  the derivative, reserve a number, issue/book/send a document or invoke AI.
  Original storage/download/backup/restore paths and already archived hashes are
  unchanged. A conversion error must not say the submitted file was archived.

## Confinement and own-invoice compatibility

The foreign Node worker is Linux x64/arm64, non-root only:
`prlimit -> setpriv(no-new-privs, Landlock, seccomp) -> Node permission mode`.
It has no application/data/home/proc read grant, network rights, child-process
rights or native addons. Only enumerated immutable worker/package assets and
source/XML are readable, and only the single precreated candidate file is
writable. No file creation/deletion/link/rename rights. CPU25s, wall30s,
address-space1GiB, V8 heap192MiB, file40MiB, descriptors64, diagnostic4KiB.

Untrusted source PDFs also require stronger verifier isolation than the old
controlled-own-invoice output. The shared verifier therefore has a foreign-only
kernel-confined **direct Java** mode: no shell, inherited Java options or
application secrets; read-only exact veraPDF distribution/JRE/private input,
no `/proc`, app/database/uploads/home or write/network grant. No perf-data/
attach/container-discovery side channel. The pinned official CLI main class,
version/profile and strict JSON report contract are unchanged. Every JVM has
CPU25s/26s hard, wall30s, address-space2GiB, heap192MiB and 2MiB report/output.
Missing kernel/runtime support is fatal; there is no unconfined retry.

The established own-invoice wrapper still uses its existing launcher, limits,
error type/name/public text and status500. Foreign nonconformance422 versus
infrastructure503 is mapped internally; it must not change own-invoice behavior.
Both source and final verification include a version check. Each process is
bounded; this is not a promise of an overall30s API deadline.

Seccomp policy is independently copied/reviewed for this worker, not a shared
runtime refactor of the still-active AI adapter. The compile-time enosys policy
has ABI validation, denied network/IPC/process escapes, unknown-number and x32
rejection, thread-only clone, and exact fd1/2 FIONBIO allowance. It is policy
DATA, not a PDF renderer or a syscall bypass.

## Explicit combined packaging integration — native acceptance pending

The reviewed additive `scripts/foreign-pdf/Dockerfile.integration.patch` is now
**applied to the actual production Dockerfile**. It copies the exact worker/CJS
runtime closure (including nested tslib) and builds policy DATA in the native
runner stage. It depends on the reviewed AI candidate image's `util-linux-extra`/`enosys`
provisioning. The retained patch is provenance, not a workflow-side mutation.
The native gate builds the actual Dockerfile and never applies hidden changes.

Integrated local parents and their upstream mappings supplied by the coordinator:

- AI `df51a97b30e2922f87dafeaf8e20f7e4e55b56a8` → canonical
  `747080090e4c9a8312a3180e417ec61f7802555f`, tree `1ed0b2a5`;
- notice `db1e147e880af16025db3b9a920c8374df84a3dd` → canonical PR125 head
  `3ee6426fb60f62a09ab416709b1c5b38bfa4c3d1`, tree `774090f6`;
- browser budget `68af497e061d839bce008bd1332bfea5ac3eb779` → merged main
  `483f96af742d8284b4b652a18bb12cb103e1afda`, tree `89a8e387`
  (45-minute orchestration only).

Each local/canonical pair was independently checked for exact tree equality.
Protected non-document AI source, tests, workflow and package-lock bytes remain
identical to the AI parent. Notice installer/generator/container inspection and
their pure tests remain identical to the notice parent. Shared Next config adds
only the foreign tracing closure; shared package scripts retain both lifecycles.

The browser45-minute workflow and budget-test bytes were already identical in
the combined AI/notice parent. Its ancestry merge retains those bytes and the
stronger AI/own-invoice/notices implementations; it must not reintroduce an old
installer, metadata validator, package list or duplicate Next configuration key.
The combined source retains prebuild diagnostic-worker preparation, postbuild
notice generation, build-only probing, resource caps and existing native gates.

**Ghostscript removal is still separate and pending combined acceptance.** Both
production PDF callers now have replacements in this source, but the package,
minimum-version guard, legacy runtime smoke and browser-CI apt/probe contracts
are deliberately retained. Prior AI/native/notices results do not establish
foreign-worker/direct-JVM startup or combined-container acceptance. After both
replacements are accepted, integration must remove those remaining dependency
paths and prove actual images/SBOM contain neither `ghostscript` nor `libgs*`.
Keep historical reports; do not rename credit-note `GS-…` identifiers. License
changes are separate; this is not a project-license approval or complete SBOM.

## Verification actually performed locally

Only pure parser/serializer fixtures, mocked process/route/validator/kernel
contracts, type checking, lint, syntax checks and the coordinator-granted
production build are allowed here. Local
Landlock was previously confirmed unavailable (`ENOSYS`) and local Chromium
blocked (`EPERM`); neither is retried or bypassed. No unconfined native worker,
Java foreign parsing, native conformance gate or browser function test runs here.

The source-only review matrix passed213 tests in10 files. On combined code
`214632f` (before the subsequent accepted navigation-guard integration), the
full suite passed **2887 tests,27 existing conditional skips** (211 passed and
3 skipped files). The first launch raced completion of the independent Prisma
client generation and failed imports; a full rerun after generation passed.
No shared dependency installation/client was modified. Full TypeScript and
full ESLint passed; source syntax and `git diff --check` were clean.

The granted production build also passed on that combined code with
Node22.23.4 and a synthetic build-only database URL. Both the hash-checked AI
prebuild adapter and scoped notice postbuild ran. A static standalone inspection
matched1718 asset hashes/modes across the complete required package trees,
7 required runtime package installations (including
nested tslib1.14.1), invoice fonts/ICC assets and scoped notice outputs. The
adapted PDF.js worker remained0444. Required packages are production lockfile
entries. Native filters are **not** generated or executed locally: the actual
Docker runner compiles both recipes and marks output0444. These checks are not
a Docker image, native confinement, PDF/A conformance or browser acceptance.
Passing mocked lifecycle tests is not native confinement or PDF/A evidence.

The accepted navigation guard was subsequently merged from local
`6a09808c0c164cb5cea116b55a267e5a6fd5bee8` (tree `c1124c3d`), retaining its exact
protected UI/E2E source and52-image browser workflow union. The coordinator
reports accepted upstream main `870d73be87dafa5918e0172bdf0ebe818684aa48`;
no full-tree equality between that merge and the local guard parent is claimed.
Post-guard combined code `c85755a` passes **2972 tests,27 existing conditional
skips** (215 passed and3 skipped files), full TypeScript and full ESLint.
Ordinary browser discovery via the official fresh-fixture runner reports
**124 tests in36 files** with `--list` only: no application server/browser or
functional test body was started. The52-image allowlist and guard source are
byte-identical to their parent. A final production rebuild on this guard-inclusive
candidate remains required after the shared build slot is available; the earlier
build does not count as that final proof.

## Mandatory hosted acceptance — not yet run

`.github/workflows/foreign-pdf-compatibility.yml` requires genuine native Linux
amd64 and arm64 runners, the exact production Dockerfile/image and Node22.23.4.
No architecture emulation, mocks, alternative validator, privileged flags,
security-profile relaxation, host app/data mounts, provider credentials or
networked runtime. Build-only downloads remain the existing pinned tools.

1. Trusted synthetic fixture generation compiles the **exact production parent**
   with TypeScript alias resolution only, no behavior substitutions. Both that
   launcher and the real authenticated standalone HTTP API must process source
   PDFs under the actual worker/verifier confinement. Failure cannot be skipped.
2. Three positive two-page files: embedded searchable fonts/vector text, vector
   transparency, and scanned JPEG pages. Source and final bytes are independently
   PDF/A-3b-checked. Exact XML attachment bytes, page dimensions/rotation, every
   page/resource/profile stream and output intent are checked. Serialization
   container streams (ObjStm/XRef), XMP and newly embedded XML are intentionally
   excluded from page-resource identity comparisons.
3. Seven negative files: real encrypted PDF; conservative synthetic signature
   dictionary; form; existing attachment; missing embedded font; wrong PDF/A
   part; malformed input. Both parent and HTTP must explicitly reject them422.
   The signature fixture is not a claim to test cryptographic signatures.
4. Ordinary receipt upload with explicit manual analysis archives synthetic
   source PDFs with and without an existing attachment. Their actual original
   download SHA-256 values are checked before/after all derivations/rejections.
   Financial/count snapshots must not change through `/api/pdfa3`.
5. Retained exact source/final hashes and architecture manifest must match.
   Independent Poppler renders **every page at scale2000**; source/final pixels
   must be byte-identical and extracted text equal. Retain these synthetic
   pages for readable human review; a manifest alone is insufficient.
6. Existing own-invoice native gates and broad browser/archive regressions are
   still required after integration. CMYK preservation is covered by a pure
   structural fixture, not a yet-executed real CMYK PDF/A conformance corpus.
   No unsupported compatibility claim may be inferred from the three positives.

## Confined JVM startup dependency correction (candidate)

Exact canonical PR126 head `80f2ba665276a68da4c779b448c10e0ca78a084f`, [native run 39810457457](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39810457457), failed on both genuine architectures at the additional `source-precheck-vector-text` with the closed diagnostic `kind=unavailable,status=503`. This is verifier infrastructure failure before production derivation, not a coherent nonconformance/422 or a demonstrated worker failure. Its artifacts contain only the safe diagnostic; no positive final-byte acceptance is established.

Read-only installed Debian JRE layout inspection found a physical `javaHome/conf` directory with the individual `security/java.security` symlink targeting `/etc/java-21-openjdk/security/java.security`. The native image build logs install Debian OpenJDK 21.0.12.1+1-1~deb13u1. [Official OpenJDK 21 Security initialization](https://github.com/openjdk/jdk21u/blob/master/src/java.base/share/classes/java/security/Security.java#L89-L99) must open this required configuration and throws an error if loading fails. The old directory grant did not cover its external symlink target. This establishes a necessary startup dependency defect, **not that it is the only cause of the observed 503**.

The candidate replaces the explicit conf-directory grant with one read-only regular-file grant: canonical `javaHome/conf/security/java.security` when physically inside that exact layout, or the exact Debian 21 target above. Every other target, missing file, nonregular file or residual symlink fails closed. It does not recursively inspect configuration or grant `/etc`, management credentials, a configuration directory, execution or writes. Existing system-library/JRE/distribution/private-input reads, CPU/memory/walltime/output limits, credential-free environment, process-group cleanup, seccomp, no-network and no-fallback rules remain unchanged. Pure construction tests cover physical layouts, both Debian architecture path layouts, missing/unsafe/nonregular/symlink targets. No local JVM or confinement execution is claimed; independent review and exact-source hosted native acceptance remain mandatory.

The same head's ordinary CI had one source-contract assertion failure (2990 other cases passed): it searched every launcher argument for `/home` and therefore mistook the trusted seccomp-filter filename under GitHub's checkout for a filesystem grant. The assertion now examines `path-beneath` grants, with an explicit mocked `/home/runner/work` construction regression. This does not change a runtime rule or relax the no-home-filesystem-grant requirement.

## Closed verifier phase drilldown (candidate)

The exact subsequent head `42bd79c170d06579ad8f0bef83a97c02745ee833`, [run 39813397641](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39813397641), still failed both confined source prechecks with unavailable/503 after successful production image builds. This confirms the necessary configuration fix was not sufficient; no additional filesystem/resource permission is inferred.

A diagnostic-only candidate annotates internal failures with fixed enums for directory/construction, version launch/result/identity, input write, validation launch/result, report and cleanup. Failed bounded child streams may contribute only a static known JVM/launcher marker category and closed process outcome. Separate 256-byte tails handle markers split across chunks; full stderr is not retained, and arbitrary messages/paths/report data never reach the synthetic harness. Unknown values stay unknown. Marker categories are hints, not causal proof or acceptance evidence. The synthetic harness re-whitelists every enum before printing or retaining safe failure JSON. Public messages, statuses, API schema, own-invoice error wrapping, final-byte report requirements, commands, capabilities, limits and lifecycle are unchanged. No native rerun or local JVM execution is represented by pure tests.

### Trusted no-input startup drilldown (not PDF acceptance)

The native harness additionally probes bare JVM `-version` and the trusted
veraPDF CLI `--version`, before giving either process any PDF, invoice XML or
user input (only exact trusted default configuration is present). This
distinguishes JVM startup from CLI initialization (including configuration),
without assuming which dependency is missing. Both use the exact compiled
production command/resource/environment recipe and confinement policy, in a
fresh private trusted-configuration-only directory; CLI defaults and all read/write/network/process
restrictions remain unchanged. No application environment is inherited.

Only these synthetic no-document startup probes may record a sanitized
diagnostic excerpt: known private workdir, other paths, URIs, controls and
credential-looking assignments are redacted, with a shared maximum of 4096
UTF-8 bytes across both probes. Successful probes retain no output. No raw
production validation output, exception text, document data or credentials are
recorded. `startup.json` provides startup/configuration evidence, never PDF
acceptance; the unchanged actual production
source/final validation, derivation, API, archive-byte and pixel assertions
remain mandatory. A diagnostic probe is never an alternate validator or proof
of PDF/A compliance, and never enables a write grant or fallback. Pure mocked
tests cover the trusted-config-only/version-only boundary, inherited-secret exclusion,
redaction/UTF-8 cap, output/wall bounds and group-kill/close-before-cleanup.

### Proven CLI initialization fix: trusted preseed, no JVM writes

At exact canonical `8979b6f7d45d2a2846805af5263fb2d1ef32dd19`, both genuine
native architectures passed bare JVM startup but the CLI failed during
`Applications.createAppConfigManager`/`configRoot`/`tempRoot`, before document
input. This is an observed configuration-initialization failure, not PDF
noncompliance or proof that all later stages work.

A fresh private build-only `.verapdf/config` is created before the existing
authentic `--version` probe, which generates the five upstream
defaults (`app.xml`, `features.xml`, `fixer.xml`, `plugins.xml`, `validator.xml`).
Its private `user.home=.` excludes prior operator/home or installer configuration; startup
budget, heap, credential-free environment and exact version checks are unchanged.
The build packages their **unchanged bytes**, archive/JAR/version provenance
and per-file byte lengths/SHA-256 identities. Assets stay root-owned and
non-writable by the application; JARs, profiles and global `/opt/verapdf/config`
are not modified. Missing/empty/oversized/nonregular/linked/unsafe sources fail.

Only on the foreign confined path, the parent checks bounded canonical regular
root-owned assets and copies these exact defaults into its existing private
0700 workdir's `.verapdf/config`, using 0600 exclusive-create files. Upstream
DAC `Files.isWritable` checks can therefore pass; **Landlock still grants the JVM
no writes at all**. Preparation failures remain infrastructure 503, not 422. The
own-invoice unconfined launcher and conformance arguments/defaults are unchanged.

A dedicated foreign-only first classpath directory supplies a standard JUL
empty-handler configuration, preventing optional FileHandler tempfile creation.
No validation rule or profile is replaced. `.level=OFF` alone is insufficient
because CLI later sets levels; empty handlers remain empty. Per-file logging
also remains disabled by the unchanged default (no `--addlogs`/`--config`).
Pinned source: [config creation](https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/apps/src/main/java/org/verapdf/apps/Applications.java),
[default initialization](https://github.com/veraPDF/veraPDF-library/blob/v1.30.3/core/src/main/java/org/verapdf/processor/app/ConfigManagerImpl.java),
[logging resource lookup](https://github.com/veraPDF/veraPDF-library/blob/v1.30.3/core/src/main/java/org/verapdf/core/utils/LogsFileHandler.java),
[JDK21 resource order](https://github.com/openjdk/jdk21u/blob/master/src/java.base/share/classes/jdk/internal/loader/URLClassPath.java).

The synthetic startup diagnostic now uses that exact shared parent preparation.
Before **and after each** version-only launch, it requires precisely the pinned
configuration tree and unchanged hashes: no PDF, invoice XML, user configuration
or extra file is allowed. Its artifact records only bounded source identities,
not XML contents, paths or document data; the same 4 KiB sanitized startup-only
excerpt cap remains. Actual production source/final, worker/API, archive-byte
and independent pixel/text gates are still mandatory. No unconfined runtime
retry, core wrapper, write grant or compliance heuristic is introduced. New
native success is unverified until the exact subsequent hosted gates pass.

## Fixed synthetic validation-stage diagnosis (candidate)

At exact canonical `a8a93820d30361b6379f830eef2ea8ee659d66a5`,
[native run39827040211](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39827040211)
passed bare-JVM and confined CLI version startup on both genuine architectures.
All five packaged/copied default configuration hashes were identical between
architectures and remained unchanged. The subsequent mandatory vector source
precheck failed at validation-result/nonzero-exit with unavailable503. Neither
source noncompliance nor a specific infrastructure cause is established by that
closed diagnostic; no final/worker/API/archive-after/pixel acceptance exists.

The additional diagnostic accepts only the fixed, freshly generated synthetic
`vector-text.pdf`, bound by exact byte count/SHA-256, actual checkout revision,
generator/font/lock snapshots and PDFKit0.20.2's actual **ESM** entry digest.
PDFKit's default date/document ID makes bytes run-specific: no deterministic
hash or raw-PDFKit conformance is assumed. The source checkout is genuine
`GITHUB_SHA` (the merge checkout on PRs), not mislabeled as the canonical PR
head. Its checkout tree must independently match the reviewed candidate tree.
Snapshots stay on the existing read-only fixture mount; ESM code and its
package-export/version evidence come from the existing read-only dependency
mount. No incidental `/app` lock/source packaging or unexported package.json
resolution is assumed, and no new mount or customer/production input is added.

After strict provenance verification, a fresh private directory contains only
the authenticated config and exact copied vector PDF. Tree, regular-file,
ownership/mode and byte hashes are checked before and after the exact shared
production validation command. All credentials exclusion, caps, no-write/
network confinement, process-group termination, close/reaping and cleanup
remain unchanged. The diagnostic records a closed exit bucket and a strict
exact-identity/size/profile/job/count coherent-report verdict. Coherent
noncompliance emits only bounded numeric rule references/counts, never check
contexts/document text. Only infrastructure/parser failures may emit a maximum
4KiB sanitized **synthetic-only** excerpt. No production/API stream capture is
added; unknown exceptions remain undisclosed. Mandatory production source/final,
worker/API, original-archive and independent pixel/text gates still follow and
cannot be replaced by this probe.

Pinned [CLI exit codes](https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/cli/src/main/java/org/verapdf/cli/CliConstants.java)
and [summary handling](https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/cli/src/main/java/org/verapdf/cli/VeraPdfCliProcessor.java)
also establish a separate rejection-contract defect: coherent noncompliance
exits1. Only confined validation exit1 **plus** the complete existing strict
noncompliance report can now take unsupported422; it can never pass validation.
Compliant/ambiguous/malformed reports, other exits, version failures and earlier
stream/output/time/lifecycle errors remain503. Bounded late pipe data is drained
through close before this decision. Own-invoice invocation and its public500
contract are unchanged. This correction does not establish the vector fixture's
actual conformance or explain its current failure; genuine new native evidence
is still required.

## Bounded stream materialization candidate (19:29 UTC; native acceptance pending)

The next genuine both-architecture run39834457147 (reviewed headb28ddbaf;
actual checkout40bff614, both tree71f77975) separated startup from validation:
both JVM/CLI version probes passed, but the fixed vector source produced a
coherent exit1 report with one failed rule/check, ISO19005-3 clause6.2.11.4.1
test1. This reports a font-program embedding/parsing predicate; it does **not**
prove the generated font is absent or corrupt. No foreign positive/final/pixel
acceptance was reached, and the production source correctly rejected with422.

Pinned parser source explains a supported processing incompatibility:
[TrueTypeBaseParser](https://github.com/veraPDF/veraPDF-parser/blob/v1.30.3/src/main/java/org/verapdf/pd/font/truetype/TrueTypeBaseParser.java)
materializes decoded font input through
[SeekableInputStream](https://github.com/veraPDF/veraPDF-parser/blob/v1.30.3/src/main/java/org/verapdf/io/SeekableInputStream.java),
whose default10KiB threshold can invoke
[InternalInputStream temporary storage](https://github.com/veraPDF/veraPDF-parser/blob/v1.30.3/src/main/java/org/verapdf/io/InternalInputStream.java).
The validator intentionally has no filesystem-write grant. A font-parser
IOException can become a failed embedding predicate in the official model.
This source mechanism is not yet proof that it is the sole native failure.

The foreign-only immutable application entrypoint sets the public supported
new-stream maximum to2097152bytes and memory threshold to2097153, then delegates
unchanged `GreenfieldCliWrapper.main(args)`. It does not catch/rewrite arguments,
output, exceptions or exits; official foundry initialization, profiles, rules,
reporting and strict independent acceptance remain unchanged. Own-invoice
invocation is unchanged. Existing192MiBheap/2GiBAS/CPU25:26/30swall/2MiBoutput,
network/process restrictions and completely no-write JVM policy remain intact.

This is **per newly materialized non-seekable stream**, not a global PDF,
decoded-memory or universal no-temp bound. Already-seekable inputs bypass these
setters; other direct temporary-file paths remain denied. A read can transiently
observe up toN+2048bytes before rejection. Prefix concatenation also duplicates
buffers and is quadratic (roughly1GiB cumulative copying for a full2MiB stream),
so the unchanged process caps remain authoritative; this is not a performance
claim. Over-cap exceptions fail closed; actual native rejection status is
recorded rather than presumed, and can never be acceptance evidence.

Only the build asset stage installs Debian's build-only default-jdk-headless.
The compiler consumes one fixed SHA-bound trusted source, exact pinned CLI JAR,
UTF-8/target21/`-proc:none`/`-g:none`, a private directory and credential-free
bounded child recipe. The final runner retains only the existing JRE; the
native gate checks both absence of javac and installed JDK packages. Runtime
verification requires an exact root-owned nonwritable single-application-class
tree, fixed source bytes, actual official-JAR/class digests and strict compiler
receipt. Source/class/compiler launcher/module-image/package/flags are retained
for independent actual-build verification: an arbitrary manifest's assertion
alone is not treated as proof of source/bytecode equivalence. No official class
is shadowed, no runtime compiler or unconfined retry is added.

Closed generated writer-object evidence records actual encoded/decoded font
lengths and referenced standard-font count without PDF parsing or exporting
font names/text. It is bound to exact vector bytes, checkout, generator/font/
lock/PDFKit ESM and helper hashes. Additional trusted same-font fixtures retain
the original program prefix and append zero padding atN and N+2048. The confined
official validator must genuinely accept the at-limit case; the over-limit case
must reject and records only closed status/phase metadata. These budget fixtures
claim no additional visual coverage or PDF repair. The original three complete
vector/Unicode/transparency/scan derivations, seven rejections, archive/hash/
stateless checks and independent complete page-pixel/text comparisons remain
mandatory and unchanged. No local JVM/compiler/native or browser evidence has
been produced for this candidate. Rejection is not a claim that every source
outside this supported processing profile is intrinsically malformed.
