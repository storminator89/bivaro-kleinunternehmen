# Catalog and receipt workspace integration

Base: `56c37c0ea2126cb386f83aaf4d0e0b2cfd9675d3`.
Reviewed local implementation: `02b6928b3a4898470c6693474a6e09dead8e4ca4`,
exact tree `706073d0d6630f9484d48294cc02eaa4e875e8e7`.
Both independent implementation commits integrated without conflicts.

## Verification before publication

Node 22.23.4: full ESLint with zero warnings, TypeScript no-emit without
incremental state, twelve pure suites (174 tests), and diff whitespace checks
passed. After adding hosted acceptance and evidence guards, fourteen pure suites
(180 tests) passed; YAML and embedded Python parsing and exact preservation of
the prior workflow bytes were also checked. No local browser, native PDF or JVM execution was performed.

The local full production build is blocked by the shared dependency layout:
PDF.js integrity-checked files have two hardlinks, but the existing prebuild
requires one. An isolated regular dependency copy needs 1.3 GB; only 904 MB was
available. Same-filesystem reflinks are unsupported. No integrity check was
bypassed and shared dependencies were not modified. Hosted CI must establish
the full production build and end-to-end acceptance.

## Hosted acceptance package

`e2e/catalog-inbox-redesign.spec.ts` uses real isolated-fixture authentication
and synthetic read responses. It exercises complete article prices and search,
the receipt upload disclosure with retained selections and busy controls, and
expense facts versus immutable-source provenance. Financial writes are blocked;
the explicitly held upload is synthetically rejected without persistence.
Light/dark checks cover narrow/mobile, tablet and desktop widths. Fourteen
full-page captures retain all content and enforce bounded pixel geometry.

Existing upload tests now explicitly open the initially collapsed disclosure
after fresh navigation/login/reload; their assertions and screenshots remain.
A separate bounded artifact retains all fourteen exact new captures with the
existing lossless whole-pixel/metadata verification, 4 MiB aggregate input,
2 MiB output and 1 MiB per-input limits. All previous 103 image proofs and their
budgets remain unchanged. No acceptance gate was removed or weakened.

At this checkpoint hosted execution and actual screenshot inspection are
pending. A draft PR is not merge authorization, and static/source checks do not
establish visual acceptance. Later CI results and screenshot review belong to
the exact published head and its linked workflow evidence.

## First hosted run: assertion corrections

Published head `3858f90b`: all non-browser workflows passed (4,004 unit tests,
production build, security, PDF/A and container checks on both architectures).
Browser run `40077763166` passed 141 cases and exposed two new-test defects:
the broad article alert locator also matched Next's route announcer, and the
upload assertion expected an unsafe raw response message instead of the
existing deliberately sanitized retry message. Test-only corrections scope
article states to main content and verify both failed upload rows, exact safe
messages, enabled retry controls and exactly two requests. Product behavior,
financial guards and screenshot gates are unchanged. All fourteen first-run
images were retained with verified whole-pixel/metadata proofs; the corrected
head still requires a complete hosted pass before final acceptance.
