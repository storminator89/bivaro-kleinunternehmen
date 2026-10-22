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
  Separate processes, process-group/session escape, arbitrary socket creation/network access,
  io_uring, cross-process memory/handles/signals, IPC, namespace changes and
  filesystem metadata mutations not mediated by Landlock are denied. The sole
  ioctl exception is FIONBIO on fd 1/2, with both argument high words zero; all
  other commands/descriptors remain denied. This supports inherited pipe stdio,
  not socket creation or access to an additional file/device.
- The child pins `--openssl-config=/dev/null`. Node initializes OpenSSL before
  JavaScript; the renderer must not read host OpenSSL configuration or inherit
  `OPENSSL_CONF`. `/dev/null` is already read-allowed, so this adds no filesystem
  grant or host change. This network-free renderer does not assert FIPS validation
  or adopt an operator's global TLS/provider configuration.
- Child environment is constructed from fixed values only. No inherited API
  keys, proxy variables, database URL, PATH, NODE_OPTIONS or credentials; stdio
  uses private inherited stdout/stderr channels and ignored stdin, no terminal.
  On accepted Node/libuv these channels may be Unix socketpair endpoints, not
  anonymous pipe inodes; this grants no arbitrary socket creation/network access.
  Parent kills the detached process group on every outcome, awaits close, and deletes temporary files in finally.

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
| ioctl | Both native CI architectures confirmed inherited-stdio EPERM before parsing. Exact Node/libuv source identifies FIONBIO on fd 1/2 as the relevant operation; a constrained exception is under review/native confirmation, not a broad ioctl grant. |
| bpf/perf/userfaultfd, memfd, kernel/module/kexec/reboot and keyring APIs | No such application operation is intended. V8/native mapping behavior is a separate native-runtime prerequisite; an error must be identified, not guessed around. |

Landlock file denial normally produces EACCES; Node permission denial has
ERR_ACCESS_DENIED. Neither distinction is an exhaustive proof of the origin of
an arbitrary failure. Controlled diagnostics emit only fixed stage/reason,
allowlisted error/operation/context tokens, a bounded byte count, exit and signal;
raw stderr, document text, paths and arbitrary error codes are never returned or
logged. The ordinary-profile native run identifies the failing stdio path; it is not
a direct syscall trace. The source-bound compatibility proposal below still
requires independent policy review and genuine native positive/negative gates.

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

### Constrained inherited-stdio FIONBIO exception (native confirmation pending)

[Native run 39775689737](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39775689737)
at source 35cee8ec86d3e96c0506ef75476808e9f99e4579 failed on both native
architectures with stage `launcher`, reason `stdio-setup`, code EPERM and fixed
context `node-stdio`; no page was parsed and the real-PDF browser gate was not
reached. This identifies Node's inherited-stdio initialization, not a measured
successful render. The proposed exception follows the inspected primary source
path above; it does not suppress the failure or change a host/Docker policy.

The native x64 ioctl number is 16 and native arm64 is 29; any differing or missing
inventory mapping fails policy construction. The request is exactly Linux
[FIONBIO 0x5421](https://github.com/torvalds/linux/blob/v6.17/include/uapi/asm-generic/ioctls.h),
and fd is exactly 1 or 2. Both fd/request arguments are checked as full 64-bit
values: their upper words must be zero. Argument 2 is a pointer to an int; classic
seccomp cannot inspect the pointee. Either int boolean merely changes the open
file description's nonblocking flag. No blanket ioctl, descriptor 0/3+, tty
control, file clone, file-flag mutation or high-word alias is enabled.

A descriptor number is not an immutable object identity. Native code could close
and reuse 1/2 or duplicate another allowed descriptor there. Such an operation
still cannot create a socket or open an object outside the unchanged Landlock
path rights; the exception would only toggle nonblocking on that otherwise
obtainable descriptor. The child starts with private inherited stdout/stderr
channels and ignored stdin, no terminal, directory descriptor or inherited
sensitive file descriptor. Accepted Node/libuv implements UV_CREATE_PIPE with
Unix socketpair endpoints; a private existing channel is not arbitrary socket
creation or a network-addressable capability. This is not an
inode-bound seccomp policy or a claim that native code is memory-safe.

The 13 new instruction indices below are relative to the exception block.
Index 13 is the unchanged enosys body, which reloads the syscall number. Every
jump remains after the validated audit-architecture gate, x32 rejection,
unknown-number ENOSYS gate and clone rules.

| Index | Operation | True / false target |
| --- | --- | --- |
| 0 | Load syscall number | 1 |
| 1 | Compare native ioctl number | 2 / 13 |
| 2 | Load fd high word | 3 |
| 3 | Compare zero | 4 / 12 |
| 4 | Load fd low word | 5 |
| 5 | Compare fd 1 | 7 / 6 |
| 6 | Compare fd 2 | 7 / 12 |
| 7 | Load request high word | 8 |
| 8 | Compare zero | 9 / 12 |
| 9 | Load request low word | 10 |
| 10 | Compare 0x5421 | 11 / 12 |
| 11 | Return ALLOW | terminal |
| 12 | Return EPERM | terminal |

Pure bytecode tests cover both architectures; fd 1/2 positives; invalid, signed
and upper-word arguments; representative tty/file-mutation
commands; wrong architecture; x32; unknown calls; preserved named denial and
legitimate thread-clone decisions. Pointer values are deliberately not presented
as verified. These tests install no filter and do not establish kernel/native
compatibility. The unchanged real native matrix and production-derived real PDF
browser gate remain release requirements. The inspected upstream
[ordinary Docker profile](https://github.com/moby/profiles/blob/main/seccomp/default.json)
already lists ioctl among allowed calls; this is static compatibility research,
not proof of the exact profile/kernel deployed by a particular operator.


Inherited-channel implementation and FIONBIO semantics are independently
confirmed in primary source: [Node-embedded libuv process setup](https://github.com/nodejs/node/blob/v22.23.4/deps/uv/src/unix/process.c#L187-L198)
uses a Unix SOCK_STREAM socketpair for UV_CREATE_PIPE;
[Linux FIONBIO handling](https://github.com/torvalds/linux/blob/v6.17/fs/ioctl.c#L319-L340)
changes only the open file description's O_NONBLOCK flag. These facts explain
the narrow request allowance without claiming that descriptors are anonymous
pipe inodes or that arbitrary network access is allowed.


### Next native gate: bounded memory-failure classification

[Native run 39778311611](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39778311611)
at source 14476ea76122034bfad6b8d0522b5314419b1a11 moved arm64 beyond
stdio/import initialization to `document-load`, then failed with fixed memory
context before any accepted page. This is progress, not rendering acceptance.
The amd64 job failed earlier during the shared Next font build and did not run
the renderer. Both real-PDF browser journeys were therefore unreached.

The next diagnostic-only delta classifies V8 heap, code-range, memory-chunk,
zone, Wasm reservation, native mapping and native allocation failures using a
finite vocabulary. It can expose only bounded numeric heap figures parsed from
the fixed V8 GC layout; these are labeled as reported MB values, **not resident
memory, virtual-size peaks or proof of the remaining native budget**. Raw GC
lines, addresses, paths and document strings remain unavailable. No address-space,
heap, pixel, file, CPU, wall-time or syscall limit is increased by this delta.
A measured benign case and remaining-budget justification are still required
before any resource adjustment, and native positive/negative plus real-PDF
browser acceptance remain mandatory.


### Test-only real-child memory observation (native evidence pending)

At source c6af8ce0db43f1bab4f122256f9e9ba84825469c,
[native run 39780638841](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39780638841)
built both architectures successfully but rejected the first synthetic PDF at
`document-load`. Arm64 reported V8-heap/SIGTRAP with GC-used 8.3 MB/total 12.7 MB;
x64 reported native-allocation/SIGSEGV with GC-used 8.5 MB/total 12.9 MB. These
reported heaps are far below the configured 128 MiB old-space cap; neither a
heap increase nor an address-space increase follows from that observation.
No native positive or production-derived real-PDF browser acceptance passed.

The synthetic native smoke adds read-only observation outside the sandboxed
child, not a different renderer or a spawn mock. Pinned Node's documented
[child_process diagnostic channel](https://github.com/nodejs/node/blob/v22.23.4/doc/api/diagnostics_channel.md#event-child_process)
(the process event is experimental in this pinned release) identifies the actual
ChildProcess. Only its expected prlimit executable, pid, parent pid, same uid and
stable process start time are accepted; commandline/environment/document paths
are never recorded. No production module imports this observer, and the child
receives no procfs permission, new descriptor, credential or resource allowance.

The observer opens only the known child's proc stat/status files with
O_NOFOLLOW, keeps those handles rather than reopening a potentially reused PID,
and checks the identity before and after each status read. Kernel documentation
[specifies that existing proc handles do not act on a reused PID](https://docs.kernel.org/filesystems/proc.html#process-specific-subdirectories).
Only four numeric KiB fields (VmPeak/VmSize/VmHWM/VmRSS), sample count and fixed
status are emitted. Numeric identity, process name, addresses, commandline,
environment and paths are not emitted; invalid/duplicate/oversize data or changed
ownership becomes a fixed unavailable/ownership-rejected result.

Sampling uses non-overlapping reads every 20 ms, at most 1,000 samples/20 seconds,
16 KiB per proc file read and two held handles. Exit/error/close, deadline and
caller finally remove the channel subscription/listeners/timers and close the
handles, including an in-flight open/read. The native smoke retains its outer
150-second command deadline; no renderer success or failure is suppressed by
observation. Pure tests cover the parser, ownership/PID reuse, privacy and
cleanup; they execute no child, proc access, kernel/filter probe or renderer.

These are **sampled lower-bound peaks, not exact maxima**: short spikes may be
missed, proc RSS accounting is approximate, and a failed sample is not evidence
of spare budget. Virtual mappings/reservations are distinct from resident memory
and V8 heap. Any resource proposal still needs the actual native figures and a
bounded remaining-budget rationale, followed by all unchanged positive/negative
native and real-PDF browser gates. No limit or security policy changes here.


### Fixed process-local reservation reduction (native confirmation pending)

At source d43ada0c238156f299de7752095d18f7c7c7fbe6,
[native run 39782765605](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39782765605)
rejected the first synthetic PDF at document-load on both architectures. The
observer retained these valid numeric lower bounds before a later observation
failure (`unavailable`, not a complete measurement):

| Native architecture | Samples | VmPeak KiB | VmSize KiB | VmHWM/VmRSS KiB |
| --- | ---: | ---: | ---: | ---: |
| x64 | 36 | 1,048,576 | 1,048,540 | 92,264 |
| arm64 | 57 | 1,048,576 | 1,048,572 | 97,836 |

The observed virtual peak reaches the exact 1 GiB AS ceiling while the observed
resident figures and prior V8 GC heap figures are much smaller. This supports
investigating virtual reservation/allocation pressure, not increasing the V8 heap
cap or claiming a successful render. The observer now distinguishes a later
failed sample as `partial`, retaining earlier valid lower bounds; no failed read
is silently presented as complete measurement.

The candidate fixes **only the child process** to `MALLOC_ARENA_MAX=2` and Node
`--v8-pool-size=1`. [GNU documents the arena-count cap](https://sourceware.org/glibc/manual/latest/html_node/Memory-Allocation-Tunables.html),
and [the pinned Node CLI documents the background-job pool](https://github.com/nodejs/node/blob/v22.23.4/doc/api/cli.md#--v8-pool-sizenum).
The constructed child environment does not inherit operator settings or add
GLIBC_TUNABLES, LD_PRELOAD, MiMalloc settings or any other allocator override.
Native threads remain supported; fewer arenas/jobs may reduce reservations but
can affect contention/throughput and require genuine native confirmation.

This is a hypothesis-driven reduction, **not a native-memory bound**: canvas's
[Rust global allocator is MiMalloc](https://github.com/Brooooooklyn/canvas/blob/v1.0.13/src/lib.rs#L33-L34),
independent of glibc's arena count. V8/native code may reserve other mappings.
AS remains 1 GiB, V8 old space 128 MiB, CPU 15 seconds, wall 20 seconds, with all
pixel/operator/input/page/output/file/descriptor limits and Landlock/seccomp
rights unchanged. No host setting or live process is modified, no diagnostic is
suppressed, and no provider call or partial rendering can be accepted on failure.
The same real positive/negative native and production-derived PDF browser gates
must pass on the candidate; resource increases remain unapproved and unproven.
