# Combined photo approval and annual context release contract

This integrates the existing manual-photo approval and optional annual-business-context implementations. It does not implement a second approval flow, CSV onboarding, quote follow-up, or an EÜR adapter/layout. Annual declarations remain optional user assertions and do not change financial recognition or tax treatment.

## Immutable capability identities

| Backup v3 schema | Saved photo drafts | Immutable paid-photo approval | Annual declaration history |
| --- | --- | --- | --- |
| `20261021054000_add_purchase_review_drafts` | yes | no | no |
| `20261021061000_add_manual_photo_approval` | yes | yes | no |
| `20261021070000_add_annual_business_context` | yes | no | yes |
| `20261021080000_combine_photo_annual_context` | yes | yes | yes |

The combined schema has a new migration identity, not another capability hidden under standalone 070000. Its marker migration rewrites no data; the two original additive migrations retain their immutable triggers. Earlier explicit schema identities keep their existing capabilities. Unknown/future identities are not inferred from migration order.

Manifest validation and restore preflight both use the source schema capability when checking `reviewedSourceSnapshot`. Standalone 054000 and 070000 reject nonnull approval evidence even with a recomputed manifest; standalone 061000 rejects nonempty annual history. All schemas reject unknown source scalar metadata. Null/absent future approval evidence is not treated as evidence. Valid photo evidence still receives the complete existing semantic checks against the original, saved review, owner, source revision, linked Expense and exact payment date/amount.

## Recovery and atomicity

JSON export retains both annual history and approved-source evidence. As before, JSON does not embed original bytes: a restore with purchase sources and no verified original resolver is rejected before mutation. A JSON metadata graph supplied with its verified ZIP originals, and the full ZIP graph itself, roundtrip both capabilities without replaying approval. Owner and surrogate IDs are remapped; only runtime evidence ownership changes, while historical reviewing tenant, source bytes and canonical replay fingerprint remain intact.

Annual restore preserves the exact common revision prefix, appends only compatible later declarations and retains newer target declarations when source history is shorter/absent. A divergent prefix and overwrite of immutable paid-photo target evidence are rejected before invoking the original resolver or staging files. The same validations run again inside the write transaction to guard concurrent target changes. A failed mandatory restore audit rolls back annual rows, financial rows, source evidence and staged original files.

One approved photo remains one Expense and one source audit pair. Identical-key replay does not append financial rows; different-key races cannot double-post. Annual compare-and-swap remains independent and atomic with its audit. Accountant originals remain selected by the actual paid year, not invoice/source/upload date, and preserve exact cents and original bytes.

## Hosted acceptance boundary

The unchanged project dependency runs all 39 bootstrap cases before dependent feature cases. Static discovery contains the baseline 56 functional cases plus one manual-photo journey and one annual-context journey: 58 unique cases in total. No project is bypassed and no financial assertion is weakened.

The synthetic PNG evidence allowlist adds exactly these four names to the preceding ten:

- `manual-photo-confirmation-mobile.png`
- `manual-photo-expense-desktop.png`
- `annual-context-mobile.png`
- `annual-context-desktop.png`

The total ceiling remains 5 MiB with one-day retention, exact names, duplicate rejection, regular-file/no-symlink/inode validation and PNG-byte checks. No databases, logs, traces or generic directories are uploaded. Authored captures and static discovery are not browser execution or visual acceptance.

## Local integration evidence — 2026-10-21

- Eighteen focused suites: 278 tests passed, one worker, private generated combined-schema Prisma client and disposable databases. Includes backup/invariants/snapshot routes, original export, payment-journal compatibility, fiscal profile, annual API/CAS/audit rollback, manual-photo races and combined restore cases.
- Combined matrix additionally verifies genuine 061000 photo evidence and genuine 070000 annual history remain importable, old-schema relabel attacks fail, exact owner/ID remap and retry remain deterministic, shorter annual history cannot erase later target declarations, and required-audit failure removes staged originals.
- Focused ESLint and whitespace checks passed. Static Playwright discovery: 39 bootstrap + 19 dependent = 58 unique cases. Existing bootstrap project configuration is byte-identical to the integration baseline.
- One bounded 768 MiB TypeScript check was resource-killed (exit 137), without diagnostics; not retried. No local full build, app server or functional browser was run.
- Hosted final-commit type/build/browser/security checks, actual rendered screenshot review, independent immutable-artifact review and publication authorization remain outstanding. This is not fiscal certification or a claim of release acceptance.
