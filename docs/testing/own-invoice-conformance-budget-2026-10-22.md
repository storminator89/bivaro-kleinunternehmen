# Native own-invoice conformance job budget — 2026-10-22

## Observed setup cancellations

The native conformance workflow's 15-minute whole-job ceiling repeatedly expired because ordinary Ubuntu APT setup consumed almost the entire job. These cancellations are incomplete gates, not conformance passes and not evidence of a failed PDF assertion:

| Exact source / original x64 job | Observed UTC setup and outcome |
| --- | --- |
| PR123 `74708009`, [job 119889019450](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39797638074/job/119889019450) | APT started at 14:40:29; package download reported 13 min 33 s. The verifier installer began at 14:54:18 and the real suite at 14:54:25, before cancellation at 14:55:10 without complete totals. |
| PR121 `741c9e77`, [job 119890856738](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39798143031/job/119890856738) | APT started at 14:43:41; the verifier installer began at 14:57:55, about 14 min 14 s later. The real suite began at 14:58:00 and was cancelled at 14:58:31 before completion. |
| Main `870d73be`, [job 119916078025](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39805096485/job/119916078025) | APT started at 15:28:39 and was still running when the job was cancelled at 15:43:20. The verifier installation, all 13 real cases and final-page rendering were skipped. |

The one targeted x64 retry of the first source, [job 119899540480](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39797638074/job/119899540480), had healthy APT setup at 14:59:29–14:59:43, completed all 13 cases at 15:00:27 and finalized the complete page artifact at 15:00:39. Its retained original ARM result is separate; no ARM retry is implied. A successful retry does not convert the cancelled partial artifact into accepted evidence.

## Narrow change and unchanged boundaries

Only `jobs.final-bytes.timeout-minutes` changes from 15 to 30. This leaves time after the measured 14–15-minute setup delays for the verifier installer, complete positive/negative matrix, all final-page renders and evidence upload. It is an orchestration allowance, not a guarantee under arbitrary network slowness.

The maximum allowance increases by 15 runner-minutes **per matrix job**, up to 30 additional runner-minutes across the two native architectures; it is not guaranteed additional usage or a new service. No automatic rerun is added and no current run is cancelled or restarted by this source change.

The actual verifier and application limits remain unchanged: veraPDF 30-second walltime, 25/26-second CPU soft/hard limits, 192 MiB JVM heap, 2 GiB address-space ceiling, 64 descriptors and 2 MiB output/file cap; credential-free environment and whole-child cleanup are retained. AI receipt rendering keeps its separate 15-second CPU/20-second walltime and 1 GiB address-space limits. Neither runtime gains extra document-processing time or memory.

Package versions, locked installs, architecture requirements, official asset hashes, mirrors, repository/signature/TLS trust, test retries, all 13 real cases, ten document cases and three strict input rejections, exact-final-byte page rendering and one-day retention are unchanged. No APT configuration or host/security setting changes.

## Contract verification

The focused workflow unit contract normalizes only the 30-minute field back to 15 and requires the exact SHA-256 of the previously accepted workflow. It additionally checks the two architecture entries, mandatory real-case switch, full matrix assertion and all-final-page renderer. Existing verifier unit contracts independently cover the unchanged resource arguments, timeout and cleanup behavior. These are source/unit checks, not a new native conformance run; exact-published-source hosted acceptance remains required.
