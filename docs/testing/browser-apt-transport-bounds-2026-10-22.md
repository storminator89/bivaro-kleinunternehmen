# Command-scoped browser setup transport bounds — 2026-10-22

## Observed infrastructure interruption

PR119 browser run [39773046663](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39773046663), head `ffbe64d5`, spent about26 minutes installing dependencies before the functional command began. The PDF/display package download alone reported `Fetched 64.3 MB in 19min 12s`, with repeated Azure Ubuntu mirror `Ign` messages before successful downloads through the already configured fallback sources. The110-test suite started at12:12:59Z and was cancelled at12:16:12Z without final test totals; only13/50 screenshots existed. This is not application acceptance or an application bug fix.

## Narrow workflow change

Base: local font-integrated PR119 commit `0c2aa3767c4f649d54f0f3bf64aca97e2c4a2c12`.

Each dependency setup step creates its own private `mktemp` configuration beneath the required `RUNNER_TEMP`, removes it on shell exit, and sets exactly:

```conf
Acquire::Retries "1";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
```

Every package-manager invocation receives that path explicitly through `sudo env APT_CONFIG=...`. Before installation, `apt-config shell` reports those three effective values. The workflow requires retries exactly1 and each timeout to be a positive integer from1 through20. It validates exactly three correctly named, ordered output lines without `eval`, rejecting empty, missing, duplicate, unexpected, non-integer, zero, negative or larger values. Existing system configuration fragments remain loaded: APT_CONFIG is read first, so this verification is intentional rather than assuming precedence. Stricter runner timeouts remain intact.

Hosted run [39779270998](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39779270998), head `29f6ed88`, reported effective retries1 and both timeouts15. The original exact20 equality guard rejected those safe stricter bounds before dependency installation or any functional tests. This follow-up corrects only that guard to accept the verified1..20 range; it neither raises the runner's15-second values nor bypasses its configuration order. A fresh exact-source hosted run remains required.

The installed Playwright1.59.1 dependency source executes `apt-get update` and its own exact browser dependency list. Its usual non-root `sudo -- sh -c` escalation does not preserve the caller's APT_CONFIG. Therefore the workflow invokes the installed Node executable and installed Playwright CLI explicitly as root for `install-deps chromium`, then invokes that same CLI without sudo for `install chromium`. No `npx` package lookup is needed, no dependency list is copied or reduced, and browser downloads remain in the original runner-user cache.

The existing PDF/display apt update and install keep the exact package arguments `ghostscript xvfb xauth default-jre-headless util-linux`, and retain all executable/version probes. No mirror, repository, signature/TLS verification, host configuration file, dependency version or functional assertion is changed. These are connection/data-idle limits and one failed-file retry, not an absolute bound on total setup time. Failed setup remains a failed gate; there is no retry-until-green loop.

The full-suite command and the entire workflow section from the hash-pinned official validator onward remain byte-identical to the base. This includes zero browser retries, all52 evidence names, lossless proof checks,5MiB cap, one-day retention and artifact compression settings.

## Measured whole-job budget

The whole hosted job has a 45-minute orchestration ceiling instead of 30 minutes. This accommodates measured dependency setup, legitimate functional execution and mandatory lossless evidence staging rather than cancelling the suite because setup consumed its budget:

- [Run 39773046663](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39773046663): checkout 11:45:59.987Z to functional command 12:12:19.769Z was 26m 19.8s of setup, including 6m 23.2s Chromium setup and 19m 29.9s PDF/display setup.
- [Run 39761533198](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39761533198): the complete functional command ran 10:20:53.111Z–10:29:43.882Z, or 8m 50.8s. [Run 39766114470](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39766114470) attempt 2 took 7m 14.0s. Their application assertion failures remain failures; these timings do not imply acceptance.
- Run 39761533198: staging all 50 images took 5m 39.3s, followed by 1.2s upload. Evidence processing is part of the real job budget and is not skipped.

Measured slow setup 26m 20s + functional 8m 51s + evidence 5m 40s is about 40m 51s, so even 40 minutes is insufficient; 45 leaves about 4 minutes for ordinary variance/overhead. This does not guarantee completion under arbitrary network slowness. It permits at most 15 additional runner-minutes per execution, not guaranteed extra usage or a new service.

Only the whole-job orchestration ceiling changes. The 25-minute functional-step limit, 20-minute Playwright global timeout, 30-second PDF subprocess sandbox, browser retries 0, per-connection transport bounds, dependency/package lists, mirrors, signature checks, 52-image allowlist, 5MiB artifact cap and one-day retention remain unchanged. No current run is cancelled or rerun by this change.

## Verification

- Fifty-three focused unit checks pass. They execute the actual workflow shell text using stand-ins for sudo, apt-config, apt-get, Node and external executables; **no real sudo, apt, dependency installer, Playwright CLI or browser is executed**.
- Cases cover both setup paths with20,15 and1-second bounds; independent invalid HTTP/HTTPS values, missing/empty/duplicate/unexpected output, retries other than1, dependency failure preventing browser download, apt-update failure preventing package installation, exact package arguments and temporary-file cleanup.
- YAML parsing, Bash syntax, exact three-key configuration, protected workflow prefix/tail comparison and `git diff --check` pass.
- Focused ESLint and full no-emit TypeScript checks pass with Node22.23.4.
- No local apt/install/browser checks or new GitHub workflow runs were performed for this candidate. Complete exact-published-source hosted acceptance and the final50-image artifact remain required.

Primary references: [APT configuration and retries](https://manpages.debian.org/bookworm/apt/apt.conf.5.en.html), [HTTP transport timeout](https://manpages.debian.org/bookworm/apt/apt-transport-http.1.en.html), [HTTPS inheritance](https://manpages.debian.org/bookworm/apt/apt-transport-https.1.en.html), [official Playwright dependency installation and root environment guidance](https://playwright.dev/docs/browsers#install-system-dependencies).
