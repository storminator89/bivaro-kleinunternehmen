# Pilot package integration — 20–21 October 2026

Status: **locally integrated, broad TypeScript and full baseline unit gate passed; follow-on affected checks passed; integrated browser acceptance and release gates remain open.** This is engineering evidence, not a production, fiscal, legal or operating-model approval.

## Reproducible source history

Branch `feat/pilot-integrated` begins at booking/incoming `f095d99507d570122f0732497e5615559d65e372`.

| Frozen source | Local merge |
| --- | --- |
| Payment `5c7eddb0e6e7b358ad30528230bbd16347bf2c41` | `bf1d846` |
| Handoff `380fa01d4aea1a09560bea4489af2f97f724254b` | `c2d8ec9` |
| Access/offer `ee11b738debb3e46047f18992851db7ecbce4679` | `ec3a8dd` |
| Access native-fragment follow-on `ea8b063057a26d4ecb2ce69f980f504adc0eba9f` | `c75e745` |
| Booking E2E follow-on `f7f2295409b4a916a5114a5339b187cbe49774f5` | `6df55e5` |

The merge commits retain their package parents. Integration stabilization is `28f2e41`. Standalone public cached-fragment regressions are `d7df4dd`; source imports and all prior E2E cases are retained.

## Conflict resolutions and data contracts

- Payment conflicts: Prisma model composition, manifest version coverage, restore array/validation/map composition and two independent legacy-backup test edits. Supplier, PurchaseDocument and PaymentJournalEvent relations, uniqueness and migration triggers are retained.
- Handoff conflict: independent E2E additions; both are retained. Automatic accountant-export composition retains linked incoming-original hash/byte-count/source references and bounded preview plus stable approval fingerprint/409 rejection.
- Access applied without textual conflicts. Public access remains exact `/help/access`; protected child paths are not made public. `/purchases` navigation/title and `/handoff` title survive.
- Migration order: fiscal `21:30`, incoming `22:00`, supplier/booking `22:30`, payment `23:00` on 20 October 2026. Current backup schema is `20261020230000_add_payment_journal`. Exact intermediate `22:30`, `22:00`, `21:30`, pre-fiscal, pre-billing-note and legacy-v2 contracts remain distinct.
- Each of these additive models requires its explicit array section when included in a backup schema. Missing Supplier/PurchaseDocument/PaymentJournalEvent sections cannot silently become empty arrays through a recomputed zero-count/no-hash coverage entry.
- Full and JSON exports include all three new models in snapshot/metadata counts; restore results and audit metadata include supplier/source/journal counts.
- Supplier snapshots and invoice/income/expense/source/event IDs are remapped to the target tenant. Historical approval fingerprints remain unchanged. Original bytes/hash binding, staged-file rollback, immutable journal overwrite rejection and legacy-merge guards remain active.
- List projections remain bounded: no incoming parsed line arrays or complete supplier objects were added to lists.

## Focused verification at `28f2e41`

All database tests use the existing helper, which creates an explicit new temporary `DATABASE_URL`, migrates that fixture and disconnects/removes it. No application/developer/server database was used.

- `npx prisma generate` — passed (Prisma 6.19.3).
- `npx vitest run lib/__tests__/purchase-document-backup.test.ts lib/__tests__/payment-journal-backup.test.ts lib/__tests__/backup-snapshot.test.ts lib/__tests__/backup-snapshot-route.test.ts lib/__tests__/backup-restore-invariants.test.ts --maxWorkers=1` — **5 files, 61 tests passed**.
- `npx vitest run lib/__tests__/accountant-export.test.ts lib/__tests__/purchase-expense-approval.test.ts lib/__tests__/purchase-documents-summary.test.ts lib/__tests__/payment-journal-migration.test.ts lib/__tests__/access-help.test.ts lib/__tests__/public-offer.test.ts lib/__tests__/public-pilot.test.ts --maxWorkers=1` — **7 files, 95 tests passed**.
- Additional legacy fixture regression set (backup-v3, billing-notes, fiscal-profile) passed during the preceding six-file focused run; that run's new combined test initially expected an unchanged audit count. The assertion now explicitly preserves business counts while requiring added restore provenance; the complete final backup set above passed afterwards.
- Static E2E-name inventory: **29 named cases**, with no named case absent from any of the three frozen packages or booking base. This is preservation evidence, **not an E2E execution result**.
- Focused ESLint on the ten integration-stabilization TypeScript files with `--max-warnings 0` — passed.
- `git diff --check` — passed.

The new combined regression exercises actual full-ZIP export/restore routes with suppliers, booked-source Expense, invoice/Income/immutable PaymentJournalEvent and exact originals together; then checks target-owned remapping, historical supplier snapshot, replay without duplicates, re-export/JSON counts, immutable overwrite rejection and staged-file cleanup. Intermediate-version restore regressions exercise exact `22:30`, `22:00`, `21:30` snapshots. The combined handoff regression checks approved source hashes and prevents a fresh preview from adopting tampered incoming bytes.

## Aggregate and follow-on verification — 21 October 2026

At clean baseline `5c628ce`:

- `NODE_OPTIONS='--max-old-space-size=1400' node node_modules/typescript/bin/tsc --noEmit --incremental false` — exit 0.
- `NODE_OPTIONS='--max-old-space-size=1100' node node_modules/vitest/vitest.mjs run --maxWorkers=1` — **98 files passed / 1 skipped; 1000 tests passed / 1 skipped**, exit 0, 120.15 seconds. The existing Node `MODULE_TYPELESS_PACKAGE_JSON` warning for `lib/money-migration-report.ts` did not fail the run.

After the two exact follow-on merges and standalone regressions, code candidate `d7df4dd`:

- The same broad TypeScript command above — exit 0, including both E2E files.
- `NODE_OPTIONS='--max-old-space-size=1100' node node_modules/vitest/vitest.mjs run lib/__tests__/access-help.test.ts lib/__tests__/public-offer.test.ts lib/__tests__/public-pilot.test.ts --maxWorkers=1` — **3 files / 23 tests passed**, exit 0. This is the affected follow-on set, not a second full-suite result.
- ESLint `--max-warnings 0` on `app/page.tsx`, `app/register/page.tsx`, `components/app-shell.tsx`, `components/public/offer-summary.tsx`, `lib/__tests__/public-pilot.test.ts`, `e2e/auth-dashboard-invoice.spec.ts`, `e2e/public-help-fragments.spec.ts` — exit 0.
- `node scripts/run-e2e.mjs --list` — exit 0, **38 expanded tests in 2 files**. Listing does not start the web server or execute a browser. The existing file retains all 34 literal named cases plus 2 generated payment cases; the new file adds 2 independent anonymous regressions.
- The standalone regressions begin at `/help#erste-rechnung` or `/help#angebot`, navigate home through the brand, then use the home workflow CTA or footer offer link. Exact URL equality catches duplicated fragments; target visibility/viewport assertions and screenshots are ready for actual browser acceptance. Neither case depends on registration or ledger fixture state.
- `git diff --check` — passed; historical backlog status files remain identical to the booking base.

## Remaining gates and deliberately excluded scope

- The full unit result belongs to `5c628ce`; subsequent access/public changes have their affected 23-test result and broad type check above. A production build and integrated browser acceptance remain outstanding for the final candidate.
- Integrated E2E/native browser acceptance has not run here. Package browser/CI results apply only to their own source commits.
- Accountant handoff remains the bounded export core. Independent unbooked-source/supplier/payment-journal model add-ons under **BPR-014 / issue #48** remain explicit work; successful backup integration is not evidence that those models are exported as a complete handoff addon.
- GitHub push/PR/CI, merge/release/publication and any server startup were not performed by this integration task.
