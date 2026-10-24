# Current README feature/source map

Source baseline: accepted PR #138 head
[`ea65fc2f59ef43f17d9abdc6a086982fd01522f3`](https://github.com/storminator89/bivaro-kleinunternehmen/commit/ea65fc2f59ef43f17d9abdc6a086982fd01522f3),
tree `4cb608ac6901e893581997378c35c6f21c931428`.
The documentation branch is based on merge `1e6d9fe110c9206401da27b530f44f30e14be2dc`,
with the identical source tree. This is not a production deployment claim.
Both READMEs describe the same functionality and deliberate limits. Unpublished
feature work outside this source baseline is not advertised.

| README area | Implementation / detailed contract | Boundary |
| --- | --- | --- |
| Overview | [Dashboard](../components/dashboard/dashboard-client.tsx), [daily actions](../app/api/daily-actions/route.ts) | Cash figures and user declarations are not certified whole-business turnover. |
| Quotes and invoices | [Quote editor](../components/dashboard/editors/quote-editor.tsx), [invoice editor](../components/dashboard/create-invoice-modal.tsx), [final PDF validator](../lib/server/own-invoice-pdfa-validator.ts) | Explicit draft/issuance steps, final-byte PDF/A checks, not universal fiscal certification. |
| Customers and catalogue | [Customers](../app/customers/page.tsx), [catalogue](../app/customers/articles/page.tsx), [CSV imports](../lib/data-import-service.ts) | Customer/article imports, not supplier imports or universal search. |
| Service work | [Projects](../lib/service-projects.ts), [manual duration](../lib/service-duration.ts), [recurring drafts](../lib/service-billing-service.ts) | Manual time, selected statements, confirmed drafts; no running timer or automatic charge. |
| Payments and bank CSV | [Current allocation scope](features/bank-payment-allocation.md), [server](../lib/bank-allocation-service.ts), [allocation evidence](../lib/payment-journal/allocation-evidence.ts) | Explicit actual receipt in supported EUR small-business cases; no bank execution or automatic reconciliation. |
| Incoming originals and expenses | [Inbox](../app/purchases/page.tsx), [approval](../lib/purchase-documents/approval.ts), [validation](../lib/purchase-documents/validation-contract.ts) | Extraction and technical validation are separate from explicit business approval. |
| Optional AI | [Provider contract](ai/provider-contract.md), [bounded PDF input](../lib/purchase-documents/ai-input.ts) | Off by default, consent, 6 MiB/1–4 full pages, no automatic posting. |
| Reports and handoff | [EÜR mapping](../lib/eur-line-mapping.ts), [handoff](../lib/handoff-readiness.ts) | Supported years 2024–2026, simplified CSV, no ELSTER. |
| SMTP and API | [Outbox contract](roadmap/durable-email-outbox-contract.md), [API docs](../lib/api-documentation.ts) | Confirmed invoice/quote sending; acceptance is not delivery; no scheduled sender. |
| Backup and restore | [Snapshot](../lib/backup-snapshot.ts), [restore](../lib/backup-restore.ts) | JSON/full-ZIP distinction, immutable-history guards, secrets not portable. |
| Setup and operations | [German guide](operations/getting-started.de.md), [English guide](operations/getting-started.en.md), [Compose](../docker-compose.yml) | HTTPS, own secrets, closed bootstrap, one SQLite writer, stop/backup before migration. |
| Application license | [LICENSE](../LICENSE), [third-party notices](operations/pdf-third-party-notices.md) | Apache-2.0 application, not blanket container licensing. |
| Current screenshots | [Individual provenance](screenshots/provenance.json), [review scope](screenshots/README.md) | Same accepted source/run, actual synthetic UI, no real external service claims. |

The [earlier source map](readme-source-map-2026-10-22.md) is retained as historical
context. Its initial bank-import scope does not describe the current allocation
workflow. Screenshot provenance is independent of runtime or license assertions.
