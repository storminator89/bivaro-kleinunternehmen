<div align="center">

# Bivaro

### From quote to reviewed receipt.

Accounting and everyday business workflows for freelancers and small businesses in Germany.<br>
Self-hosted · Traceable documents · Explicit approvals

[Deutsch](README.md) · **English**

[Features](#features) · [Screenshots](#screenshots) · [Installation](#installation) · [Operations](#operations-and-updates) · [Limitations](#current-limitations)

</div>

---

Bivaro brings quotes, invoices, customers, services, payments and incoming documents into one web workspace. Rather than hiding decisions behind automation, it distinguishes evidence, items awaiting review and actions requiring explicit confirmation. Small businesses and Germany's small-business VAT regime are a focus; the invoice editor also offers a standard-VAT mode.

> **Current status:** actively developed, with no blanket GoBD, tax or compliance certification. Extraction is not approval, a bank import is not a posting, and SMTP acceptance is not proof of delivery. [Read the limitations before production use.](#current-limitations)

<a href="docs/screenshots/daily-actions-1440.png"><img src="docs/screenshots/daily-actions-1440.png" alt="Bivaro daily actions: four next steps with clearly distinguished amount types, using synthetic data only" width="1200"></a>

*“Heute erledigen” (daily actions) links to outstanding invoices, quote follow-ups and saved document reviews. Every screenshot uses synthetic test data.*

## Features

| Workspace | Available today |
| --- | --- |
| **Overview & next steps** | Income/expense overview, operational indicators, year comparison and a daily-action view for overdue invoices, quotes and pending document reviews. Optional annual context keeps user declarations separate from recorded financial movements. |
| **Quotes & invoices** | Quotes with follow-up stages, deliberate conversion into an invoice, templates, service catalogue, logo and optional GiroCode payment QR. Due-date suggestions follow customer → company → 14 days; manually entered dates remain protected. Own invoices are rendered on the server with embedded Factur-X/ZUGFeRD XML and a final check of the actual PDF/A-3b file. |
| **Customers & search** | Customer and supplier management, internal customer notes and a read-only customer timeline linking quotes, documents and payment evidence. Ctrl/⌘+K performs bounded searches over owned customer names, outgoing document numbers and incoming document numbers/filenames. |
| **Projects & services** | Customer-linked projects, quantity notes and manually entered `HH:MM` durations. Select open services explicitly in the invoice editor and review prices there. PDF service statements cover explicitly selected services. Recurring service plans prepare confirmed periods as drafts, not automatic billing. |
| **Payments & history** | Full/partial payments with a payment journal and remaining balance; separate evidence for corrections and already-executed refunds in supported cases. Invoice history, original-linked full cancellation documents and controlled reminder paths rather than rewriting original history. |
| **Incoming documents & expenses** | Archive originals, extract XML or embedded e-invoice data, assign suppliers and resume review drafts. Photo/image receipts can be reviewed manually. Sequential review includes save/next and unsaved-change protection. Supported XRechnung XML receives a separate technical XSD/Schematron check. Only explicit substantive approval creates a supported expense. |
| **Optional AI capture** | Bring your own OpenAI-compatible vision endpoint, with separate consent for the provider and automatic new-upload analysis. AI returns unreviewed suggestions for suitable images/PDFs, never payments, supplier selections or automatic financial postings. Manual entry remains available. |
| **Bank CSV & onboarding** | UTF-8 CSV with explicit column mapping, EUR control totals, row errors, possible-duplicate warnings and read-only invoice suggestions. Reviewed bank rows can be saved and reopened as unallocated evidence. Separate preview/confirmation imports cover customers and the service catalogue. |
| **Reports & handoff** | Income, expenses, cashbook, low-value asset register and tax simulation. A simplified EÜR cash-basis CSV working paper supports 2024–2026; neutral handoff packages include original references, manifests and review warnings. No ELSTER filing. |
| **Settings & integration** | User roles, API keys, optional SMTP and confirmed invoice/quote email sending with a durable attempt journal. JSON/full ZIP backups include preview and version-aware restore. |

## Screenshots

Actual application captures, not mockups. Click any image to open the unchanged original. The pictured interface is German; this English README does not imply an English-language UI. Both light and dark views are part of the application.

<table>
  <tr>
    <td width="50%"><strong>Customer timeline</strong><br><a href="docs/screenshots/customer-timeline-desktop-1440.png"><img src="docs/screenshots/customer-timeline-desktop-1440.png" alt="Customer timeline separating payment, correction, invoice and quote evidence" width="600"></a><br><sub>Read document and payment evidence together without inventing a customer-wide balance.</sub></td>
    <td width="50%"><strong>Projects & service durations</strong><br><a href="docs/screenshots/project-services-workbench-desktop-1440.png"><img src="docs/screenshots/project-services-workbench-desktop-1440.png" alt="Service notes with project filter, known duration and separately reported missing duration" width="600"></a><br><sub>Known duration, quantities and missing time information remain distinct.</sub></td>
  </tr>
  <tr>
    <td width="50%"><strong>Bank CSV with import receipt</strong><br><a href="docs/screenshots/bank-evidence-saved-1440.png"><img src="docs/screenshots/bank-evidence-saved-1440.png" alt="Saved synthetic bank CSV evidence with EUR control totals and an explicit no-posting warning" width="600"></a><br><sub>Review totals and possible duplicates. Saving does not record a payment.</sub></td>
    <td width="50%"><strong>Technical e-invoice checks</strong><br><a href="docs/screenshots/incoming-validation-desktop-1440.png"><img src="docs/screenshots/incoming-validation-desktop-1440.png" alt="Separate technical XRechnung validation with rule and original hashes, without tax approval" width="600"></a><br><sub>Technical rules, original evidence and human approval are separate statements.</sub></td>
  </tr>
  <tr>
    <td width="50%"><strong>The original comes first</strong><br><a href="docs/screenshots/receipt-draft-desktop.png"><img src="docs/screenshots/receipt-draft-desktop.png" alt="Dark-mode receipt review with an explicitly synthetic photo original, zoom and save-and-next controls" width="600"></a><br><sub>Inspect the photo original, save a review draft and continue deliberately.</sub></td>
    <td width="50%"><strong>PDF service statements</strong><br><a href="docs/screenshots/service-statement-preview-1440.png"><img src="docs/screenshots/service-statement-preview-1440.png" alt="Service statement with selected services, known minutes and the same file for preview and download" width="600"></a><br><sub>Summarize deliberately selected services. Not an invoice or acceptance certificate.</sub></td>
  </tr>
</table>

[Provenance, image hashes and review boundaries for all seven screenshots](docs/screenshots/README.md)

## Current limitations

- **Not legal or tax approval:** stored tax profiles and annual figures are self-declarations. Revenue indicators and simulations do not replace individual review. Technical PDF/XML validation proves neither identity nor payment, entitlement to use a document or complete tax correctness.
- **No bank connection:** no bank feed, transfer execution, automatic reconciliation or payment allocation. Bank CSV evidence stores normalized rows and hashes, **not an archived raw CSV**. Invoice suggestions compare at most the latest 100 invoices. [Details](docs/features/bank-import-evidence.md)
- **Bounded correction support:** payment adjustments cover certain issued EUR small-business invoices without cashbook links. With adjustment history present, several fiscal reports/exports are blocked pending separate fiscal mapping; new reminders on adjusted invoices are unsupported. Cancelling an invoice does not refund money. [Contract](lib/payment-journal/README.md)
- **No invisible automation:** no running service timer, automatic service billing or scheduled reminder/email worker. Confirmed outstanding-balance reminders remain a controlled manual path; their SMTP sending is not enabled. SMTP acceptance is not delivery, and unknown outcomes require a deliberate retry.
- **AI is optional and fallible:** provider/model and vision support are not universally compatible or certified. Transfers may incur charges and data-protection obligations. Currently limited to four complete PDF pages; no AI request without suitable configuration/consent. Suggestions remain unreviewed and cannot invent an actual payment date. [Limits and consent](docs/ai/receipt-extraction.md)
- **Operations remain your responsibility:** SQLite is intended for one app instance and one database target, not parallel writers or high availability. No built-in email password reset or MFA self-service. Public help/offer pages are not a promised support or hosting contract. [Account-access guidance](docs/operations/account-access.md)

## Installation

### Docker Compose

The supplied Linux container bundles the native PDF/validation tools. You need Docker Engine with the Compose plugin and Git; public deployments additionally need correctly configured HTTPS.

```bash
git clone https://github.com/storminator89/bivaro-kleinunternehmen.git
cd bivaro-kleinunternehmen
cp .env.example .env
```

**Edit `.env` before starting:**

| Setting | Purpose |
| --- | --- |
| `NEXTAUTH_SECRET` | Your own long random secret, generated for example with `openssl rand -base64 32`. Replace the placeholder and retain it securely. |
| `NEXTAUTH_URL` | Exact browser origin: locally `http://localhost:3000`, publicly your own HTTPS URL. |
| `BIVARO_SETUP_TOKEN` | Add your own one-time bootstrap proof, generated for example with `openssl rand -hex 32`. Do not publish it. |
| `PORT` | Optional host port, default `3000`. Compose sets container `DATABASE_URL` to `file:/app/data/prod.db`. |

```bash
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=100 buchhaltung
```

`/register` creates the first administrator only with the setup token configured on the server. Initial registration stays closed without that token. Successful bootstrap durably marks it as consumed; deleting accounts later does not reopen it. An administrator must explicitly enable further registration. Then review company details, declared tax profile, bank details and templates.

[`docker-compose.hub.yml`](docker-compose.hub.yml) provides the registry alternative. Its service is named **`bivaro`**, whereas the build configuration uses **`buchhaltung`**. Do not casually switch files, project names or volumes: a different Compose context may show an empty installation instead of your existing data. Select the intended image tag/digest for controlled releases; `latest` is not an immutable version.

### Source development

Supported Node versions in [`package.json`](package.json): **`>=22.23.4 <23` or `>=24.22.1 <25`**. The Dockerfile uses Node `22.23.4`. npm and Git are required.

After cloning and copying `.env.example`:

1. Create a dedicated data directory (`mkdir -p data`) and set an **absolute** SQLite path in `.env`, such as `DATABASE_URL="file:/absolute/path/bivaro-kleinunternehmen/data/dev.db"`. Replace that example with the actual path. Prisma resolves relative SQLite paths against the schema directory; they are not a reliable standalone/container path.
2. Configure secrets, setup token and local `NEXTAUTH_URL` as above.
3. Run only against this new development database:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

The UI is available at `http://localhost:3000`. The web app, own-PDF generation and AI integration are Node.js-based. **`npm ci` alone does not install every runtime tool:** Java is required for **both technical validation paths**: veraPDF checks final own-invoice PDF/A-3b files; the KoSIT validator checks supported XRechnung XML. These local validators require Linux, Java, `prlimit` and their respective pinned validator/rule assets. Java performs neither PDF generation nor the AI request. At this revision, foreign-PDF normalization and AI PDF rasterization also require Ghostscript. The Docker build installs these tools. Missing tools are not silently represented as successful validation. [PDF architecture and runtime](docs/testing/own-invoice-pdfa-reconstruction.md)

## Operations and updates

### Back up, then upgrade

- Prepare the intended reviewed release/commit; preserve local changes first. **One app instance per SQLite database.** Stop the existing app and every other database writer before migration. Allow enough free space for a backup and test copy.
- Build Compose: `buchhaltung-data` contains `/app/data`, including the database, **new private uploads** under `data/uploads` and upgrade backups. `buchhaltung-uploads` holds `/app/public/uploads` for legacy files only. The Hub variant uses logical volumes `bivaro-data`/`bivaro-uploads`; actual names depend on the Compose project.
- Back up the database **and** uploads away from the running host, and verify restoration. `docker compose down -v` deletes volumes; do not use it as an update or troubleshooting command.

```bash
# Build variant; keep the existing Compose files and project name
docker compose stop buchhaltung
docker compose build buchhaltung
docker compose up -d buchhaltung
docker compose logs --tail=100 buchhaltung
```

By default, `DATABASE_MIGRATION_MODE=auto` checks migration status before starting the web server. For pending migrations, the upgrade job backs up the existing SQLite database, tests on a copy and only then migrates the configured target. New databases are initialized from versioned migrations. Failure or unexplained schema drift blocks startup instead of attempting destructive repair. Backups remain under `/app/data/backups`.

For separate maintenance, set `DATABASE_MIGRATION_MODE=manual` and explicitly run after stopping the app:

```bash
docker compose run --rm --no-deps buchhaltung node scripts/upgrade-database.mjs
# Only after a successful upgrade:
docker compose up -d buchhaltung
```

For the Hub variant, first run `docker compose -f docker-compose.hub.yml pull bivaro`, then stop and update the service using **that same file**; use `-f docker-compose.hub.yml` and `bivaro` for `run`, `up` and `logs` too. Production can add [`docker-compose.prod.yml`](docker-compose.prod.yml) to the build configuration; this does not automatically configure HTTPS. [Upgrade, verification and rollback boundaries](docs/backlog/BV-001-002.md)

### SMTP and optional AI

- SMTP is optional: use administrator settings or server variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. Saved admin settings take precedence. `SMTP_SECURE=false` requires STARTTLS; `true` uses implicit TLS. Plaintext relays are unsupported. Without configuration, preview remains available but sending does not.
- Each user can configure their own AI endpoint, model and key in settings. Provider activation and automatic analysis of **new** suitable uploads are separate, both off by default. Public providers use HTTPS. Private/HTTP endpoints require an exact operator allowlist (`BIVARO_AI_PRIVATE_BASE_URLS`), not a TLS-verification bypass. Operators must explicitly pass this variable into the container environment when needed. [Provider contract](docs/ai/provider-contract.md)
- Stored SMTP/AI keys are encrypted using a key derived from `NEXTAUTH_SECRET` and are excluded from portable business backups. Rotating that secret requires reconnecting affected stored credentials. Never commit secrets, `.env`, databases or unreviewed screenshots.

### Backup and restore

In **Settings → Backup**, review the preview before importing. JSON contains business data but not embedded original files; incoming documents require a **full ZIP backup** for complete restoration. A business ZIP is still not a full operations backup: server secrets, SMTP/AI configuration and email attempt history are not portably included.

Merge and overwrite are distinct, version-aware operations. Existing immutable payment, adjustment or approval history can prohibit overwrite; conflicting relationships abort restoration. Do not bypass this by deleting history or relabelling old backups. Restore does not restart AI analysis, payments or email. [Payment/restore contract](lib/payment-journal/README.md) · [Outbox boundaries](docs/roadmap/durable-email-outbox-contract.md)

## Security

Bivaro uses bcrypt with cost 12, server-side session/ownership checks, user roles, login/registration limits, origin checks on browser mutations, CSP nonces and structured audit events. New private uploads are served through authenticated endpoints. These are technical protections, not a certification or a substitute for operator procedures.

Public installations need correctly configured HTTPS, an exact `NEXTAUTH_URL`, restricted access and up-to-date system/application dependencies. Enable `TRUST_PROXY` only where proxy headers are genuinely trusted and sanitized; explicitly pass it through Compose if needed. Audit/document history is application evidence, not an independent immutable third-party archive. Administrators can manage users; that does not imply blanket access to other users' business data. Follow the documented [identity and authorization boundaries for account access](docs/operations/account-access.md).

## Development and verification

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4/shadcn · TanStack Query 5 · Prisma 6/SQLite · NextAuth 4. Own invoices use PDFKit, fontkit and pdf-lib with final veraPDF validation; other PDF/validation paths remain separate.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run lint` | ESLint, zero warnings |
| `npx tsc --noEmit --incremental false` | Type check |
| `npm run build` | Production build and bundled third-party notices |
| `npm run start` | Start the built standalone server |
| `npm run db:generate` / `npm run db:migrate` | Prisma client / versioned migrations; not a substitute for the existing-installation upgrade procedure |
| `npm run audit:security` | Production-dependency audit, not an ongoing security guarantee |

Before `npm run start` outside Docker, copy `public` and `.next/static` to `.next/standalone/public` and `.next/standalone/.next/static`. Ensure the standalone process also receives the correct `.env`/process environment and absolute database target; `npm run start` does not perform migrations.

`npm run test` runs the Vitest suites; `npm run test:e2e` runs the Playwright end-to-end suites with isolated temporary databases. Setup and additional security checks are described in [`AGENTS.md`](AGENTS.md) and [browser acceptance](docs/testing/browser-acceptance-ci.md). CI and browser results apply only to the tested commit and stated configurations; a test file alone is not execution evidence. Linked reports are historical, revision-bound evidence, not a claim that every later change was reverified. Screenshots demonstrate the pictured UI, not real bank, AI-provider or SMTP connectivity.

### API

`GET /api/openapi` returns the specification, `GET /api/v1/docs` returns JSON documentation, and `GET /api/health` returns health status. The external `/api/v1` API uses user-specific keys from settings, for example `Authorization: Bearer <API_KEY>`; functions/scopes are described in [`lib/api-documentation.ts`](lib/api-documentation.ts). Internal session endpoints are not a blanket stable public integration contract.

### Further reading

- **Feature contracts:** [bank preview (initial slice)](docs/features/bank-csv-preview.md), [current bank evidence](docs/features/bank-import-evidence.md), [AI provider](docs/ai/provider-contract.md), [AI receipts](docs/ai/receipt-extraction.md), [projects/durations](docs/roadmap/project-service-times-contract.md), [payment journal](lib/payment-journal/README.md).
- **Revision-bound reports:** [payment terms](docs/testing/payment-terms.md), [customer timeline](docs/testing/customer-timeline.md), [record search](docs/testing/record-search.md), [receipt navigation](docs/testing/incoming-review-cross-navigation-2026-10-22.md), [own-invoice PDF/A](docs/testing/own-invoice-pdfa-reconstruction.md), [earlier test audit](docs/testing/legacy-code-audit-2026-10-17.md).
- **Plans, not delivery promises:** [backlog](docs/backlog/TICKETSTATUS.md), [pilot readiness](docs/roadmap/pilot-readiness.md), [substantive GoBD/legal review boundaries](docs/backlog/PRUEFPLAN-GOBD-RECHT.md).
- **README traceability:** [feature/source map](docs/readme-source-map.md), [image provenance](docs/screenshots/provenance.json). Most detailed project documents are German.

## License

Bivaro is currently licensed under the **GNU Affero General Public License v3.0 only (`AGPL-3.0-only`)**. See [`LICENSE`](LICENSE). Third-party components and fonts retain their respective licenses; the [PDF runtime notices](docs/operations/pdf-third-party-notices.md) describe the reviewed scope and unresolved inventory limits. They do not establish complete licensing clearance for the entire container.
