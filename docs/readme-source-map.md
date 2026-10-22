# README feature/source map

Documentation baseline: `870d73be87dafa5918e0172bdf0ebe818684aa48`, tree
`b80c3873cdc58306cd9210a7939bba68175f00a8`, reviewed 2026-10-22. This is a
read-only source cross-check for the German/English READMEs, not another product
implementation, a fresh test execution or a production acceptance certificate.
Both language versions describe the same feature/operational boundaries.

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
| AI provider / receipt suggestions | [`lib/ai-provider`](../lib/ai-provider), [`lib/purchase-documents/ai-validation.ts`](../lib/purchase-documents/ai-validation.ts), [provider](ai/provider-contract.md), [capture](ai/receipt-extraction.md) | Disabled by default, consent, no universal model certification or automatic posting. Ghostscript remains the current PDF rasterizer at this baseline. |
| Bank CSV preview / saved evidence | [`components/bank-csv`](../components/bank-csv), [`lib/bank-import-service.ts`](../lib/bank-import-service.ts), [current evidence contract](features/bank-import-evidence.md) | No bank login/payment/allocation; normalized evidence, not archived raw CSV. Initial preview-only documentation is historical scope. |
| CSV business onboarding | [`lib/data-import-contract.ts`](../lib/data-import-contract.ts), [`lib/data-import-service.ts`](../lib/data-import-service.ts) | The supported import kinds are customers and articles; supplier management does not imply supplier CSV import. |
| EÜR working paper | [`lib/eur-line-mapping.ts`](../lib/eur-line-mapping.ts), [`lib/eur-csv-export.ts`](../lib/eur-csv-export.ts) | Explicit supported years 2024/2025/2026; simplified CSV, no ELSTER filing or complete taxable-result computation. |
| Accountant handoff | [`app/api/accountant-export/route.ts`](../app/api/accountant-export/route.ts), [`lib/handoff-readiness.ts`](../lib/handoff-readiness.ts), [`app/handoff/page.tsx`](../app/handoff/page.tsx) | Neutral evidence package, review warnings, no automatic delivery or adviser acknowledgement. |
| SMTP / durable invoice-quote outbox | [`app/api/settings/smtp/route.ts`](../app/api/settings/smtp/route.ts), [`app/api/email`](../app/api/email), [outbox contract](roadmap/durable-email-outbox-contract.md) | TLS, manual confirmation, acceptance ≠ delivery, unknown outcomes never auto-retry. Payment-evidence reminders are outside SMTP support. |

## Installation, operations and security

| Claim | Source |
| --- | --- |
| Exact Node support / commands / current app license | [`package.json`](../package.json), [`LICENSE`](../LICENSE) |
| Container Node / Java / PDF tools / validators | [`Dockerfile`](../Dockerfile), [`scripts/own-invoice-pdfa/install-runtime.mjs`](../scripts/own-invoice-pdfa/install-runtime.mjs), [`scripts/einvoice-validation/install-runtime.mjs`](../scripts/einvoice-validation/install-runtime.mjs) |
| Current foreign-PDF path | [`lib/server/pdfa3-converter.ts`](../lib/server/pdfa3-converter.ts); no complete Ghostscript-removal claim at this baseline |
| Service names / mounts / environment | [`docker-compose.yml`](../docker-compose.yml), [`docker-compose.hub.yml`](../docker-compose.hub.yml), [`docker-compose.prod.yml`](../docker-compose.prod.yml), [`.env.example`](../.env.example) |
| Guarded upgrades / absolute SQLite path / backups | [`docker-entrypoint.sh`](../docker-entrypoint.sh), [`scripts/database-runtime.mjs`](../scripts/database-runtime.mjs), [`scripts/upgrade-database.mjs`](../scripts/upgrade-database.mjs), [operating contract](backlog/BV-001-002.md) |
| Bootstrap consumed state / registration gate | [`lib/auth-registration.ts`](../lib/auth-registration.ts), [`app/api/auth/register/route.ts`](../app/api/auth/register/route.ts) |
| Roles / current session / tenant ownership | [`lib/get-user-id.ts`](../lib/get-user-id.ts), [`lib/auth.ts`](../lib/auth.ts) |
| bcrypt / limits / mutation-origin checks / CSP | [`lib/password.ts`](../lib/password.ts), [`lib/rate-limit.ts`](../lib/rate-limit.ts), [`lib/request-security.ts`](../lib/request-security.ts), [`proxy.ts`](../proxy.ts), [`next.config.ts`](../next.config.ts) |
| JSON/full-ZIP distinction / immutable restore gates | [`app/api/backup/route.ts`](../app/api/backup/route.ts), [`app/api/backup/full/route.ts`](../app/api/backup/full/route.ts), [`lib/backup-snapshot.ts`](../lib/backup-snapshot.ts), [`lib/backup-restore.ts`](../lib/backup-restore.ts) |
| External key auth / JSON API docs | [`lib/api-auth.ts`](../lib/api-auth.ts), [`lib/api-documentation.ts`](../lib/api-documentation.ts), [`app/api/v1/docs/route.ts`](../app/api/v1/docs/route.ts) |
| Missing email reset / recovery boundaries | [account access](operations/account-access.md) |
| Third-party notice scope / unresolved inventory | [PDF runtime notices](operations/pdf-third-party-notices.md) |

## Evidence and change boundaries

- [Screenshot provenance](screenshots/provenance.json) seals seven existing
  synthetic UI captures. Every selected original was independently viewed for
  this refresh; files are unchanged and total 977,308 bytes.
- Existing reports under `docs/testing/` and `docs/roadmap/` are retained unchanged
  and explicitly labelled as historical reports/contracts, not live completion
  badges. Their old “pending” sections are not silently rewritten by this refresh.
- The baseline's retained evidence index
  `evidence-index-main870d73be.json` distinguished successful browser acceptance
  from an incomplete native-x64 PDF/A verification gate. Neither screenshot
  selection nor README prose claims that every release gate was complete.
- No application code, package/lockfile, schema, workflow, LICENSE or deployment
  configuration is changed. No build, functional test, browser, native PDF tool,
  GitHub workflow run, release, push or publication is performed for this refresh.
- Before changing runtime/license wording for a later release, verify the actual
  merged source and final artifact. Pending Ghostscript replacement work and a
  possible authorized future license transition are **not** represented as
  current shipped facts here. Java/veraPDF remains an honest runtime requirement.
