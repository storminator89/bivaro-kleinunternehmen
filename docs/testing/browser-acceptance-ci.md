# Full functional browser acceptance in CI

`.github/workflows/browser-acceptance.yml` supplies the full functional browser
gate on pull requests targeting `main` and pushes to `main`/`develop`. It uses a
standard `ubuntu-latest` runner and Node 22, independent of local build-memory
limits. The check is **Full functional Chromium acceptance**; adding this workflow
does not change repository branch protection or make it a required status check.

## Execution and bounds

The job installs the lockfile with `npm ci --ignore-scripts`, explicitly generates
Prisma Client, and installs official Playwright Chromium plus system dependencies
with `npx playwright install --with-deps chromium`. No application or test files,
package versions, existing workflows, or security settings are changed.

Factur-X generation also requires the application runtime executable `gs`, which
Playwright's browser dependencies do not supply. The job installs Ubuntu's
`ghostscript` package with `--no-install-recommends`, matching the production
Dockerfile's explicit runtime dependency, then requires `command -v gs` and
`gs --version` to succeed before E2E. It also explicitly installs Ubuntu's `xvfb`
and `xauth`, checks `Xvfb`, `xvfb-run` and `xauth` presence, and records `xauth -V`.
The Dockerfile and README specify no separate
font package; Ghostscript's required package dependencies and Playwright's browser
fonts are installed normally. The sRGB ICC profile is embedded in `lib/pdfa3.ts`,
not a host-file prerequisite. No PDF assertions or dependency skips are added.

It invokes the supported `npm run test:e2e` runner with one worker, zero retries,
`--forbid-only`, and a 20-minute Playwright global timeout. The test step allows
25 minutes for shutdown margin and the whole job is capped at 30 minutes.
The existing config's 120-second web-server startup/build limit and individual
test timeouts remain unchanged. A startup/build failure or timeout is a failed
gate, not browser acceptance. A newer run cancels an obsolete run of this
workflow for the same ref.

The unchanged complete suite runs with `--headed` under
`xvfb-run --auto-servernum`, using bundled full Chromium on the virtual display
rather than the default headless shell. This preserves the PDF iframe visibility
assertion instead of skipping it or substituting a successful download.
Hosted run [39548413901](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39548413901)
passed Ghostscript/build and 40 tests but failed the manual PDF receipt preview:
its response was HTTP 200/PDF while the iframe remained hidden awaiting `onLoad`;
one subsequent serial case did not run. Playwright documents the default
headless-shell/PDF navigation limitation. This observation motivates a
PDF-capable browser check; **headed acceptance is still pending**, not a presumed
fix or proof that all normal-browser behavior works. If headed mode also fails,
the preview remains unresolved and needs investigation without weakening tests.

The runner creates a fresh temporary SQLite fixture and overrides `DATABASE_URL`
with its absolute path. Its guarded preparation migrates only that fixture. The
existing Playwright web-server command builds the production standalone app,
copies public/static assets and starts a new server at `127.0.0.1:3100` with
fixture-only authentication/bootstrap values. Existing servers are not reused;
the runner removes its fixture on normal completion or handled termination.
Runner disposal is the final isolation boundary on forced cancellation.

## Coverage and separate security evidence

The existing serial `auth-dashboard-invoice.spec.ts` core flow belongs to
`chromium-bootstrap`; the remaining functional files belong to `chromium` and
explicitly depend on it. This makes empty-instance first-admin bootstrap run
before feature suites seed independent user accounts, rather than relying on
alphabetical file order. The two project selections partition the functional
suite: every case runs exactly once; no case is skipped, filtered out, or replaced.
A core failure blocks dependent feature execution and remains a failed gate.
The security configuration and separate CI security job are unchanged.

There are no workflow file/title/grep filters, shards, changed-only selection, or
fail-fast limits: the workflow runs every case in the default Playwright config
once across these two dependent projects, including generated payment-ledger cases, incoming documents,
supplier booking, accountant handoff, legacy restore and public-help regressions.
No functional case or assertion is removed. Existing serial-suite failure
semantics still apply; a green result must not be inferred from a partial run.

The default config deliberately excludes `e2e/security-hardening.spec.ts`.
That suite remains in the existing **CI / Security checks** job, through
`npm run test:e2e:security` and its separate isolated fixture/config on port 3101.
Full browser evidence therefore requires both checks for the same candidate;
this workflow is not a replacement for security, unit, lint, type or build gates.

## Credentials, services and evidence

The workflow grants only `contents: read` and disables checkout credential
persistence. It references no repository secrets or real SMTP configuration,
does not send real mail or process real payments, and makes no live deployment.
Existing synthetic SMTP settings and payment-ledger assertions stay in the
disposable test database; they do not require an external mail/payment service.

There is no cache configuration, HTML report publication, deployment, paid larger
runner, or credential/service provisioning. Tracing stays disabled. GitHub
annotations and job logs remain the authoritative functional test evidence.

Optional visual evidence is restricted to these exact synthetic screenshot
basenames beneath `${{ runner.temp }}/bivaro-browser-results`:

- `partial-payments-1440-two-events.png`
- `partial-payments-390-two-events.png`
- `partial-reminder-guard-1440.png`
- `partial-reminder-guard-390.png`
- `accountant-guide-1440-readiness.png`
- `accountant-guide-390-manual-note.png`
- `history-correction-desktop.png`
- `history-correction-mobile.png`
- `receipt-draft-mobile.png`
- `receipt-draft-desktop.png`

Staging never follows symbolic links and accepts only regular files inside that
results tree, verifies PNG signatures, and rejects duplicate basenames. More than
ten files or more than 5 MiB combined skips the entire upload with a warning.
Only those checked bytes enter a fresh staging directory; the standard
`actions/upload-artifact` action uploads that directory with **one-day retention**.
These are synthetic isolated-fixture UI screenshots, not real customer data or
credentials. No traces, HTML reports, databases, downloads, logs, keys or other
screenshots are uploaded. All other browser output remains ephemeral.

Missing screenshots and staging/upload failures are non-blocking and cannot make
a failed test pass. Any artifact quota error is reported in the upload step and
an explicit warning; no retry by increasing billing, cache or storage limits is
permitted. This optional artifact does not replace manual visual review.

Implementation review was static only: YAML parsing, bounds/permissions/command
inspection and `git diff --check`. No local full build/browser run was launched
for this CI-only change. Passing acceptance must be established by the actual
GitHub checks after publication, not by this document.

## References

- [Playwright CI setup, workers and global timeout](https://playwright.dev/docs/ci)
- [Playwright CLI options](https://playwright.dev/docs/test-cli)
- [GitHub workflow syntax, permissions and timeouts](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Official upload-artifact action and retention options](https://github.com/actions/upload-artifact)
- [Playwright browser modes](https://playwright.dev/docs/browsers)
- [Playwright PDF navigation limitation](https://playwright.dev/docs/api/class-page#page-goto)
