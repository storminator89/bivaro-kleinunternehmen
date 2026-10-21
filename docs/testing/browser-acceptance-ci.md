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

It invokes the supported `npm run test:e2e` runner with one worker, zero retries,
`--forbid-only`, and a 20-minute Playwright global timeout. The test step allows
25 minutes for shutdown margin and the whole job is capped at 30 minutes.
The existing config's 120-second web-server startup/build limit and individual
test timeouts remain unchanged. A startup/build failure or timeout is a failed
gate, not browser acceptance. A newer run cancels an obsolete run of this
workflow for the same ref.

The runner creates a fresh temporary SQLite fixture and overrides `DATABASE_URL`
with its absolute path. Its guarded preparation migrates only that fixture. The
existing Playwright web-server command builds the production standalone app,
copies public/static assets and starts a new server at `127.0.0.1:3100` with
fixture-only authentication/bootstrap values. Existing servers are not reused;
the runner removes its fixture on normal completion or handled termination.
Runner disposal is the final isolation boundary on forced cancellation.

## Coverage and separate security evidence

There are no file/title/grep filters, shards, changed-only selection, or
fail-fast limits: the workflow runs every case selected by the existing default
Playwright config, including generated payment-ledger cases, incoming documents,
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

Staging never follows symbolic links and accepts only regular files inside that
results tree, verifies PNG signatures, and rejects duplicate basenames. More than
four files or more than 5 MiB combined skips the entire upload with a warning.
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
