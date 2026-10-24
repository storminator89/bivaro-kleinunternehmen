# README feature/source map

Documentation baseline: canonical main
[`5fdc7579`](https://github.com/storminator89/bivaro-kleinunternehmen/commit/5fdc757971ce98e2351e0ed5cc8ce7da06f9bbd3),
tree `a73d13695934f2189636345bcc60f5048900c15e`, after
[PR #126](https://github.com/storminator89/bivaro-kleinunternehmen/pull/126).
The complete locally prepared bilingual README/gallery inventory comes from
`ec394312533cfc8476e060e264d1e4929dd02d54`; this package reconciles it with
that accepted Ghostscript-free source baseline and the separately declared
Apache-2.0 application license. It does not claim that an arbitrary deployment
or older image already matches this source.
The screenshot source remains `870d73be`; runtime and license changes do not
silently renew its capture date. Both language versions describe the same
boundaries.

## Product claims

| README area | Authoritative implementation / contract | Deliberate boundary |
| --- | --- | --- |
| Daily actions | [`app/api/daily-actions/route.ts`](../app/api/daily-actions/route.ts), [`components/daily-actions/daily-actions-workspace.tsx`](../components/daily-actions/daily-actions-workspace.tsx) | Links/review prompts, not scheduled collection or revenue from quotes. |
| Dashboard and annual context | [`app/api/dashboard`](../app/api/dashboard), [`lib/annual-business-context.ts`](../lib/annual-business-context.ts), [`lib/payment-journal/accounting-source.ts`](../lib/payment-journal/accounting-source.ts) | Operational cash figures and user declarations are not a legally verified whole-business turnover figure. |
| Invoice editor / tax selection | [`components/dashboard/create-invoice-modal.tsx`](../components/dashboard/create-invoice-modal.tsx), [`lib/own-invoice-source.ts`](../lib/own-invoice-source.ts) | Small-business and standard tax modes exist; no universal tax-case coverage is claimed. |
| Own-invoice PDF/A-3b | [`lib/server/own-invoice-renderer.ts`](../lib/server/own-invoice-renderer.ts), [`lib/server/own-invoice-pdfa-validator.ts`](../lib/server/own-invoice-pdfa-validator.ts) | PDFKit-owned layout, generated XML, final-byte veraPDF gate; no blanket fiscal/XML certification. |
| Quotes / catalogue | [`components/dashboard/editors/quote-editor.tsx`](../components/dashboard/editors/quote-editor.tsx), [`app/api/quotes`](../app/api/quotes), [`lib/service-articles.ts`](../lib/service-articles.ts) | Follow-up and draft preparation remain explicit. |
| Payment terms | [`lib/payment-terms.ts`](../lib/payment-terms.ts), [contract](testing/payment-terms.md) | Customer → company → 14-day fallback, manual date preservation, no historical backfill. |
| Customer timeline | [`app/api/customers/[id]/timeline/route.ts`](../app/api/customers/[id]/timeline/route.ts), [`components/customers/customer-timeline.tsx`](../components/customers/customer-timeline.tsx), [contract](testing/customer-timeline.md) | Read-only, direct owned relationships, no customer-wide inferred balance. |
| Bounded record search | [`app/api/record-search/route.ts`](../app/api/record-search/route.ts), [`components/command-palette.tsx`](../components/command-palette.tsx), [contract](testing/record-search.md) | Own customer names and specified document identifiers only, not full-text/OCR/universal search. |
| Projects / manual duration | [`lib/service-projects.ts`](../lib/service-projects.ts), [`lib/service-duration.ts`](../lib/service-duration.ts), [`components/customers/service-workbench.tsx`](../components/customers/service-workbench.tsx), [contract](roadmap/project-service-times-contract.md) | No timer, rates, budget automation or automatic invoice issuance. |
| Service statement | [`lib/service-statement.ts`](../lib/service-statement.ts), [`lib/service-statement-pdf.ts`](../lib/service-statement-pdf.ts), [`components/customers/service-statement.tsx`](../components/customers/service-statement.tsx) | Explicit selection; not an invoice or service-acceptance certificate. |
| Recurring service drafts | [`lib/service-billing-service.ts`](../lib/service-billing-service.ts), [`app/service-billing/page.tsx`](../app/service-billing/page.tsx) | Confirmed period drafts, no automatic charge or email. |
| Payments / correction / refund | [`lib/payment-journal`](../lib/payment-journal), [contract and fiscal gates](../lib/payment-journal/README.md) | Bounded eligible invoices; records money already moved, never executes a payout. Adjustment history blocks unsupported fiscal views/reminders. |
| Incoming originals / review / approval | [`lib/purchase-documents/service.ts`](../lib/purchase-documents/service.ts), [`lib/purchase-documents/approval.ts`](../lib/purchase-documents/approval.ts), [`lib/purchase-documents/manual-photo-review.ts`](../lib/purchase-documents/manual-photo-review.ts) | Manual original/buyer/payment confirmation; ordinary unstructured PDFs do not gain financial approval solely from AI suggestions. |
| Incoming technical validation | [`lib/purchase-documents/validation-runtime.ts`](../lib/purchase-documents/validation-runtime.ts), [`lib/purchase-documents/validation-contract.ts`](../lib/purchase-documents/validation-contract.ts) | Supported XRechnung CII/UBL XSD/Schematron checks, not tax/identity/payment approval. |
| AI provider / receipt suggestions | [`lib/ai-provider`](../lib/ai-provider), [`lib/purchase-documents/ai-validation.ts`](../lib/purchase-documents/ai-validation.ts), [`lib/purchase-documents/ai-input.ts`](../lib/purchase-documents/ai-input.ts), [provider](ai/provider-contract.md), [capture contract](ai/receipt-extraction.md) | Disabled by default, consent, no universal model certification or automatic posting. PDF.js/Canvas handles bounded 6-MiB, 1–4-complete-page PDF input in an isolated Node process; renderer failure prevents provider dispatch. No Java/Ghostscript rasterization requirement for this path. |
| Bank CSV preview / saved evidence | [`components/bank-csv`](../components/bank-csv), [`lib/bank-import-service.ts`](../lib/bank-import-service.ts), [current evidence contract](features/bank-import-evidence.md) | No bank login/payment/allocation; normalized evidence, not archived raw CSV. Initial preview-only documentation is historical scope. |
| CSV business onboarding | [`lib/data-import-contract.ts`](../lib/data-import-contract.ts), [`lib/data-import-service.ts`](../lib/data-import-service.ts) | The supported import kinds are customers and articles; supplier management does not imply supplier CSV import. |
| EÜR working paper | [`lib/eur-line-mapping.ts`](../lib/eur-line-mapping.ts), [`lib/eur-csv-export.ts`](../lib/eur-csv-export.ts) | Explicit supported years 2024/2025/2026; simplified CSV, no ELSTER filing or complete taxable-result computation. |
| Accountant handoff | [`app/api/accountant-export/route.ts`](../app/api/accountant-export/route.ts), [`lib/handoff-readiness.ts`](../lib/handoff-readiness.ts), [`app/handoff/page.tsx`](../app/handoff/page.tsx) | Neutral evidence package, review warnings, no automatic delivery or adviser acknowledgement. |
| SMTP / durable invoice-quote outbox | [`app/api/settings/smtp/route.ts`](../app/api/settings/smtp/route.ts), [`app/api/email`](../app/api/email), [outbox contract](roadmap/durable-email-outbox-contract.md) | TLS, manual confirmation, acceptance ≠ delivery, unknown outcomes never auto-retry. Payment-evidence reminders are outside SMTP support. |

## Installation, operations and security

| Claim | Source |
| --- | --- |
| Exact Node support / commands / Apache-2.0 application license | [`package.json`](../package.json), [`LICENSE`](../LICENSE), [transition and historical AGPL evidence](legal/application-license-transition.md) |
| Container Node / Java / PDF tools / validators (Java serves both veraPDF and KoSIT) | [`Dockerfile`](../Dockerfile), [`scripts/own-invoice-pdfa/install-runtime.mjs`](../scripts/own-invoice-pdfa/install-runtime.mjs), [`scripts/einvoice-validation/install-runtime.mjs`](../scripts/einvoice-validation/install-runtime.mjs) |
| Foreign-PDF attachment preservation | [`lib/server/pdfa3-converter.ts`](../lib/server/pdfa3-converter.ts), [`lib/server/pdfa-validator.ts`](../lib/server/pdfa-validator.ts), [`scripts/foreign-pdf/ForeignVerifierMain.java`](../scripts/foreign-pdf/ForeignVerifierMain.java), [`scripts/foreign-pdf/prepare-verifier-adapter.mjs`](../scripts/foreign-pdf/prepare-verifier-adapter.mjs). Already-valid supported unsigned/unencrypted PDF/A-3b without forms, active content or existing attachments only; no repair, signature preservation or existing-attachment replacement. The 2-MiB cap is per newly materialized non-seekable stream, not a global memory/PDF bound; unavailable processing fails closed. |
| Service names / mounts / environment | [`docker-compose.yml`](../docker-compose.yml), [`docker-compose.hub.yml`](../docker-compose.hub.yml), [`docker-compose.prod.yml`](../docker-compose.prod.yml), [`.env.example`](../.env.example) |
| Guarded upgrades / absolute SQLite path / backups | [`docker-entrypoint.sh`](../docker-entrypoint.sh), [`scripts/database-runtime.mjs`](../scripts/database-runtime.mjs), [`scripts/upgrade-database.mjs`](../scripts/upgrade-database.mjs), [operating contract](backlog/BV-001-002.md) |
| Bootstrap consumed state / registration gate | [`lib/auth-registration.ts`](../lib/auth-registration.ts), [`app/api/auth/register/route.ts`](../app/api/auth/register/route.ts) |
| Roles / current session / tenant ownership | [`lib/get-user-id.ts`](../lib/get-user-id.ts), [`lib/auth.ts`](../lib/auth.ts) |
| bcrypt / limits / mutation-origin checks / CSP | [`lib/password.ts`](../lib/password.ts), [`lib/rate-limit.ts`](../lib/rate-limit.ts), [`lib/request-security.ts`](../lib/request-security.ts), [`proxy.ts`](../proxy.ts), [`next.config.ts`](../next.config.ts) |
| JSON/full-ZIP distinction / immutable restore gates | [`app/api/backup/route.ts`](../app/api/backup/route.ts), [`app/api/backup/full/route.ts`](../app/api/backup/full/route.ts), [`lib/backup-snapshot.ts`](../lib/backup-snapshot.ts), [`lib/backup-restore.ts`](../lib/backup-restore.ts) |
| External key auth / JSON API docs | [`lib/api-auth.ts`](../lib/api-auth.ts), [`lib/api-documentation.ts`](../lib/api-documentation.ts), [`app/api/v1/docs/route.ts`](../app/api/v1/docs/route.ts) |
| Missing email reset / recovery boundaries | [account access](operations/account-access.md) |
| Third-party notice scope / unresolved inventory | [PDF runtime notices](operations/pdf-third-party-notices.md) |

## Evidence scope

- [Screenshot provenance](screenshots/provenance-870d73be.json) binds seven existing
  synthetic UI captures to their original commit, artifact and hashes. All seven
  originals were individually reviewed; the unchanged files total 977,308 bytes.
- The gallery illustrates daily actions, customer history, service work,
  incoming review, bank evidence and service statements. It is not fresh visual
  evidence for the later AI renderer or foreign-PDF replacement, and does not
  establish real provider, SMTP or bank connectivity.
- Reports under `docs/testing/` and `docs/roadmap/` are revision-bound technical
  records, not live release badges. A changed source, image or validator needs
  matching evidence; unrelated earlier results do not establish its acceptance.
- The accepted base removes Ghostscript from the container definition and active
  PDF paths and contains explicit absence gates. Historical screenshots do not
  prove image/package absence. Native/image/browser evidence stays bound to
  its exact source and built artifact; this documentation/license package does
  not itself rerun those gates or claim deployment identity.
- The current **application** declaration is Apache-2.0. It does not turn the
  entire image Apache-licensed. Earlier AGPL releases, original third-party
  notices and source-availability obligations remain component-specific; see
  the [transition record](legal/application-license-transition.md) and the
  [scoped runtime inventory](operations/pdf-third-party-notices.md).
