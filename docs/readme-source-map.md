# Current README feature/source map

Current code target: [`0ed113074e1c97defaa84345e2e050cf7eb281ff`](https://github.com/storminator89/bivaro-kleinunternehmen/commit/0ed113074e1c97defaa84345e2e050cf7eb281ff),
tree `6df04d075d64c1566187333e5536fa0bdd497d4d`.
Both READMEs describe the same current functionality and deliberate limits.
Each image retains its exact capture commit/run and full-pixel identity in the
[screenshot provenance](screenshots/provenance.json); earlier native images are
not re-dated or represented as fresh captures. This is not a deployment claim.
Unpublished work outside the current code target is not advertised.

| README area | Implementation / detailed contract | Boundary |
| --- | --- | --- |
| Overview | [Dashboard](../components/dashboard/dashboard-client.tsx), [daily actions](../app/api/daily-actions/route.ts) | Cash figures and user declarations are not certified whole-business turnover. |
| Quotes and invoices | [Quote editor](../components/dashboard/editors/quote-editor.tsx), [invoice editor](../components/dashboard/create-invoice-modal.tsx), [final PDF validator](../lib/server/own-invoice-pdfa-validator.ts) | Explicit draft/issuance steps, final-byte PDF/A checks, not universal fiscal certification. |
| Customers and catalogue | [Customers](../app/customers/page.tsx), [catalogue](../app/customers/articles/page.tsx), [CSV imports](../lib/data-import-service.ts) | Customer/article imports, not supplier imports or universal search. Bounded authenticated record search is documented separately. |
| Record search | [Search service](../lib/record-search/service.ts), [selection client](../lib/record-search/client.ts), [palette](../components/command-palette.tsx) | Own records only; at most five per type/page and twenty pages/type, no universal full-text or whole-database total. |
| Service work | [Projects](../lib/service-projects.ts), [manual duration](../lib/service-duration.ts), [recurring drafts](../lib/service-billing-service.ts) | Manual time, selected statements, confirmed drafts; no running timer or automatic charge. |
| Payments and bank CSV | [Current allocation scope](features/bank-payment-allocation.md), [server](../lib/bank-allocation-service.ts), [allocation evidence](../lib/payment-journal/allocation-evidence.ts) | Explicit actual receipt in supported EUR small-business cases; no bank execution or automatic reconciliation. |
| Incoming originals and expenses | [Inbox](../app/purchases/page.tsx), [approval](../lib/purchase-documents/approval.ts), [validation](../lib/purchase-documents/validation-contract.ts) | Extraction and technical validation are separate from explicit business approval. |
| Optional AI | [Provider contract](ai/provider-contract.md), [bounded PDF input](../lib/purchase-documents/ai-input.ts) | Off by default, consent, 6 MiB/1–4 full pages, no automatic posting. |
| Reports and handoff | [EÜR mapping](../lib/eur-line-mapping.ts), [handoff](../lib/handoff-readiness.ts) | Supported years 2024–2026, simplified CSV, no ELSTER. |
| SMTP and API | [Outbox contract](roadmap/durable-email-outbox-contract.md), [API docs](../lib/api-documentation.ts) | Confirmed invoice/quote sending; acceptance is not delivery; no scheduled sender. |
| Backup and restore | [Snapshot](../lib/backup-snapshot.ts), [restore](../lib/backup-restore.ts) | JSON/full-ZIP distinction, immutable-history guards, secrets not portable. |
| Setup and operations | [German guide](operations/getting-started.de.md), [English guide](operations/getting-started.en.md), [Compose](../docker-compose.yml) | HTTPS, own secrets, closed bootstrap, one SQLite writer, stop/backup before migration. |
| Application license | [LICENSE](../LICENSE), [third-party notices](operations/pdf-third-party-notices.md) | Apache-2.0 application, not blanket container licensing. |
| Current screenshots | [Individual provenance](screenshots/provenance.json), [review scope](screenshots/README.md) | Per-image source/run and hashes, actual synthetic UI, complete route inventory, no real external service claims. |

The [earlier source map](readme-source-map-2026-10-22.md) is retained as historical
context. Its initial bank-import scope does not describe the current allocation
workflow. Screenshot provenance is independent of runtime or license assertions.
