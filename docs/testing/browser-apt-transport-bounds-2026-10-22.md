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

Every package-manager invocation receives that path explicitly through `sudo env APT_CONFIG=...`. Before installation, `apt-config shell` reports only those three effective values and the workflow rejects missing or overridden values. Existing system configuration fragments remain loaded: APT_CONFIG is read first, so this verification is intentional rather than assuming precedence.

The installed Playwright1.59.1 dependency source executes `apt-get update` and its own exact browser dependency list. Its usual non-root `sudo -- sh -c` escalation does not preserve the caller's APT_CONFIG. Therefore the workflow invokes the installed Node executable and installed Playwright CLI explicitly as root for `install-deps chromium`, then invokes that same CLI without sudo for `install chromium`. No `npx` package lookup is needed, no dependency list is copied or reduced, and browser downloads remain in the original runner-user cache.

The existing PDF/display apt update and install keep the exact package arguments `ghostscript xvfb xauth default-jre-headless util-linux`, and retain all executable/version probes. No mirror, repository, signature/TLS verification, host configuration file, dependency version,30-minute job timeout or functional assertion is changed. These are connection/data-idle limits and one failed-file retry, not an absolute bound on total setup time. Failed setup remains a failed gate; there is no retry-until-green loop.

The full-suite command and the entire workflow section from the hash-pinned official validator onward remain byte-identical to the base. This includes zero browser retries, all50 evidence names, lossless proof checks,5MiB cap, one-day retention and artifact compression settings.

## Verification

- Nine focused unit checks pass. They execute the actual workflow shell text using stand-ins for sudo, apt-config, apt-get, Node and external executables; **no real sudo, apt, dependency installer, Playwright CLI or browser is executed**.
- Cases cover both successful paths, incorrect and absent effective values, dependency failure preventing browser download, apt-update failure preventing package installation, exact package arguments and temporary-file cleanup.
- YAML parsing, Bash syntax, exact three-key configuration, protected workflow prefix/tail comparison and `git diff --check` pass.
- Focused ESLint and full no-emit TypeScript checks pass with Node22.23.4.
- No local apt/install/browser checks or new GitHub workflow runs were performed for this candidate. Complete exact-published-source hosted acceptance and the final50-image artifact remain required.

Primary references: [APT configuration and retries](https://manpages.debian.org/bookworm/apt/apt.conf.5.en.html), [HTTP transport timeout](https://manpages.debian.org/bookworm/apt/apt-transport-http.1.en.html), [HTTPS inheritance](https://manpages.debian.org/bookworm/apt/apt-transport-https.1.en.html), [official Playwright dependency installation and root environment guidance](https://playwright.dev/docs/browsers#install-system-dependencies).
