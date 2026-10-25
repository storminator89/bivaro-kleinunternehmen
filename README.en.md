<div align="center">

# Bivaro

**Accounting and office workflows for freelancers and small businesses in Germany.**

Self-hosted · Quotes through receipt review · Light and dark mode

[Deutsch](README.md) · **English**

</div>

## Features

| Area | Current capabilities |
| --- | --- |
| **Overview** | Income, expenses, key figures, year comparisons and next steps for outstanding invoices, quotes and receipt reviews. |
| **Quotes & invoices** | Convert quotes to invoices, templates, payment terms, small-business and standard VAT modes. Own invoices include Factur-X/ZUGFeRD XML and final-file PDF/A-3b validation. |
| **Customers & services** | Customers and suppliers, customer history, article/service catalogue and reviewed customer/article CSV imports. Projects, manual time entries, service statements and confirmed recurring drafts. |
| **Payments & bank CSV** | Partial payments, outstanding balances and payment history. CSV preview with possible-duplicate warnings; explicitly record saved transactions as payments and change supported allocations. |
| **Receipts & expenses** | Archive originals, extract e-invoice data, resume review drafts and explicitly approve supported expenses. Source-linked expense details; optional AI suggestions. |
| **Reports** | Income/expense lists, cash book, low-value asset register, tax simulation, simplified EÜR CSV for 2024–2026 and neutral handoff packages. |
| **Email & integration** | Optional confirmed SMTP sending for invoices and quotes, attempt history, user roles and per-user API keys. |
| **Backups** | JSON and full ZIP backups with preview and version-bound restoration. |

## Screenshots

<table>
  <tr>
    <td width="50%" valign="top"><strong>Dashboard</strong><br><a href="docs/screenshots/2026-10-25/dashboard-overview-light-1440.png"><img src="docs/screenshots/2026-10-25/dashboard-overview-light-1440.png" alt="Dashboard with a year comparison, synthetic totals and next actions" width="400"></a></td>
    <td width="50%" valign="top"><strong>Invoices</strong><br><a href="docs/screenshots/2026-10-25/invoice-redesign-light-1600.png"><img src="docs/screenshots/2026-10-25/invoice-redesign-light-1600.png" alt="Invoice list with a synthetic partially paid invoice and an explicitly page-scoped total" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Customers</strong><br><a href="docs/screenshots/2026-10-25/customer-redesign-directory-light-1440.png"><img src="docs/screenshots/2026-10-25/customer-redesign-directory-light-1440.png" alt="Customer directory with synthetic names, example.test contacts and record actions" width="400"></a></td>
    <td width="50%" valign="top"><strong>Receipt inbox</strong><br><a href="docs/screenshots/2026-10-25/catalog-inbox-receipts-light-1440.png"><img src="docs/screenshots/2026-10-25/catalog-inbox-receipts-light-1440.png" alt="Receipt inbox with a synthetic original, pending review status and internal task filters" width="400"></a></td>
  </tr>
</table>

<details>
<summary>Sales &amp; next actions</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Record search</strong><br><a href="docs/screenshots/2026-10-25/record-search-continuation-1440.png"><img src="docs/screenshots/2026-10-25/record-search-continuation-1440.png" alt="Record search with a selected synthetic customer on page 2, separate document groups and explicitly bounded paging" width="400"></a></td>
    <td width="50%" valign="top"><strong>Today’s tasks</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-today-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-today-light-1440.png" alt="Today’s overview with synthetic open tasks and an explicitly unknown receipt amount" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Quotes</strong><br><a href="docs/screenshots/2026-10-25/quote-redesign-light-1440.png"><img src="docs/screenshots/2026-10-25/quote-redesign-light-1440.png" alt="Quote list with a synthetic accepted quote, follow-up date and next actions" width="400"></a></td>
    <td width="50%" valign="top"><strong>Invoice editor</strong><br><a href="docs/screenshots/2026-10-25/invoice-editor-1440.png"><img src="docs/screenshots/2026-10-25/invoice-editor-1440.png" alt="Unfilled invoice editor with an unresolved tax profile, items and payment terms; no invoice created" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Quote editor</strong><br><a href="docs/screenshots/2026-10-25/quote-editor-1440.png"><img src="docs/screenshots/2026-10-25/quote-editor-1440.png" alt="Unfilled quote editor with tax selection, recipient, items and validity date" width="400"></a></td>
    <td width="50%" valign="top"><strong>Invoice details · mobile</strong><br><a href="docs/screenshots/2026-10-25/invoice-details-375.png"><img src="docs/screenshots/2026-10-25/invoice-details-375.png" alt="Mobile invoice details for a synthetic paid invoice, showing balance and original file" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Partial payments &amp; payment history</strong><br><a href="docs/screenshots/2026-10-25/partial-payments-1440-two-events.png"><img src="docs/screenshots/2026-10-25/partial-payments-1440-two-events.png" alt="Saved synthetic payment evidence and balance in the scrolled invoice dialog" width="400"></a></td>
    <td width="50%" valign="top"><strong>Reminders</strong><br><a href="docs/screenshots/2026-10-25/records-history-reminder-queue-light-1440.png"><img src="docs/screenshots/2026-10-25/records-history-reminder-queue-light-1440.png" alt="Reminder workspace with a synthetic overdue invoice, remaining balance and internal-record-only notice" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Invoice history</strong><br><a href="docs/screenshots/2026-10-25/records-history-history-evidence-light-1440.png"><img src="docs/screenshots/2026-10-25/records-history-history-evidence-light-1440.png" alt="Invoice history with a synthetic original, separate payment evidence and logged events" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Customers, catalogue &amp; services</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Customer timeline</strong><br><a href="docs/screenshots/2026-10-25/customer-timeline-desktop-1440.png"><img src="docs/screenshots/2026-10-25/customer-timeline-desktop-1440.png" alt="Customer timeline with synthetic quotes, invoices and payment evidence" width="400"></a></td>
    <td width="50%" valign="top"><strong>Articles &amp; services</strong><br><a href="docs/screenshots/2026-10-25/catalog-inbox-articles-light-1440.png"><img src="docs/screenshots/2026-10-25/catalog-inbox-articles-light-1440.png" alt="Article and service catalogue with synthetic items, net prices and tax information" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Customer CSV</strong><br><a href="docs/screenshots/2026-10-25/csv-redesign-customer-preview-light-1440.png"><img src="docs/screenshots/2026-10-25/csv-redesign-customer-preview-light-1440.png" alt="Unconfirmed customer CSV preview with valid, invalid and duplicate synthetic records" width="400"></a></td>
    <td width="50%" valign="top"><strong>Article CSV</strong><br><a href="docs/screenshots/2026-10-25/csv-redesign-article-preview-light-1440.png"><img src="docs/screenshots/2026-10-25/csv-redesign-article-preview-light-1440.png" alt="Unconfirmed article CSV preview with a synthetic gross price, net conversion and tax information" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Projects &amp; time entries</strong><br><a href="docs/screenshots/2026-10-25/project-services-workbench-desktop-1440.png"><img src="docs/screenshots/2026-10-25/project-services-workbench-desktop-1440.png" alt="Service notes for a synthetic customer with project selection, manual duration and outstanding services" width="400"></a></td>
    <td width="50%" valign="top"><strong>Service ledger</strong><br><a href="docs/screenshots/2026-10-25/records-history-service-ledger-top-light-1440.png"><img src="docs/screenshots/2026-10-25/records-history-service-ledger-top-light-1440.png" alt="Synthetic service notes with manual duration, free quantity and an explicitly linked invoice" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Service statement</strong><br><a href="docs/screenshots/2026-10-25/service-statement-preview-1440.png"><img src="docs/screenshots/2026-10-25/service-statement-preview-1440.png" alt="Preview of a synthetic service statement with duration, explicitly not an invoice or acceptance" width="400"></a></td>
    <td width="50%" valign="top"><strong>Recurring service plans</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-service-plans-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-service-plans-light-1440.png" alt="Synthetic monthly service plan with an open period and explicit draft-or-skip action" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Accounting &amp; receipt review</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Income</strong><br><a href="docs/screenshots/2026-10-25/cashflow-income-light-1440.png"><img src="docs/screenshots/2026-10-25/cashflow-income-light-1440.png" alt="Income list and unsaved form with synthetic origin and allocation details" width="400"></a></td>
    <td width="50%" valign="top"><strong>Expenses · dark mode</strong><br><a href="docs/screenshots/2026-10-25/cashflow-expense-dark-1440.png"><img src="docs/screenshots/2026-10-25/cashflow-expense-dark-1440.png" alt="Dark-mode expense list with an unsaved form and synthetic manual and source-linked records" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Expense &amp; original</strong><br><a href="docs/screenshots/2026-10-25/catalog-inbox-expense-light-1440.png"><img src="docs/screenshots/2026-10-25/catalog-inbox-expense-light-1440.png" alt="Synthetic saved expense with an unchanged source reference and separate payment and original dates" width="400"></a></td>
    <td width="50%" valign="top"><strong>Receipt review &amp; draft</strong><br><a href="docs/screenshots/2026-10-25/receipt-sequence-desktop-1440.png"><img src="docs/screenshots/2026-10-25/receipt-sequence-desktop-1440.png" alt="Saved synthetic review draft, explicitly not posted, with sequential review and manual fields" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>E-invoice validation</strong><br><a href="docs/screenshots/2026-10-25/incoming-validation-desktop-1440.png"><img src="docs/screenshots/2026-10-25/incoming-validation-desktop-1440.png" alt="Technical validation of a synthetic e-invoice with rule package, validation steps and explicit business-review limitations" width="400"></a></td>
    <td width="50%" valign="top"><strong>Supplier tasks</strong><br><a href="docs/screenshots/2026-10-25/supplier-tasks-1440.png"><img src="docs/screenshots/2026-10-25/supplier-tasks-1440.png" alt="Saved synthetic supplier follow-up, explicitly without payment, posting or notification" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Cash book</strong><br><a href="docs/screenshots/2026-10-25/cashbook-1440.png"><img src="docs/screenshots/2026-10-25/cashbook-1440.png" alt="Cash book workspace with synthetic E2E Nullbestand book, zero balance, ledger and tabs" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Bank CSV &amp; allocation</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Bank CSV &amp; preview</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-bank-preview-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-bank-preview-light-1440.png" alt="Unconfirmed preview of synthetic bank CSV rows with separate incoming and outgoing amounts" width="400"></a></td>
    <td width="50%" valign="top"><strong>Payment allocation</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-bank-allocation-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-bank-allocation-light-1440.png" alt="Unconfirmed allocation of a synthetic CSV transaction to an invoice with an explicit payment check" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Bank mapping profiles</strong><br><a href="docs/screenshots/2026-10-25/feature-profiles-light-1440.png"><img src="docs/screenshots/2026-10-25/feature-profiles-light-1440.png" alt="Synthetic CSV mapping profile with revision, column selection and separate import confirmations" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Reports &amp; handoff</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>EÜR report</strong><br><a href="docs/screenshots/2026-10-25/financial-reports-eur-light-1440.png"><img src="docs/screenshots/2026-10-25/financial-reports-eur-light-1440.png" alt="EÜR report with synthetic values, income-expense comparison and separate private withdrawals" width="400"></a></td>
    <td width="50%" valign="top"><strong>Low-value asset register</strong><br><a href="docs/screenshots/2026-10-25/financial-reports-gwg-light-1440.png"><img src="docs/screenshots/2026-10-25/financial-reports-gwg-light-1440.png" alt="Low-value asset register with a synthetic asset, net amount and year selection" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Tax simulation</strong><br><a href="docs/screenshots/2026-10-25/tax-studio-1440.png"><img src="docs/screenshots/2026-10-25/tax-studio-1440.png" alt="Complete tax simulation for a synthetic tax year with employment assumptions, in-app data basis and model limitations" width="400"></a></td>
    <td width="50%" valign="top"><strong>Document handoff</strong><br><a href="docs/screenshots/2026-10-25/accountant-guide-1440-readiness.png"><img src="docs/screenshots/2026-10-25/accountant-guide-1440-readiness.png" alt="Synthetic handoff preview with open review tasks, a missing original and approval not yet confirmed" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Settings, administration &amp; API</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Settings</strong><br><a href="docs/screenshots/2026-10-25/settings-redesign-light-1440.png"><img src="docs/screenshots/2026-10-25/settings-redesign-light-1440.png" alt="Complete settings page with synthetic company details, tax profile and optional integrations" width="400"></a></td>
    <td width="50%" valign="top"><strong>Backup preview</strong><br><a href="docs/screenshots/2026-10-25/settings-redesign-backup-light-1440.png"><img src="docs/screenshots/2026-10-25/settings-redesign-backup-light-1440.png" alt="Synthetic backup preview with missing files and an explicit overwrite warning" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Document numbering</strong><br><a href="docs/screenshots/2026-10-25/feature-numbering-light-1440.png"><img src="docs/screenshots/2026-10-25/feature-numbering-light-1440.png" alt="Native capture of the document-numbering section with a synthetic invoice format and an unreserved preview" width="400"></a></td>
    <td width="50%" valign="top"><strong>Optional receipt AI</strong><br><a href="docs/screenshots/2026-10-25/ai-receipt-settings-desktop.png"><img src="docs/screenshots/2026-10-25/ai-receipt-settings-desktop.png" alt="Optional AI receipt analysis with a synthetic provider address, hidden key and explicit automation consent" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>User administration</strong><br><a href="docs/screenshots/2026-10-25/users-1440.png"><img src="docs/screenshots/2026-10-25/users-1440.png" alt="User administration with an active synthetic example.test administrator and role actions" width="400"></a></td>
    <td width="50%" valign="top"><strong>API keys · entry</strong><br><a href="docs/screenshots/2026-10-25/api-keys-1440.png"><img src="docs/screenshots/2026-10-25/api-keys-1440.png" alt="API key management with an empty key list, create action and CORS settings; no credentials visible" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>API documentation</strong><br><a href="docs/screenshots/2026-10-25/api-docs-1440.png"><img src="docs/screenshots/2026-10-25/api-docs-1440.png" alt="Complete API documentation with placeholder keys, endpoints, examples and API limitation notes" width="400"></a></td>
    <td width="50%" valign="top"><strong>Audit log</strong><br><a href="docs/screenshots/2026-10-25/audit-1440.png"><img src="docs/screenshots/2026-10-25/audit-1440.png" alt="Audit log with synthetic registration and login events and a masked local IP address" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Procedural documentation</strong><br><a href="docs/screenshots/2026-10-25/procedures-1440.png"><img src="docs/screenshots/2026-10-25/procedures-1440.png" alt="Unsaved procedural documentation with sample fields, system information and section navigation" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Product, help &amp; access</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Product overview · mobile</strong><br><a href="docs/screenshots/2026-10-25/home-pilot-390.png"><img src="docs/screenshots/2026-10-25/home-pilot-390.png" alt="Mobile product overview with an explicitly labelled demo view, workflow links and operator-managed access" width="400"></a></td>
    <td width="50%" valign="top"><strong>Task help · mobile</strong><br><a href="docs/screenshots/2026-10-25/help-pilot-390.png"><img src="docs/screenshots/2026-10-25/help-pilot-390.png" alt="Mobile task help with steps for invoices, payments, expenses and document handoff" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Access help</strong><br><a href="docs/screenshots/2026-10-25/access-help-1440.png"><img src="docs/screenshots/2026-10-25/access-help-1440.png" alt="Access help with recovery and security guidance, without reset links, passwords or confidential input" width="400"></a></td>
    <td width="50%" valign="top"><strong>Login</strong><br><a href="docs/screenshots/2026-10-25/login-public.png"><img src="docs/screenshots/2026-10-25/login-public.png" alt="Empty public login form with a password field and access-help link" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Initial admin setup</strong><br><a href="docs/screenshots/2026-10-25/register-public.png"><img src="docs/screenshots/2026-10-25/register-public.png" alt="Unfilled initial administrator setup form with bootstrap requirement; no credentials entered and not open public signup" width="400"></a></td>
  </tr>
</table>

</details>

49 actual German-language views covering every page and dashboard tab with synthetic test data, captured 25 October 2026. Expand the groups above; click any image for the complete original. [Image provenance and coverage](docs/screenshots/README.md).

## Quick start

Requires Docker Engine with the Compose plugin and Git.

```bash
git clone https://github.com/storminator89/bivaro-kleinunternehmen.git
cd bivaro-kleinunternehmen
cp .env.example .env
```

Set **your own values** in `.env`: `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`), `BIVARO_SETUP_TOKEN` (e.g. `openssl rand -hex 32`) and `NEXTAUTH_URL` (locally `http://localhost:3000`, or the exact public HTTPS URL).

```bash
docker compose config --quiet
docker compose up -d --build
```

Open `http://localhost:3000/register` and create the first admin account using the setup token. Then review company details, tax profile and bank details. Further registration requires explicit admin approval.

**Existing installation:** back up the database and uploads; stop all database writers before migrations. Use one app instance per SQLite database. `docker compose down -v` deletes data. [Setup, updates, backups, SMTP/AI and development](docs/operations/getting-started.en.md).

## Essential limitations

- **No tax or compliance certification:** technical PDF/XML validation is not business approval; no ELSTER filing.
- **No banking automation:** no bank connection, transfers or automatic reconciliation. Saving CSV evidence does not record payments or archive the raw file. Payment capture/reallocation supports bounded EUR small-business cases; corrections can block reports. [Payment rules](docs/features/bank-payment-allocation.md).
- **Explicit approval:** no automatic service billing, payments or retries of unknown email outcomes. SMTP acceptance is not proof of delivery.
- **Optional AI:** off by default, with explicit provider consent and possible costs/privacy obligations. Suggestions remain unreviewed; PDFs are limited to 6 MiB and 1–4 complete pages. [AI contract](docs/ai/provider-contract.md).
- **Operate securely:** use HTTPS publicly and keep secrets private. Use full ZIP backups for original files; back up server secrets and provider credentials separately. No built-in email password reset or self-service MFA. [Account access](docs/operations/account-access.md).

## License

The application is licensed under **[Apache License 2.0](LICENSE) (`Apache-2.0`)**. Third-party components and fonts retain their own licenses; this is not blanket license clearance for the container. [Third-party notices](docs/operations/pdf-third-party-notices.md) · [License details](docs/legal/application-license-transition.md).
