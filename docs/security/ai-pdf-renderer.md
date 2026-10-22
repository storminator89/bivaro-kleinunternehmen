# Optional receipt AI: isolated PDF.js renderer (#116)

Implementation status: draft. Native/runtime, malformed-PDF, browser and
architecture acceptance must pass against this exact implementation before
acceptance. Unit or static checks do not establish native enforcement.

## Scope and data flow

Only `lib/purchase-documents/ai-input.ts`'s optional receipt rasterization changes.
The configured OpenAI-compatible provider, explicit consent/configuration checks,
source-hash ownership checks and human review before financial capture stay in
the existing extraction service. Original archived bytes and hashes are not
rewritten. The provider receives ordered JPEG data URLs only, never the PDF,
local paths, metadata, attachments or a document URL. Manual review remains
available on any preparation failure. The separate foreign-PDF Ghostscript
conversion path is intentionally unchanged (#118).

PDF.js parses and renders; no custom PDF interpreter, viewer or script sandbox
is loaded. `--disallow-code-generation-from-strings` is defense in depth. XFA and
JavaScript-driven forms require manual review rather than silently omitting
dynamic information. Every parser/rendering diagnostic is fatal (including
PDF.js informational recovery/unsupported-content messages and warnings delivered through `console.log`). `stopAtErrors` alone is not a
complete no-recovery guarantee. Every page must finish its operator list and
render without diagnostics, contain non-uniform visible pixels, be included in
order and be confirmed by the final completion record. An intentionally blank
page is conservatively rejected, not silently skipped. This is not a guarantee
that every semantic visual discrepancy in an arbitrary PDF can be detected.

## Limits and kernel boundary

- Input PDF: 6 MiB, PDF signature, 1–4 pages. The child checks the actual
  parsed page count before rendering; >4 pages produces an explicit page-limit
  exit mapped to AI_PDF_LIMIT. No partial extraction, truncation or fifth-page
  omission is accepted.
- Geometry: 20–2000 PDF points per dimension, aspect ratio at most 25; output
  approximately 100 dpi, edge at most 2200, approximately 4 million pixels/page.
- Embedded image/auxiliary canvas: 4096 edge/16 million pixels; 24 million live
  canvas pixels and 64 million cumulative allocation pixels; 100,000 operators
  per page. Any PDF.js oversize-image skip warning rejects the whole document.
- Parent permits only five pre-created writable files. No creation, deletion,
  linking or renaming rights are granted. OS file-size cap is 2 MiB each (a
  bounded maximum of 10 MiB writable files); normal page output is at most 2 MiB
  per page/6 MiB aggregate, with a 4 KiB completion record.
- `prlimit`: conservative starting 1 GiB address-space cap (including native allocation/virtual
  mappings), 15 seconds CPU, 64 descriptors, no core dump. These are proposed
  starting limits, **not yet justified by native measurements**. V8 code space
  and WebAssembly can reserve virtual addresses without resident allocation;
  `--disable-wasm-trap-handler` avoids the trap handler's large address-space
  reservation. Whether the reviewed workload fits this cap requires
  native amd64/arm64 measurement; do not raise it silently. Independent cBPF
  review and thread-compatibility acceptance are also required before release. V8 old space is capped
  at 128 MiB, but that is **not** a native-memory bound. Parent wall deadline is
  20 seconds and diagnostic output is capped at 64 KiB.
- `setpriv --no-new-privs --landlock-access fs` grants read-only access only to
  the Node executable, required system libraries, specific public module trees,
  renderer script, original and a few runtime files. It grants write rights only
  to the five request files. No app/database/upload/home/proc tree is allowed.
- util-linux `enosys` compiles native seccomp policy. Small classic-BPF policy
  **data** extensions reject the entire x32 ABI, require `CLONE_THREAD` for clone
  and return ENOSYS for clone3 so libc can use clone for legitimate threads.
  Numbers absent from the build's complete architecture syscall inventory
  are denied too, so newer host syscalls cannot bypass the named denylist.
  Separate processes, process-group/session escape, sockets/networking,
  io_uring, cross-process memory/handles/signals, IPC, namespace changes and
  filesystem metadata mutations not mediated by Landlock are denied.
- The child pins `--openssl-config=/dev/null`. Node initializes OpenSSL before
  JavaScript; the renderer must not read host OpenSSL configuration or inherit
  `OPENSSL_CONF`. `/dev/null` is already read-allowed, so this adds no filesystem
  grant or host change. This network-free renderer does not assert FIPS validation
  or adopt an operator's global TLS/provider configuration.
- Child environment is constructed from fixed values only. No inherited API
  keys, proxy variables, database URL, PATH, NODE_OPTIONS or credentials; stdio
  contains only anonymous pipes/no terminal. Parent kills the detached process
  group on every outcome, awaits close, and deletes temporary files in finally.

Node's JavaScript permission model is only defense in depth. `--allow-addons`
necessarily allows native canvas; Node permissions do **not** confine that
native code. Landlock/seccomp provide the relevant OS enforcement. This policy
is not a VM or a claim of protection from kernel vulnerabilities. Landlock does
not hide all filesystem metadata; stat/access metadata visibility is not being
presented as total filesystem invisibility. No host kernel setting, privileged
container mode, Docker seccomp relaxation or external service is required or
changed. If required Landlock rights/seccomp/runtime support are missing, the
wrapper fails and AI preparation stays unavailable—there is no unsafe fallback.

## Runtime packaging contract (integrated; native verification pending)

Exact reviewed dependencies: `pdfjs-dist@6.4.299`, `@napi-rs/canvas@1.0.13`, plus
npm's matching Linux GNU canvas optional native package on amd64 and arm64.
The child checks these versions, so an upgrade requires explicit review and
acceptance updates rather than silently changing the renderer.

Debian trixie runner needs `util-linux` (prlimit/setpriv) and `util-linux-extra`
(enosys). During **image build only**, run:

```sh
sh scripts/ai-pdf/build-sandbox-filter.sh "scripts/ai-pdf/sandbox-$(node -p process.arch).bpf"
```

This compiles policy bytes using architecture-native syscall definitions; it
does not test or probe native syscalls. Copy `scripts/ai-pdf`, `node_modules/pdfjs-dist`,
`node_modules/@napi-rs/canvas` and the matching Linux GNU native package into the
standalone runtime. No full app tree is granted to the child. The runtime must be non-root; real/effective UID zero is rejected. Inheritable
and ambient capabilities are cleared before exec under no_new_privs. The production
Node engine baseline must not be weakened. Unsupported OS/architecture is
unavailable rather than rendered without isolation.

## Official source checks (2026-10-22, static research)

- [PDF.js 6.4.299 release](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299)
- [PDF.js 2026 scripting advisory, fixed in 6.2.108](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j)
- [Canvas 1.0.13 release](https://github.com/Brooooooklyn/canvas/releases/tag/v1.0.13)
- [PDF.js API and stopAtErrors/maxImageSize behavior](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [Debian trixie setpriv manual](https://manpages.debian.org/trixie/util-linux/setpriv.1.en.html)
- [enosys filter compilation](https://man7.org/linux/man-pages/man1/enosys.1.html)
- [Landlock coverage and limitations](https://docs.kernel.org/userspace-api/landlock.html)
- [seccomp architecture/x32 guidance](https://man7.org/linux/man-pages/man2/seccomp.2.html)

No complete dependency vulnerability audit, native runtime/architecture results
or browser acceptance is established by these static source checks.

## Product prerequisites and current verification

The renderer requires Linux amd64/arm64, the reviewed Node baseline, non-root
execution, seccomp filter installation and kernel Landlock support for all
requested filesystem rights (including refer/truncate, i.e. ABI 3 or newer).
Unsupported confinement is a product prerequisite failure, not successful
rendering. It must never be worked around with a privileged container, relaxed
seccomp/AppArmor policy, a host change or an unconfined renderer.

The [current upstream Docker default profile](https://github.com/moby/profiles/blob/main/seccomp/default.json)
allows `landlock_create_ruleset`, `landlock_add_rule`, `landlock_restrict_self`,
`prctl` and `seccomp`. That read-only source check does **not** establish the
profile, enabled LSMs or behavior of a particular host. Docker recommends
[retaining its default seccomp protection](https://docs.docker.com/engine/security/seccomp/).
The existing native Ubuntu amd64/arm64 CI builds the regular image and runs
`native-smoke.mjs` under the normal profile, non-root, `--network=none`, with no
privileged/security-option override. Its parent launcher is compiled from the
exact production `ai-input.ts`; its fixtures are synthetic PDF-lib-generated
one/two/four/five-page, embedded-raster, blank and excessive-geometry documents. It checks all
pages, original-byte hash preservation, explicit fifth-page rejection,
blank/malformed/truncated/geometry/byte-limit rejection and JPEG output limits.
Any prerequisite failure fails the gate rather than skipping a case.

Initial combined-source local evidence on 2026-10-22, Node 22.23.4 Linux x64
(before subsequent failure-diagnostic/startup changes):

- Reviewed npm dependencies installed; production `npm audit` reported zero
  advisories. This is a dependency-advisory result, not a proof of absence of
  vulnerabilities.
- Full repository units: 2,378 passed across 189 files. Fourteen conditional
  cases were skipped, not passed: six isolated PDF renderer cases, seven
  offline validator integrations without configured test assets, and one
  opt-in performance benchmark. TypeScript `tsc --noEmit` and repository ESLint
  passed against that initial combined runtime source.
- Official util-linux-extra 2.41.5 package SHA256 verified; native x64 policy
  generated successfully (7,720 bytes). Policy evaluator checks are not kernel
  enforcement tests.
- Genuine renderer suite did **not** pass: execution stopped before PDF parsing
  because `setpriv` reported `landlock_create_ruleset failed: Function not
  implemented`. All six native cases failed on this prerequisite. No unconfined
  rerun was used; no positive rendering, malformed-PDF behavior, memory/CPU
  suitability or native architecture acceptance is claimed from this host.
- Production Next build passed with the pinned standalone PDF.js, worker,
  CMaps, fonts, WASM and canvas/native package assets present. The new dynamic
  OS/request-path tracing warning was resolved using explicit asset tracing;
  two existing validation-runtime/upload-path warnings remain.
- Docker was unavailable locally. Native container matrix and real PDF browser
  acceptance remain unrun locally and required in the supported runtime.

Hosted native diagnosis on 2026-10-22:

- Both ordinary-profile amd64/arm64 production images built successfully. The
  first genuine positive renderer call failed before the input stage, with
  fixed diagnostic `openssl-config`, exit 13, on both architectures. No genuine
  positive rendering pass or resource suitability is established by those builds.
- The child-local explicit empty OpenSSL configuration addresses that observed
  startup dependency without granting host configuration access. Its native
  confirmation is pending. No syscall or resource limit was changed on the
  strength of an unconfirmed hypothesis.
- The dependent real PDF browser journey correctly did not run after the native
  prerequisite failed. Ordinary mocked-AI UI acceptance is not a substitute.

## Separate real PDF browser acceptance

The ordinary Ubuntu browser suite's existing AI screenshots intercept AI API
routes and use a PNG; they are UI-contract evidence only, not PDF backend
acceptance. It is not assumed that Ubuntu's host util-linux provides the
reviewed setpriv/Landlock and enosys features. The dedicated PDF test is excluded
from that ordinary runner rather than replacing its renderer with a mock.

The native matrix first runs the unchanged production image's real renderer
smoke. Only afterwards does `Dockerfile.ai-browser` derive a **test-only** image
from that exact local production image. A [Dockerfile-specific ignore file](https://docs.docker.com/build/concepts/context/#filename-and-location) keeps
the production context unchanged and adds only the synthetic browser test entry
to the test-image context. Playwright, browser dependencies and a
separate Prisma test client are installed under sibling `/test-tools`; no
`/app` module, trace, package or policy is replaced. A content/type/permission/
owner/link manifest checks `/app` before and after tool installation. No
`NODE_PATH`, `NODE_OPTIONS` or test loader is passed to the production app, whose
cwd remains `/app` and whose prebuilt server is used without another build.
The derivative adds browser system libraries, so the prior base-image smoke
remains the independent production-native dependency gate.

The browser, app, fresh temporary database and bounded synthetic provider run
as non-root in one disposable container with ordinary Docker confinement and
`--network=none`. The sole dummy provider binds container loopback and uses the
existing operator allowlist for exactly `http://127.0.0.1:3200/v1`; the app's
production URL policy is not changed. There are no renderer/API-route mocks or
unsafe fallbacks. The real browser test checks explicit consent, four complete
ordered JPEG pages (independently identified by pixel colors), immutable
original hashes, persisted unreviewed status without automatic resend, fifth-
page and blank-page rejection with zero additional provider dispatches, and no
expense/income/cash posting. Provider credentials and documents are synthetic.
A missing kernel prerequisite fails the gate; it never skips the PDF cases.

This supplemental gate does not upload screenshots/artifacts or modify the
existing optional visual evidence budget or retention. Browser collection
success is only a configuration check; genuine container/browser execution
remains required and is not claimed from local unit tests.

## Static EPERM startup audit and bounded diagnostics

Policy error classes are intentionally distinct. The generated filter traps an
unsupported audit architecture, returns EPERM for x32 on x64 and for clone
without CLONE_THREAD, and returns ENOSYS for clone3/unknown syscall numbers.
The remaining EPERM branches are exactly the maintained enosys name list in
`build-sandbox-filter.sh`, grouped below; this audit does not prove a host's
independent Docker/LSM policy or native compatibility.

| EPERM surface | Pre-input runtime relevance |
| --- | --- |
| x32 ABI; non-thread clone; fork/vfork | Only native x64/arm64 ELF is supported; no separate renderer processes are intended. Native thread clone must retain CLONE_THREAD. |
| Sockets/send/receive; SysV/POSIX message/semaphore/shared-memory IPC | No network/provider or application IPC is intended. Inherited stdio descriptors must work without creating new sockets. |
| io_uring setup/enter/register | Node's inspected main ESM load uses synchronous fs reads. Async/native compatibility remains a real gate; no unconditional allowance is inferred. |
| ptrace, process_vm, pidfd and signal-sending calls | No cross-process access is intended. A failure/abort path may itself need thread signals; a reported EPERM alone does not justify enabling them. |
| Session/group changes, namespace/mount/fs-context APIs, handle-based opens | Not part of the supported loader or renderer contract; confinement/process-group escape remains denied. |
| chmod/chown, xattr mutation, timestamp mutation, truncate/ftruncate | No file/metadata mutation is intended before input parsing. Later output is written to precreated files without truncation. |
| ioctl | Exact Node/libuv source requires FIONBIO to initialize inherited pipe stdio; blanket denial is a compatibility candidate, not yet a confirmed cause or permission change. Other commands can mutate files/devices and must not become broadly available. |
| bpf/perf/userfaultfd, memfd, kernel/module/kexec/reboot and keyring APIs | No such application operation is intended. V8/native mapping behavior is a separate native-runtime prerequisite; an error must be identified, not guessed around. |

Landlock file denial normally produces EACCES; Node permission denial has
ERR_ACCESS_DENIED. Neither distinction is an exhaustive proof of the origin of
an arbitrary failure. Controlled diagnostics emit only fixed stage/reason,
allowlisted error/operation/context tokens, a bounded byte count, exit and signal;
raw stderr, document text, paths and arbitrary error codes are never returned or
logged. The next ordinary-profile native run must identify the operation before
any narrow compatibility proposal is accepted.

Static inspected accepted Node 22.23.4/libuv 1.51.0 path:
`getStdout/getStderr -> createWritableStdioStream -> net.Socket -> handle.open`.
Node's net layer can report the public operation as merely `open`, whereas
libuv's Linux pipe implementation calls `uv__nonblock`, i.e. ioctl(FIONBIO).
Thus the diagnostic includes fixed stdio stack-context tags rather than assuming
that every failure names `uv_pipe_open`.

Primary implementation references:
[Node stdio](https://github.com/nodejs/node/blob/v22.23.4/lib/internal/bootstrap/switches/is_main_thread.js),
[Node net](https://github.com/nodejs/node/blob/v22.23.4/lib/net.js),
[libuv pipe](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/pipe.c),
[libuv Linux nonblocking selection](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/internal.h),
[Node-embedded libuv ioctl](https://github.com/nodejs/node/blob/v22.23.4/deps/uv/src/unix/core.c).
