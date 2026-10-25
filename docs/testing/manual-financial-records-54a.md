# Manual financial records #54a — prepared source, not accepted

Date: 2026-10-25. Base: accepted main
`db3098b8dd5318e426cd2e1e93a54b810cd1b4e9` (including #144/#130).
Runtime/test checkpoint: `9e34256af1e54a2b5d19001d624450e162604962`, tree
`1b7689d387ab93d377bed88ba52ccdbc88a73276`. Later changes only remove an
unaccepted #102 documentation-only checkpoint and add this preparation record.
This is not a release, merge, applied migration, legal opinion or passing
functional/visual acceptance. Issue #54 remains partial.

## Prepared behavior

- Explicit finalization of eligible single manual EUR income/expense; existing
  entries already affect figures. Finalization changes neither totals nor dates.
- Legacy rows remain unreviewed and require a conscious manual-scope declaration.
- Reasoned amount-only correction retains the original and hash-linked history.
  One existing projection carries the effective amount; history is not money.
- Shared web/v1 mutation protection, mandatory audit and CAS/replay, retained
  customer references, cash/source attachment barriers and durable source origin.
- One fresh-read dialog, explicit preview, generation-safe input, read-before-retry
  recovery and no automatic replacement write after a lost/aborted response.
- Additive migration `20261025090000_add_manual_financial_record_lifecycle`;
  exact new backup capability, portable identity replay and bound original bytes.
- Historical financial merges into finalized targets fail closed. No guessed
  identity from amount/date/name; separate empty-target review remains possible.
- Accountant history is context with zero additional cash effect. Unsupported
  journal/source/cash/series/AfA records keep their own workflows.

See the [bounded technical contract](../roadmap/manual-financial-records-54a-contract.md).

## Checks actually performed

| Check | Result |
| --- | --- |
| Full `npm run lint` (zero-warning policy) | PASS |
| Full `npx tsc --noEmit --incremental false` | PASS |
| Prisma schema validation, explicit unused path, no DB connection | PASS |
| Private Prisma client generation, no DB connection | PASS |
| Base-range `git diff --check` | PASS |
| Ordinary `npm run build`, normal pre/postbuild hooks | **INCOMPLETE** |

The first normal build was killed (exit 137) during compilation. After completed
private lane dependency copies were released, one retry compiled Turbopack
successfully in 13 seconds, then was killed (137) during Next's TypeScript stage.
The PDF-worker prebuild guard ran normally. The separate full TypeScript check
passed; complete build and postbuild success are **not** claimed. No additional
local build retry, weakened guard or alternative test execution was used.

## Authored proof, never executed here

- `lib/__tests__/manual-financial-record-{evidence,lifecycle,migration}.test.ts`:
  actual isolated migration preservation, audit-insert rollback, independent
  connection conflicts, web/v1 guards, source/cash/customer races, originals,
  one effective amount in consumers/handoff, exact restore replay and rollback.
- `components/manual-financial-records/__tests__/manual-record-{client,actions}.test.tsx`
  (client source uses `.test.ts`): exact amounts, monotonic finalized protection,
  edit generations, pending identity privacy and row actions.
- `e2e/manual-financial-records.spec.ts`: real-server positive paths; deliberate
  response failures/delays, 360/390/1440px and both themes, native traversal,
  keyboard/focus, reload, stale tabs and no double count.
- Separate #59 proof commit in this package changes only
  `e2e/revenue-indicators.spec.ts` (integration commit `cfce2f6`, original
  `c67b7b7b35fd707f32b4fe36e69427d80c7432e8`). Its browser case was not run.

No local test discovery, unit/functional/API/integration/browser run, fixture DB,
DB probe, migration application, app server, CI run or deployment was performed.
Authored assertions and source review do not establish their passing outcomes.

## Before a draft publication can be accepted

1. Obtain the specific publication/hosted-run grant. Integrate onto the then
   accepted main, preserving complete #145/#146 source, docs and gallery/workflow
   changes rather than replacing their files with this older base.
2. Add an independent strict 12-name #54 capture partition to that accepted
   workflow; preserve every existing name, byte/pixel bound and lossless proof.
   Names: `manual-record-{income,expense}-{360,390,1440}-{light,dark}.png`.
   Current source asserts real viewport/theme; no new workflow gate is present.
3. Run the complete hosted build/unit/API/migration/browser gates on the exact
   published head, including separate #59 proof, and inspect actual final images.
4. Review failures and fix within approved scope. No acceptance or issue closure
   until those results and domain review exist. Native in-page traversal inherits
   the existing Navigation API entry-index requirement; broader browser support
   is not asserted. No tax/legal certification is implied.


## 11:43 authorization / accepted-main integration checkpoint

The specific draft-publication and complete hosted CI/browser grant is now
received. Accepted main `0ed113074e1c97defaa84345e2e050cf7eb281ff` (#145) is
integrated in full. Still-unmerged #146 README/gallery and #147 incoming-filter
fix are excluded, not prerequisites or silently included changes. The 220-name
workflow prefix is preserved byte-for-byte; the independently reviewed 12-name
partition adds 1/6/3 MiB bounds and normal viewport PNG/geometry/theme proofs.
A scoped restore compatibility correction retains established source-controlled
tenant remapping without adopting manual history; strict finalized-manual foreign
identity rejection remains. No local functional execution or further normal build
retry is performed. Actual full hosted outcomes and image inspection will be
recorded in the draft PR body; the earlier preparation/build limits remain true.
