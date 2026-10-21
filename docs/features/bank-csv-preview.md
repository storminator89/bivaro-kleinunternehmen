# Bank-CSV preview

This first slice of #87 prepares bank data for review. It is not a completed
bank import or reconciliation system.

## Available

- A local UTF-8 CSV reader: up to 2 MiB, 2,000 transactions, 64 columns and
  4,000 characters per field. The selected file is not uploaded or persisted.
- Explicit account alias, header, delimiter, date, signed amount or credit/debit,
  currency, counterparty, reference and external-ID mapping.
- Strict calendar dates and integer cents, row errors, EUR control totals and
  visible possible-duplicate warnings. Similar transactions are not discarded.
- Explainable read-only invoice signals, including possible partial payments and
  existing manual-payment cautions. Amount alone is never sufficient.
- At most the latest 100 invoices are compared. Balances come from the existing
  payment journal contract 2, validated by the shared preflight readers. Missing
  or unsafe journals remain unverified. Invoices with corrections or refunds
  are explicitly review-only and cannot generate a new-payment suggestion.

## Deliberate boundaries

No financial write occurs on file selection, preview, comparison, Back or
Discard. Leaving or reloading the workspace clears the local file. There is no
automatic payment, bank connection, credential storage, transfer, currency
conversion, expense creation, split allocation or bank-evidence persistence.

Import receipts, tenant-bound bank evidence, cross-file replay protection,
transactional/idempotent allocation through the authoritative payment journal,
and additive backup/export provenance remain separate work. Preview warnings
are not a substitute for those guarantees or for reviewing actual bank proof.
