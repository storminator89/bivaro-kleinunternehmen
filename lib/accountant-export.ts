import { MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, manualRecordEventsFromBackup } from '@/lib/manual-financial-record-backup';
import type { ManualRecordOriginalEvidence, ManualRecordSnapshot } from '@/lib/manual-financial-record-evidence';
import { isPhotoMedia } from '@/lib/purchase-documents/manual-photo-contract';
import { stableManualPhotoSnapshot, validateManualPhotoSnapshot } from '@/lib/purchase-documents/manual-photo-review';
import { Prisma } from '@prisma/client';
import { loadInvoicePaymentStates } from '@/lib/payment-journal/allocation-ledger';
import JSZip from 'jszip';
import { realpath, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseBusinessDate, formatBusinessDate } from '@/lib/business-date';
import { getIncomeAccountingDate, isCashRealizedIncome } from '@/lib/accounting';
import { inspectMoneyEUR, MONEY_POLICY_VERSION } from '@/lib/money';
import { hashBytes, hashJson } from '@/lib/backup-manifest';
import { BackupFileConsistencyError, BackupFileSizeError, getBackupFileVersion, readStableBackupFile } from '@/lib/backup-snapshot';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { findTenantUploadedFile, isSafeLegacyFileName, isSafeStoredFileName } from '@/lib/upload-path';

export const ACCOUNTANT_EXPORT_LIMITS = {
  maxDays: 366,
  maxRecords: 10_000,
  maxFileBytes: 25 * 1024 * 1024,
  maxMetadataBytes: 16 * 1024 * 1024,
  // Conservative source-text budget before reads/JSON escaping/CSV duplication.
  maxSourceTextBytes: 2 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
} as const;

export class AccountantExportError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'AccountantExportError'; }
}

export type AccountantExportPeriod = { from: string; to: string; start: Date; endExclusive: Date };

/** Exactly one bounded calendar range; never an implicit all-time export. */
export function parseAccountantExportPeriod(params: URLSearchParams): AccountantExportPeriod {
  for (const key of params.keys()) {
    if (!['year', 'from', 'to'].includes(key) || params.getAll(key).length !== 1) {
      throw new AccountantExportError('Nur year oder from und to jeweils einmal angeben.');
    }
  }
  const year = params.get('year');
  let from = params.get('from');
  let to = params.get('to');
  if (year !== null) {
    if (from !== null || to !== null || !/^\d{4}$/.test(year) || Number(year) < 1) {
      throw new AccountantExportError('Ein vierstelliges Jahr oder einen Datumsbereich angeben, nicht beides.');
    }
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  }
  if (!from || !to) throw new AccountantExportError('Bitte year oder beide Datumsfelder from und to angeben.');
  let start: Date;
  let end: Date;
  try { start = parseBusinessDate(from); end = parseBusinessDate(to); }
  catch { throw new AccountantExportError('Ungültiges Kalenderdatum; erwartet wird YYYY-MM-DD.'); }
  const days = (end.getTime() - start.getTime()) / 86_400_000 + 1;
  if (days < 1 || days > ACCOUNTANT_EXPORT_LIMITS.maxDays) {
    throw new AccountantExportError('Der Zeitraum muss aufsteigend sein und darf höchstens 366 Tage umfassen.');
  }
  return { from, to, start, endExclusive: new Date(end.getTime() + 86_400_000) };
}

/** Quoted semicolon CSV; apostrophe neutralizes spreadsheet formulas. Raw data stays in JSON. */
export function accountantCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

type Warning = { code: string; recordType: string; recordId: number | null; message: string };
type IncomingOriginal = { id: number; userId: string; storedFileName: string; originalSha256: string; originalByteCount: number; reviewStatus: string };
type OriginalReference = { purchaseDocumentId: number | null; originalSha256: string | null; recordType: 'invoice' | 'expense'; recordId: number; originalFileName: string | null; status: 'included' | 'missing' | 'not-attached'; zipPath: string | null };

const invoiceSelect = {
  id: true, type: true, fileName: true, storedFileName: true, invoiceDate: true, uploadedAt: true,
  dueDate: true, invoiceNumber: true, totalAmount: true, status: true, issuanceState: true,
  paidAt: true, customerId: true, originalInvoiceId: true, cancellationReason: true,
} satisfies Prisma.InvoiceSelect;

const TEXT_COLUMNS = {
  ManualFinancialRecordEvent: ['snapshot', 'reason', 'semanticHash', 'hash', 'previousHash', 'mutationId'],
  PurchaseDocument: ['reviewedSourceSnapshot', 'reviewDraft'],
  Expense: ['description', 'category', 'receiptFileName', 'storedReceiptFileName'],
  Income: ['description'],
  PaymentAdjustment: ['kind', 'amountCents', 'reason', 'reference', 'payoutEvidenceIdentity', 'basisSnapshot', 'idempotencyKey', 'semanticFingerprint', 'allocationBasisSnapshot'],
  BankPaymentBinding: ['stableKey', 'idempotencyKey', 'semanticFingerprint', 'basisSnapshot'],
  PaymentAllocationChange: ['stableKey', 'amountCents', 'currency', 'reason', 'idempotencyKey', 'semanticFingerprint', 'basisSnapshot'],
  PaymentJournalEvent: ['amountCents', 'currency', 'dateCertainty', 'source', 'reference'],
  Invoice: ['type', 'fileName', 'storedFileName', 'invoiceNumber', 'status', 'issuanceState', 'cancellationReason'],
  CashTransaction: ['type', 'description', 'category', 'receiptNumber'],
  Customer: ['name', 'address', 'zipCode', 'city', 'taxNumber'],
  CashBook: ['name', 'currency'],
  Settings: ['companyName', 'companyAddress', 'taxNumber'],
} as const;

/** SQLite byte aggregates avoid loading arbitrarily large allowed free-text fields.
 * Identifiers come exclusively from the closed allowlist above; values stay bound.
 */
async function reserveSourceText(tx: Prisma.TransactionClient, userId: string, table: keyof typeof TEXT_COLUMNS, ids: (number | string)[] | null, budget: { bytes: number }) {
  if (ids?.length === 0) return;
  const fields = TEXT_COLUMNS[table].map(column => Prisma.sql`COALESCE(length(CAST(${Prisma.raw(`"${column}"`)} AS BLOB)), 0)`);
  const selected = ids === null ? Prisma.empty : Prisma.sql`AND "id" IN (${Prisma.join(ids)})`;
  const rows = await tx.$queryRaw<{ bytes: bigint | number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(${Prisma.join(fields, ' + ')}), 0) AS bytes
    FROM ${Prisma.raw(`"${table}"`)} WHERE "userId" = ${userId} ${selected}
  `);
  budget.bytes += Number(rows[0]?.bytes ?? 0);
  if (!Number.isSafeInteger(budget.bytes) || budget.bytes > ACCOUNTANT_EXPORT_LIMITS.maxSourceTextBytes) {
    throw new AccountantExportError('Die ausgewählten Textdaten überschreiten das Limit von 2 MiB. Bitte einen kürzeren Zeitraum wählen.', 413);
  }
}

/** Narrow business-only selects, bounded before materialization, one DB read transaction. */
async function readAccountantSnapshot(userId: string, period: AccountantExportPeriod) {
  const startedAt = new Date().toISOString();
  const data = await prisma.$transaction(async tx => {
    const range = { gte: period.start, lt: period.endExclusive };
    const expenseWhere: Prisma.ExpenseWhereInput = { userId, date: range };
    // Keep both recorded-date and payment-date evidence. Effective cash dates are explicit below.
    const incomeWhere: Prisma.IncomeWhereInput = { userId, OR: [
      { date: range }, { invoice: { userId, paidAt: range } },
    ] };
    const cashWhere: Prisma.CashTransactionWhereInput = { userId, date: range };
    const invoiceWhere: Prisma.InvoiceWhereInput = { userId, type: { not: 'QUOTE' }, OR: [
      { invoiceDate: range }, { invoiceDate: null, uploadedAt: range }, { paidAt: range },
      { incomes: { some: incomeWhere } },
      { paymentAdjustments: { some: { userId, OR: [{ accountingEffectiveOn: range }, { recordedAt: range }] } } },
      { allocationChangesFrom: { some: { userId, OR: [{ actionDate: range }, { recordedAt: range }] } } },
      { allocationChangesTo: { some: { userId, OR: [{ actionDate: range }, { recordedAt: range }] } } },
      { refundBasisAdjustments: { some: { userId, OR: [{ accountingEffectiveOn: range }, { recordedAt: range }] } } },
    ] };
    const counts = await Promise.all([
      tx.expense.count({ where: expenseWhere }), tx.income.count({ where: incomeWhere }),
      tx.invoice.count({ where: invoiceWhere }), tx.cashTransaction.count({ where: cashWhere }),
    ]);
    let recordCount = counts.reduce((a, b) => a + b, 0);
    const check = () => {
      if (recordCount > ACCOUNTANT_EXPORT_LIMITS.maxRecords) throw new AccountantExportError('Zu viele Datensätze (maximal 10.000). Bitte einen kürzeren Zeitraum wählen.', 413);
    };
    check();
    const textBudget = { bytes: 0 };
    const [expenseIds, incomeIds, invoiceIds, cashIds] = await Promise.all([
      tx.expense.findMany({ where: expenseWhere, select: { id: true } }),
      tx.income.findMany({ where: incomeWhere, select: { id: true } }),
      tx.invoice.findMany({ where: invoiceWhere, select: { id: true } }),
      tx.cashTransaction.findMany({ where: cashWhere, select: { id: true } }),
    ]);
    for (const [table, rows] of [['Expense', expenseIds], ['Income', incomeIds], ['Invoice', invoiceIds], ['CashTransaction', cashIds]] as const) {
      await reserveSourceText(tx, userId, table, rows.map(row => row.id), textBudget);
    }
    const sourceIds = expenseIds.length ? await tx.purchaseDocument.findMany({ where: { expenseId: { in: expenseIds.map(row => row.id) } }, select: { id: true, userId: true } }) : [];
    if (sourceIds.some(source => source.userId !== userId)) throw new AccountantExportError('Originalzuordnung gehört nicht zum ausgewählten Arbeitsbereich.', 409);
    await reserveSourceText(tx, userId, 'PurchaseDocument', sourceIds.map(row => row.id), textBudget);
    await reserveSourceText(tx, userId, 'Settings', null, textBudget);
    const [expenses, incomes, invoices, cashTransactions, company] = await Promise.all([
      tx.expense.findMany({ where: expenseWhere, orderBy: { id: 'asc' }, select: {
        manualRecordId: true, manualRecordState: true, manualRecordOrigin: true, manualRecordRevision: true, receiptUrl: true,
        id: true, description: true, amount: true, date: true, category: true, taxRelevant: true,
        taxDeductiblePercentage: true, depreciationYears: true, receiptFileName: true, storedReceiptFileName: true,
        purchaseDocument: { select: { id: true, userId: true, storedFileName: true, originalSha256: true, originalByteCount: true, reviewStatus: true, mediaType: true, uploadRequestId: true, revision: true, reviewDraft: true, reviewDraftSavedAt: true, reviewedSourceSnapshot: true } },
      } }),
      tx.income.findMany({ where: incomeWhere, orderBy: { id: 'asc' }, select: {
        manualRecordId: true, manualRecordState: true, manualRecordOrigin: true, manualRecordRevision: true,
        id: true, description: true, amount: true, date: true, customerId: true, invoiceId: true, taxRelevant: true,
        paymentJournalEvent: { select: { id: true, amountCents: true, paidAt: true, dateCertainty: true, source: true, reference: true } },
      } }),
      tx.invoice.findMany({ where: invoiceWhere, orderBy: { id: 'asc' }, select: invoiceSelect }),
      tx.cashTransaction.findMany({ where: cashWhere, orderBy: { id: 'asc' }, select: {
        id: true, date: true, type: true, description: true, amount: true, runningBalance: true, category: true,
        receiptNumber: true, taxRelevant: true, cashBookId: true, expenseId: true, incomeId: true,
      } }),
      tx.settings.findUnique({ where: { userId }, select: { companyName: true, companyAddress: true, taxNumber: true } }),
    ]);
    // Include the original sales document behind a credit note, without importing other tenants' relations.
    const seen = new Set(invoices.map(row => row.id));
    let pending = invoices.flatMap(row => row.originalInvoiceId && !seen.has(row.originalInvoiceId) ? [row.originalInvoiceId] : []);
    while (pending.length) {
      pending = [...new Set(pending)].filter(id => !seen.has(id));
      if (!pending.length) break;
      // Reserve before selecting text, including older correction-chain context.
      await reserveSourceText(tx, userId, 'Invoice', pending, textBudget);
      const originals = await tx.invoice.findMany({ where: { userId, id: { in: pending }, type: { not: 'QUOTE' } }, select: invoiceSelect, orderBy: { id: 'asc' } });
      pending = [];
      for (const row of originals) {
        if (seen.has(row.id)) continue;
        seen.add(row.id); invoices.push(row); recordCount++; check();
        if (row.originalInvoiceId && !seen.has(row.originalInvoiceId)) pending.push(row.originalInvoiceId);
      }
    }
    const selectedInvoiceIds = [...seen];
    // Close the immutable allocation lineage before following adjustment roots.
    // Cash remains at origin; current invoice/cancellation context is separate.
    const bindingWhere: Prisma.BankPaymentBindingWhereInput = { userId, OR: [
      { paymentJournalEvent: { userId, invoiceId: { in: [...seen] } } },
      { allocationChanges: { some: { userId, OR: [{ fromInvoiceId: { in: [...seen] } }, { toInvoiceId: { in: [...seen] } }] } } },
    ] };
    recordCount += await tx.bankPaymentBinding.count({ where: bindingWhere }); check();
    const bindingIds = await tx.bankPaymentBinding.findMany({ where: bindingWhere, select: { id: true } });
    await reserveSourceText(tx, userId, 'BankPaymentBinding', bindingIds.map(row => row.id), textBudget);
    const bindings = await tx.bankPaymentBinding.findMany({ where: bindingWhere, orderBy: { id: 'asc' }, select: {
      id: true, stableKey: true, bankImportRow: { select: { stableKey: true } }, paymentJournalEventId: true,
      paymentJournalEvent: { select: { invoiceId: true } }, idempotencyKey: true, semanticFingerprint: true, basisSnapshot: true, contractVersion: true, createdAt: true,
    } });
    const changeWhere = { userId, bindingId: { in: bindings.map(row => row.id) } };
    recordCount += await tx.paymentAllocationChange.count({ where: changeWhere }); check();
    const changeIds = await tx.paymentAllocationChange.findMany({ where: changeWhere, select: { id: true } });
    await reserveSourceText(tx, userId, 'PaymentAllocationChange', changeIds.map(row => row.id), textBudget);
    const allocationChanges = await tx.paymentAllocationChange.findMany({ where: changeWhere, orderBy: [{ bindingId: 'asc' }, { revision: 'asc' }], select: {
      id: true, stableKey: true, bindingId: true, revision: true, previousChangeId: true, fromInvoiceId: true, toInvoiceId: true,
      amountCents: true, currency: true, actionDate: true, reason: true, idempotencyKey: true, semanticFingerprint: true, basisSnapshot: true, contractVersion: true, recordedAt: true,
    } });
    const allocationContextIds = [...new Set([...bindings.map(row => row.paymentJournalEvent.invoiceId), ...allocationChanges.flatMap(row => [row.fromInvoiceId, row.toInvoiceId])])].filter(id => !seen.has(id));
    if (allocationContextIds.length) {
      recordCount += allocationContextIds.length; check();
      await reserveSourceText(tx, userId, 'Invoice', allocationContextIds, textBudget);
      const context = await tx.invoice.findMany({ where: { userId, id: { in: allocationContextIds }, type: 'INVOICE' }, select: invoiceSelect });
      if (context.length !== allocationContextIds.length) throw new AccountantExportError('Rechnungszuordnung enthält unaufgelösten oder fremden Ursprungskontext.', 409);
      for (const row of context) { invoices.push(row); seen.add(row.id); }
    }
    // Shared batch loader validates full row/binding/head/adjustment evidence.
    // Export must not make a second, weaker validator or per-invoice cash engine.
    await loadInvoicePaymentStates(tx, userId, [...new Set(bindings.map(row => row.paymentJournalEvent.invoiceId))]);
    const adjustmentWhere: Prisma.PaymentAdjustmentWhereInput = { userId, OR: [
      { invoiceId: { in: selectedInvoiceIds } }, { originalPayment: { userId, invoiceId: { in: selectedInvoiceIds } } }, { originalPaymentId: { in: bindings.map(row => row.paymentJournalEventId) } },
    ] };

    recordCount += await tx.paymentAdjustment.count({ where: adjustmentWhere }); check();
    const adjustmentIds = await tx.paymentAdjustment.findMany({ where: adjustmentWhere, select: { id: true, cancellationInvoiceId: true } });
    await reserveSourceText(tx, userId, 'PaymentAdjustment', adjustmentIds.map(row => row.id), textBudget);
    const adjustments = await tx.paymentAdjustment.findMany({ where: adjustmentWhere, orderBy: { id: 'asc' }, select: {
      id: true, invoiceId: true, originalPaymentId: true, kind: true, amountCents: true, currency: true, actionDate: true, accountingEffectiveOn: true,
      reason: true, reference: true, payoutEvidenceIdentity: true, cancellationInvoiceId: true, basisSnapshot: true, idempotencyKey: true, semanticFingerprint: true, contractVersion: true, recordedAt: true,
      allocationBindingId: true, allocationRevision: true, allocationChangeId: true, allocationBasisSnapshot: true,
    } });
    const basisIds = [...new Set(adjustments.flatMap(row => row.cancellationInvoiceId != null && !seen.has(row.cancellationInvoiceId) ? [row.cancellationInvoiceId] : []))];
    if (basisIds.length) {
      await reserveSourceText(tx, userId, 'Invoice', basisIds, textBudget);
      const bases = await tx.invoice.findMany({ where: { userId, id: { in: basisIds }, type: 'CREDIT_NOTE' }, select: invoiceSelect });
      for (const row of bases) { invoices.push(row); seen.add(row.id); recordCount++; check(); }
    }
    const paymentWhere: Prisma.PaymentJournalEventWhereInput = { userId, OR: [{ invoiceId: { in: selectedInvoiceIds } }, { id: { in: adjustments.map(row => row.originalPaymentId) } }, { id: { in: bindings.map(row => row.paymentJournalEventId) } }] };
    recordCount += await tx.paymentJournalEvent.count({ where: paymentWhere }); check();
    const paymentIds = await tx.paymentJournalEvent.findMany({ where: paymentWhere, select: { id: true } });
    await reserveSourceText(tx, userId, 'PaymentJournalEvent', paymentIds.map(row => row.id), textBudget);
    const payments = await tx.paymentJournalEvent.findMany({ where: paymentWhere, orderBy: { id: 'asc' }, select: {
      id: true, invoiceId: true, incomeId: true, amountCents: true, currency: true, paidAt: true,
      dateCertainty: true, source: true, reference: true, createdAt: true,
    } });
    const originInvoiceIds = [...new Set(payments.map(row => row.invoiceId))].filter(id => !seen.has(id));
    if (originInvoiceIds.length) {
      recordCount += originInvoiceIds.length; check();
      await reserveSourceText(tx, userId, 'Invoice', originInvoiceIds, textBudget);
      const context = await tx.invoice.findMany({ where: { userId, id: { in: originInvoiceIds }, type: 'INVOICE' }, select: invoiceSelect });
      if (context.length !== originInvoiceIds.length) throw new AccountantExportError('Originalzahlung ohne eigenen Rechnungskontext.', 409);
      for (const row of context) { invoices.push(row); seen.add(row.id); }
    }
    const knownIncomeIds = new Set(incomes.map(row => row.id));
    const contextIncomeIds = payments.flatMap(row => row.incomeId != null && !knownIncomeIds.has(row.incomeId) ? [row.incomeId] : []);
    if (contextIncomeIds.length) {
      recordCount += contextIncomeIds.length; check();
      await reserveSourceText(tx, userId, 'Income', contextIncomeIds, textBudget);
      incomes.push(...await tx.income.findMany({ where: { userId, id: { in: contextIncomeIds } }, orderBy: { id: 'asc' }, select: {
        manualRecordId: true, manualRecordState: true, manualRecordOrigin: true, manualRecordRevision: true,
        id: true, description: true, amount: true, date: true, customerId: true, invoiceId: true, taxRelevant: true,
        paymentJournalEvent: { select: { id: true, amountCents: true, paidAt: true, dateCertainty: true, source: true, reference: true } },
      } }));
    }
    const customerIds = [...new Set([...incomes, ...invoices].flatMap(row => row.customerId ? [row.customerId] : []))];
    const cashBookIds = [...new Set(cashTransactions.map(row => row.cashBookId))];
    await reserveSourceText(tx, userId, 'Customer', customerIds, textBudget);
    await reserveSourceText(tx, userId, 'CashBook', cashBookIds, textBudget);
    const [customers, cashBooks] = await Promise.all([
      tx.customer.findMany({ where: { userId, id: { in: customerIds } }, orderBy: { id: 'asc' }, select: {
        id: true, name: true, address: true, zipCode: true, city: true, taxNumber: true,
      } }),
      tx.cashBook.findMany({ where: { userId, id: { in: cashBookIds } }, orderBy: { id: 'asc' }, select: { id: true, name: true, currency: true } }),
    ]);
    recordCount += customers.length + cashBooks.length; check();
    const manualWhere: Prisma.ManualFinancialRecordEventWhereInput = { userId, OR: [
      { incomeId: { in: incomes.map(row => row.id) } }, { expenseId: { in: expenses.map(row => row.id) } },
    ] };
    recordCount += await tx.manualFinancialRecordEvent.count({ where: manualWhere }); check();
    const manualIds = await tx.manualFinancialRecordEvent.findMany({ where: manualWhere, select: { id: true } });
    await reserveSourceText(tx, userId, 'ManualFinancialRecordEvent', manualIds.map(row => row.id), textBudget);
    const manualFinancialRecordEvents = (await tx.manualFinancialRecordEvent.findMany({ where: manualWhere, orderBy: [{ recordId: 'asc' }, { sequence: 'asc' }] }))
      .map(({ userId: _owner, ...event }) => { void _owner; return event; });
    try { manualRecordEventsFromBackup(JSON.parse(JSON.stringify({ incomes, expenses, manualFinancialRecordEvents, customers, cashTransactions })), MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION); }
    catch { throw new AccountantExportError('Manueller Festschreibungsverlauf oder wirksame Projektion ist inkonsistent.', 409); }
    return { company, expenses, incomes, invoices, payments, adjustments, bindings, allocationChanges, cashTransactions, customers, cashBooks, manualFinancialRecordEvents };
  });
  const endedAt = new Date().toISOString();
  return { data, info: { id: hashJson(data), startedAt, endedAt, consistency: 'single-read-transaction' as const } };
}

const README = `Manueller Finanznachweis-Vertrag 1: Income/Expense enthalten genau einen wirksamen Betrag.
FINALIZE und CORRECT_AMOUNT sind nur Kontext/Evidenz, keine weiteren Einnahmen/Ausgaben, Erstattungen oder Bargeldbewegungen.
Originalbetrag, Begründung, unverändertes Zahlungsdatum und Hashkette stehen in manualFinancialRecordEvents; cashEffectCents=0.
Festschreibung ist eine Integritätsaktion, keine zusätzliche Verbuchung und keine steuerliche Freigabe.
Bivaro – Übergabepaket an die Steuerberatung (Format 2)
Zahlungsjournal-Vertrag 2/3: Positive Originale und unveränderte Einnahmenprojektionen sind nicht zu addieren.
Zahlungsberichtigungen mindern nie geflossene Beträge am ursprünglichen Zahlungsdatum. Tatsächliche
Kundenrückzahlungen sind separate negative operative Bewegungen am Auszahlungstag. Stornobelege und Rechnungszuordnungsänderungen erzeugen
keine Geldbewegung. bindings/allocationChanges dokumentieren nur die Zuordnung des unveränderten
Originaleingangs. originInvoiceId bleibt Ursprung, allocatedInvoiceId ist die aktuelle Zuordnung.
Kontextzeilen außerhalb des Zeitraums haben periodEffectCents=0 und dürfen nicht erneut summiert werden. accountingEffectiveInPeriod/contextOnly trennen Zeitraum und Belegkontext.
Alle Berichtigungs-/Erstattungszuordnungen sind fiscalMappingStatus=UNREVIEWED; keine freigegebene EÜR-Zeile,
keine Änderung einer abgegebenen Steuererklärung. Frühere Auswertungen betroffener Jahre müssen geprüft werden.
Dieses Paket ist eine begrenzte Arbeitsunterlage, kein DATEV-Format, keine DATEV-Zertifizierung,
kein ELSTER-Import/keine Übermittlung, kein vollständiger GoBD-Prüfexport und kein wiederherstellbares Backup.
Zeitraum: inklusive UTC-Kalendertage von/bis; max. 366 Tage.
Ausgaben und Kassenbewegungen: gespeichertes Datum im Zeitraum. Einnahmen: gespeichertes Datum
ODER Zahlungsdatum der eigenen verknüpften Rechnung im Zeitraum. accountingDate und
accountingDateInPeriod zeigen den wirksamen Zahlungsbezug; cashRealized zeigt die aktuelle Buchungssemantik.
Ausgaben-Datum ist der gespeicherte Buchungs-/Abflusswert, kein separat bestätigter Bankzahlungsnachweis.
Rechnungen/Gutschriften: Rechnungsdatum (bei fehlendem Datum Upload-Datum), Zahlungsdatum oder
verknüpfte Einnahme im Zeitraum. Ursprungsrechnungen von Gutschriften sind als Kontext enthalten.
Angebote, nicht gebuchte Eingangsbeleg-Inbox, wiederkehrende Vorlagen und nicht betroffene Stammdaten fehlen bewusst.
invoiceId/originalInvoiceId/customerId/expenseId/incomeId/cashBookId sind Datenbank-Verknüpfungen,
keine Konten; nicht jede referenzierte Buchung liegt im Zeitraum. Unaufgelöste Bezüge stehen in warnings.
Zahlungsmodell: jede bestätigte positive Teilzahlung hat eine eigene Einnahme und unveränderlichen Journalbezug;
CSV-Bankevidenz ist keine Bankauthentifizierung; Zuordnungsänderung ist keine Zahlung oder Erstattung. Storno ist keine Rückzahlung.
payments.csv enthält auch historische Nachweise ohne Einnahme; Unsicherheit und fehlende Daten bleiben explizit.
Die Tabellen sind unterschiedliche Sichten: Rechnung, Einnahme und verknüpfte Kasse NIEMALS addieren;
dies würde denselben Vorgang doppelt zählen. Entwürfe und steuerlich irrelevante Datensätze bleiben sichtbar.
Keine automatische EÜR-/Steuerberechnung, Kontierung, AfA-Verteilung oder Abziehbarkeitsbewertung.
Gespeicherte Kategorien, Steuerrelevanz, Abzugsquote und AfA-Jahre sind unbewertete Eingabewerte.
Beträge: amount ist die gespeicherte Dezimaldarstellung; amountCents/amountRoundingDifferenceCents
sind transparente Dezimal-Hilfswerte der EUR-Money-Policy, keine rückwirkende Datenänderung oder Währungsumrechnung.
Rechnungswährung ist ohne Originalprüfung unbekannt (currency=null); Kassenwährung steht separat. Prüfwarnungen beachten.
CSV: UTF-8, Semikolon, alle Felder in Anführungszeichen, CRLF; eingebettete Umbrüche bleiben zitiert.
Formelverdächtige Zellen erhalten ein führendes Apostroph. Unveränderte Textwerte stehen in records.json.
originals/ enthält unveränderte Originalbytes; archive paths sind generiert und nie Benutzerpfade.
Originaldateinamen stehen nur als Metadaten in records.json/originals.csv. Fehlende/gesperrte/unsichere
Dateien bleiben ausdrücklich als missing markiert; Datensätze werden deswegen nicht weggelassen.
manifest.json enthält Zeitraum, Scope, Modellzählungen, Warnungen, SHA-256 und Größe jedes anderen ZIP-Eintrags.
Der Manifest-Hash selbst ist absichtlich nicht enthalten (keine rekursive Selbstsignatur).
Hashes belegen Inhaltsgleichheit, weder Signatur noch Unveränderbarkeit oder Vollständigkeit außerhalb des Scopes.
DB-Daten: ein kurzer Lesetransaktions-Snapshot; Originaldateien separat stabil gelesen und vor Fertigstellung
erneut auf Versionsdrift geprüft; keine atomare DB-Dateisystem-Gesamtsicherung.
Bewusste Ausschlüsse: Passwörter, Benutzerkonto, API-Schlüssel, SMTP-/Hosteinstellungen, Secrets,
Sicherheits-/Zugriffs-/Änderungslogs, interne Kundennotizen und nicht erforderliche Kontaktdaten.
Limits (kein stilles Abschneiden): 10.000 Datensätze; 25 MiB je Original; 2 MiB ausgewählte Quelltexte
(konservativer Schutz vor JSON-Escaping/CSV-Vervielfachung); 16 MiB Metadaten;
100 MiB unkomprimiert insgesamt. Bei Überschreitung kürzeren Zeitraum wählen (HTTP 413).
Das Paket enthält vertrauliche Geschäfts-/Personendaten: nur über einen geeigneten sicheren Kanal weitergeben.
`;

/** Preview and download share all selection, original-file and resource checks.
 * A preview hashes one original at a time but retains no ZIP or compressed bytes.
 */
async function buildAccountantExport(userId: string, period: AccountantExportPeriod, preview: boolean, expectedFingerprint?: string) {
  const snapshot = await readAccountantSnapshot(userId, period);
  const zip = preview ? null : new JSZip();
  const warnings: Warning[] = [];
  const entries: { zipPath: string; bytes: number; sha256: string; kind: 'original' | 'metadata'; purchaseDocumentId?: number; originalSha256?: string }[] = [];
  const originals: OriginalReference[] = [];
  const sources: { path: string; version: string }[] = [];
  let totalBytes = 0;
  let metadataBytes = 0;
  const addEntry = (zipPath: string, bytes: Buffer, kind: 'original' | 'metadata') => {
    totalBytes += bytes.byteLength;
    if (kind === 'metadata') metadataBytes += bytes.byteLength;
    if (totalBytes > ACCOUNTANT_EXPORT_LIMITS.maxTotalBytes || metadataBytes > ACCOUNTANT_EXPORT_LIMITS.maxMetadataBytes) {
      throw new AccountantExportError('Übergabepaket überschreitet das Größenlimit. Bitte einen kürzeren Zeitraum wählen.', 413);
    }
    zip?.file(zipPath, bytes, { createFolders: false });
    entries.push({ zipPath, bytes: bytes.byteLength, sha256: hashBytes(bytes), kind });
  };
  const addOriginal = async (recordType: 'invoice' | 'expense', recordId: number, storedName: string | null, originalFileName: string | null, source?: IncomingOriginal | null, manualOriginal?: ManualRecordOriginalEvidence | null) => {
    if (source && (source.userId !== userId || source.reviewStatus !== 'BOOKED' || source.storedFileName !== storedName)) throw new AccountantExportError('Quellenverknüpfung eines Eingangsoriginals ist inkonsistent.', 409);
    const ref: OriginalReference = { recordType, recordId, originalFileName, status: 'missing', zipPath: null, purchaseDocumentId: source?.id ?? null, originalSha256: manualOriginal?.sha256 ?? source?.originalSha256 ?? null };
    originals.push(ref);
    if (manualOriginal?.status === 'ARCHIVED' && !storedName) throw new AccountantExportError('Festgeschriebenes manuelles Original fehlt.', 409);
    if (!storedName && recordType === 'expense') {
      ref.status = 'not-attached';
      warnings.push({ code: 'ORIGINAL_NOT_ATTACHED', recordType, recordId, message: 'Kein Originalbeleg an der Ausgabe hinterlegt.' });
      return;
    }
    if (storedName && (isSafeStoredFileName(storedName) || isSafeLegacyFileName(storedName))) {
      const filePath = source ? await findTenantUploadedFile(userId, storedName) : await findOwnedUploadedFile(userId, storedName);
      if (filePath) {
        try {
          // The shared resolver checks tenant/legacy ownership and lexical paths;
          // additionally reject filesystem symlinks (including parent directories).
          if (await realpath(filePath) !== resolve(filePath) || !(await lstat(filePath)).isFile()) {
            throw new Error('Unsafe original path');
          }
          const stable = await readStableBackupFile(filePath, Math.min(ACCOUNTANT_EXPORT_LIMITS.maxFileBytes, ACCOUNTANT_EXPORT_LIMITS.maxTotalBytes - totalBytes));
          if (stable) {
            if (manualOriginal?.status === 'ARCHIVED' && (stable.sha256 !== manualOriginal.sha256 || stable.bytes.byteLength !== manualOriginal.byteCount)) throw new AccountantExportError('Integritätsprüfung eines festgeschriebenen manuellen Originals fehlgeschlagen.', 409);
            if (source && (stable.sha256 !== source.originalSha256 || stable.bytes.byteLength !== source.originalByteCount)) throw new AccountantExportError('Integritätsprüfung eines Eingangsoriginals fehlgeschlagen.', 409);
            const extension = storedName.match(/\.([a-zA-Z0-9]{1,16})$/u)?.[1].toLowerCase() ?? 'bin';
            const zipPath = `originals/${recordType}-${recordId}.${extension}`;
            addEntry(zipPath, stable.bytes, 'original');
            if (source) Object.assign(entries[entries.length - 1], { purchaseDocumentId: source.id, originalSha256: source.originalSha256 });
            ref.status = 'included'; ref.zipPath = zipPath;
            sources.push({ path: filePath, version: stable.sourceVersion });
            return;
          }
        } catch (error) {
          if (error instanceof BackupFileSizeError) throw new AccountantExportError('Ein Original oder das Paket überschreitet das Größenlimit. Bitte Zeitraum verkürzen.', 413);
          if (error instanceof BackupFileConsistencyError || error instanceof AccountantExportError) throw error;
          if (source || manualOriginal?.status === 'ARCHIVED') throw new AccountantExportError('Eingangsoriginal fehlt oder seine Integrität konnte nicht bestätigt werden.', 409);
          // Do not leak private paths or resolver details into the handoff.
        }
      }
    }
    if (source || manualOriginal?.status === 'ARCHIVED') throw new AccountantExportError('Eingangsoriginal fehlt oder seine Integrität konnte nicht bestätigt werden.', 409);
    warnings.push({ code: 'ORIGINAL_MISSING', recordType, recordId, message: 'Referenziertes Original fehlt, ist nicht lesbar oder nicht sicher diesem Mandanten zugeordnet.' });
  };
  for (const row of snapshot.data.invoices) await addOriginal('invoice', row.id, row.storedFileName, row.fileName);
  for (const row of snapshot.data.expenses) {
    const root = snapshot.data.manualFinancialRecordEvents.find(event => event.recordId === row.manualRecordId && event.sequence === 1)?.snapshot as unknown as ManualRecordSnapshot | undefined;
    await addOriginal('expense', row.id, row.storedReceiptFileName, row.receiptFileName, row.purchaseDocument, root?.original);
  }

  const money = (value: number | null, recordType: string, recordId: number, field = 'amount') => {
    if (value === null) return { [field]: null, [`${field}Cents`]: null, [`${field}RoundingDifferenceCents`]: null };
    const inspected = inspectMoneyEUR(value);
    if (inspected.error || inspected.differenceCents !== '0') warnings.push({
      code: inspected.error ? 'MONEY_INVALID' : 'MONEY_ROUNDING', recordType, recordId,
      message: inspected.error ?? `${field}: Cent-Hilfswert weicht um ${inspected.differenceCents} Cent vom gespeicherten Wert ab.`,
    });
    return { [field]: inspected.sourceValue, [`${field}Cents`]: inspected.normalizedCents?.toString() ?? null, [`${field}RoundingDifferenceCents`]: inspected.differenceCents };
  };
  const invoiceById = new Map(snapshot.data.invoices.map(row => [row.id, row]));
  const invoiceIds = new Set(invoiceById.keys());
  const originalByRecord = new Map(originals.map(ref => [`${ref.recordType}:${ref.recordId}`, ref]));
  const customers = new Set(snapshot.data.customers.map(row => row.id));
  const expenseIds = new Set(snapshot.data.expenses.map(row => row.id));
  const incomeIds = new Set(snapshot.data.incomes.map(row => row.id));
  const books = new Set(snapshot.data.cashBooks.map(row => row.id));
  const checkRef = (id: number | null, available: Set<number>, recordType: string, recordId: number, field: string) => {
    if (id != null && !available.has(id)) warnings.push({ code: 'REFERENCE_OUTSIDE_SCOPE', recordType, recordId, message: `${field}=${id}: Bezug liegt außerhalb der Auswahl oder ist nicht diesem Mandanten zugeordnet.` });
  };
  const inPeriod = (date: Date) => date >= period.start && date < period.endExclusive;
  const invoices = snapshot.data.invoices.map(row => {
    const { storedFileName: _stored, fileName: originalFileName, totalAmount, ...rest } = row;
    checkRef(row.customerId, customers, 'invoice', row.id, 'customerId');
    checkRef(row.originalInvoiceId, invoiceIds, 'invoice', row.id, 'originalInvoiceId');
    warnings.push({ code: 'INVOICE_CURRENCY_UNSPECIFIED', recordType: 'invoice', recordId: row.id, message: 'Rechnungswährung ist kein eigenes gespeichertes Feld in diesem Exportformat; bitte im Original prüfen. Es erfolgt keine Währungsumrechnung.' });
    return { ...rest, originalFileName, currency: null, documentDateSource: row.invoiceDate ? 'invoiceDate' : 'uploadedAt',
      contextOnly: !inPeriod(row.invoiceDate ?? row.uploadedAt) && !(row.paidAt && inPeriod(row.paidAt)), documentDateInPeriod: inPeriod(row.invoiceDate ?? row.uploadedAt), paymentDateInPeriod: row.paidAt ? inPeriod(row.paidAt) : false,
      ...money(totalAmount, 'invoice', row.id), originalZipPath: originalByRecord.get(`invoice:${row.id}`)?.zipPath ?? null };
  });
  const expenses = snapshot.data.expenses.map(row => {
    const { storedReceiptFileName: _stored, receiptFileName: originalFileName, amount, purchaseDocument: source, ...rest } = row;
    let manualSourceReview = null;
    if (source && isPhotoMedia(source.mediaType)) {
      try { manualSourceReview = stableManualPhotoSnapshot(validateManualPhotoSnapshot(source.reviewedSourceSnapshot, source, { amount, date: row.date, description: row.description })); }
      catch { throw new AccountantExportError('Manuelle Foto-Originalfreigabe stimmt nicht mit der Ausgabe überein.', 409); }
    }
    return { ...rest, sourceReviewProvenance: manualSourceReview?.provenance ?? null, manualSourceReview, purchaseDocumentId: source?.id ?? null, originalSha256: source?.originalSha256 ?? (snapshot.data.manualFinancialRecordEvents.find(event => event.recordId === row.manualRecordId && event.sequence === 1)?.snapshot as unknown as ManualRecordSnapshot | undefined)?.original.sha256 ?? null, ...money(amount, 'expense', row.id), paymentDateSource: 'expense.date (stored booking/outflow date)', originalFileName,
      originalZipPath: originalByRecord.get(`expense:${row.id}`)?.zipPath ?? null };
  });
  const currentAllocation = (rootId: number) => {
    const binding = snapshot.data.bindings.find(row => row.paymentJournalEventId === rootId);
    const head = binding ? snapshot.data.allocationChanges.filter(row => row.bindingId === binding.id).at(-1) : null;
    const originInvoiceId = snapshot.data.payments.find(row => row.id === rootId)?.invoiceId ?? null;
    return { originInvoiceId, allocatedInvoiceId: head?.toInvoiceId ?? originInvoiceId, bindingStableKey: binding?.stableKey ?? null, allocationRevision: binding ? head?.revision ?? 0 : null };
  };
  const incomes = snapshot.data.incomes.map(row => {
    const invoice = row.invoiceId ? invoiceById.get(row.invoiceId) ?? null : null;
    checkRef(row.customerId, customers, 'income', row.id, 'customerId');
    checkRef(row.invoiceId, invoiceIds, 'income', row.id, 'invoiceId');
    const accountingDate = getIncomeAccountingDate({ ...row, invoice });
    return { ...row, ...(row.paymentJournalEvent ? currentAllocation(row.paymentJournalEvent.id) : { originInvoiceId: row.invoiceId, allocatedInvoiceId: row.invoiceId, bindingStableKey: null, allocationRevision: null }), paymentJournalEventId: row.paymentJournalEvent?.id ?? null,
      paymentDate: row.paymentJournalEvent?.paidAt ?? null, paymentDateCertainty: row.paymentJournalEvent?.dateCertainty ?? null,
      paymentSource: row.paymentJournalEvent?.source ?? null, paymentReference: row.paymentJournalEvent?.reference ?? null,
      ...money(row.amount, 'income', row.id), periodEffectCents: !inPeriod(accountingDate) ? '0' : inspectMoneyEUR(row.amount).normalizedCents?.toString() ?? null, accountingDate: formatBusinessDate(accountingDate),
      contextOnly: !inPeriod(accountingDate), accountingDateInPeriod: inPeriod(accountingDate), cashRealized: row.invoiceId != null && !invoice ? null : isCashRealizedIncome({ ...row, invoice }),
      invoiceStatus: invoice?.status ?? null, invoicePaidAt: invoice?.paidAt ?? null };
  });
  const cashTransactions = snapshot.data.cashTransactions.map(row => {
    checkRef(row.expenseId, expenseIds, 'cashTransaction', row.id, 'expenseId');
    checkRef(row.incomeId, incomeIds, 'cashTransaction', row.id, 'incomeId');
    checkRef(row.cashBookId, books, 'cashTransaction', row.id, 'cashBookId');
    const currency = snapshot.data.cashBooks.find(book => book.id === row.cashBookId)?.currency ?? null;
    if (currency !== 'EUR') warnings.push({ code: 'CASH_CURRENCY_NOT_EUR', recordType: 'cashTransaction', recordId: row.id, message: 'Kassenwährung ist nicht EUR oder unbekannt; keine Umrechnung oder EUR-Summierung vornehmen.' });
    return { ...row, currency, ...money(row.amount, 'cashTransaction', row.id), ...money(row.runningBalance, 'cashTransaction', row.id, 'runningBalance') };
  });
  const payments = snapshot.data.payments.map(row => {
    if (row.dateCertainty !== 'ACTUAL') warnings.push({ code: 'PAYMENT_DATE_UNCERTAIN', recordType: 'payment', recordId: row.id,
      message: 'Historischer Zahlungsnachweis: Quelle, Unsicherheit und fehlendes Datum bleiben erhalten; kein erfundenes Ist-Datum.' });
    return { ...row, ...currentAllocation(row.id), periodEffectCents: row.dateCertainty === 'ACTUAL' && row.paidAt && inPeriod(row.paidAt) ? row.amountCents : '0', contextOnly: !row.paidAt || !inPeriod(row.paidAt), signedEffectCents: row.dateCertainty === 'ACTUAL' ? row.amountCents : null, movementKind: row.dateCertainty === 'ACTUAL' ? 'RECEIPT' : 'LEGACY_EVIDENCE', fiscalMappingStatus: snapshot.data.adjustments.some(adjustment => adjustment.originalPaymentId === row.id) ? 'UNREVIEWED' : 'UNCHANGED', paymentDateInPeriod: row.paidAt ? inPeriod(row.paidAt) : null };
  });
  const adjustments = snapshot.data.adjustments.map(row => {
    warnings.push({ code: 'PAYMENT_ADJUSTMENTS_UNREVIEWED', recordType: 'paymentAdjustment', recordId: row.id, message: 'Operativer Nachweis ohne fachlich freigegebene Steuer-/EÜR-Zuordnung; betroffene Originalperioden und frühere Auswertungen prüfen.' });
    return { ...row, ...currentAllocation(row.originalPaymentId), periodEffectCents: inPeriod(row.accountingEffectiveOn) ? `-${row.amountCents}` : '0', fiscalMappingStatus: 'UNREVIEWED', signedEffectCents: `-${row.amountCents}`, accountingEffectiveInPeriod: inPeriod(row.accountingEffectiveOn),
      recordedAtInPeriod: inPeriod(row.recordedAt), contextOnly: !inPeriod(row.accountingEffectiveOn) };
  });
  const bindings = snapshot.data.bindings.map(({ bankImportRow, paymentJournalEvent, ...row }) => ({ ...row, rowStableKey: bankImportRow.stableKey, originInvoiceId: paymentJournalEvent.invoiceId, allocatedInvoiceId: currentAllocation(row.paymentJournalEventId).allocatedInvoiceId, cashEffectCents: '0' }));
  const allocationChanges = snapshot.data.allocationChanges.map(row => ({ ...row, movementKind: 'ALLOCATION_CHANGE', cashEffectCents: '0', actionDateInPeriod: inPeriod(row.actionDate), recordedAtInPeriod: inPeriod(row.recordedAt), contextOnly: !inPeriod(row.actionDate) && !inPeriod(row.recordedAt) }));
  const paymentContractVersion = bindings.length || adjustments.some(row => row.contractVersion === 3) ? 3 : 2;
  const manualFinancialRecordEvents = snapshot.data.manualFinancialRecordEvents.map(event => ({ ...event, contextOnly: true, cashEffectCents: '0', manualRecordContractVersion: 1 }));
  const records = { manualRecordContractVersion: 1, manualFinancialRecordEvents, paymentContractVersion, fiscalMappingStatus: adjustments.length ? 'UNREVIEWED' : 'UNCHANGED', company: snapshot.data.company, invoices, expenses, incomes, payments, adjustments, bindings, allocationChanges, cashTransactions, customers: snapshot.data.customers, cashBooks: snapshot.data.cashBooks, originals };
  addEntry('README.txt', Buffer.from(README, 'utf8'), 'metadata');
  addEntry('records.json', Buffer.from(JSON.stringify(records, null, 2), 'utf8'), 'metadata');
  const tables = { manualFinancialRecordEvents, invoices, expenses, incomes, payments, adjustments, bindings, allocationChanges, cashTransactions, customers: snapshot.data.customers, cashBooks: snapshot.data.cashBooks, originals };
  // Fixed schemas also make an empty package useful and machine-readable.
  const headers: Record<keyof typeof tables, string[]> = {
    manualFinancialRecordEvents: ['id', 'recordId', 'kind', 'incomeId', 'expenseId', 'sequence', 'operation', 'mutationId', 'semanticHash', 'previousHash', 'hash', 'snapshot', 'reason', 'createdAt', 'manualRecordContractVersion', 'contextOnly', 'cashEffectCents'],
    adjustments: ['id','invoiceId','originalPaymentId','kind','amountCents','signedEffectCents','currency','actionDate','accountingEffectiveOn','recordedAt','reason','reference','payoutEvidenceIdentity','cancellationInvoiceId','idempotencyKey','semanticFingerprint','contractVersion','originInvoiceId','allocatedInvoiceId','allocationBindingId','allocationRevision','allocationChangeId','allocationBasisSnapshot','periodEffectCents','fiscalMappingStatus','accountingEffectiveInPeriod','recordedAtInPeriod','contextOnly'],
    bindings: ['id','stableKey','rowStableKey','paymentJournalEventId','originInvoiceId','allocatedInvoiceId','idempotencyKey','semanticFingerprint','basisSnapshot','contractVersion','createdAt','cashEffectCents'],
    allocationChanges: ['id','stableKey','bindingId','revision','previousChangeId','fromInvoiceId','toInvoiceId','amountCents','currency','actionDate','reason','idempotencyKey','semanticFingerprint','basisSnapshot','contractVersion','recordedAt','movementKind','cashEffectCents','actionDateInPeriod','recordedAtInPeriod','contextOnly'],
    invoices: ['contextOnly','id', 'type', 'invoiceNumber', 'invoiceDate', 'uploadedAt', 'dueDate', 'status', 'issuanceState', 'paidAt', 'customerId', 'originalInvoiceId', 'cancellationReason', 'currency', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'documentDateSource', 'documentDateInPeriod', 'paymentDateInPeriod', 'originalFileName', 'originalZipPath'],
    expenses: ['manualRecordId','manualRecordState','manualRecordOrigin','manualRecordRevision','id', 'date', 'description', 'category', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'taxRelevant', 'taxDeductiblePercentage', 'depreciationYears', 'paymentDateSource', 'originalFileName', 'originalZipPath', 'purchaseDocumentId', 'originalSha256', 'sourceReviewProvenance'],
    incomes: ['manualRecordId','manualRecordState','manualRecordOrigin','manualRecordRevision','contextOnly','id', 'date', 'description', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'taxRelevant', 'customerId', 'invoiceId', 'originInvoiceId','allocatedInvoiceId','bindingStableKey','allocationRevision', 'periodEffectCents', 'accountingDate', 'accountingDateInPeriod', 'cashRealized', 'invoiceStatus', 'invoicePaidAt', 'paymentJournalEventId', 'paymentDate', 'paymentDateCertainty', 'paymentSource', 'paymentReference'],
    payments: ['contextOnly','originInvoiceId','allocatedInvoiceId','bindingStableKey','allocationRevision','periodEffectCents','movementKind','signedEffectCents','fiscalMappingStatus','id', 'invoiceId', 'incomeId', 'amountCents', 'currency', 'paidAt', 'dateCertainty', 'source', 'reference', 'createdAt', 'paymentDateInPeriod'],
    cashTransactions: ['id', 'date', 'type', 'description', 'currency', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'runningBalance', 'runningBalanceCents', 'runningBalanceRoundingDifferenceCents', 'category', 'receiptNumber', 'taxRelevant', 'cashBookId', 'expenseId', 'incomeId'],
    customers: ['id', 'name', 'address', 'zipCode', 'city', 'taxNumber'], cashBooks: ['id', 'name', 'currency'],
    originals: ['recordType', 'recordId', 'originalFileName', 'status', 'zipPath', 'purchaseDocumentId', 'originalSha256'],
  };
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    const lines = [headers[key].map(accountantCsvCell).join(';')];
    for (const row of tables[key]) lines.push(headers[key].map(field => {
      const value = (row as Record<string, unknown>)[field];
      return accountantCsvCell(value instanceof Date ? value.toISOString() : value && typeof value === 'object' ? JSON.stringify(value) : value);
    }).join(';'));
    addEntry(`${key}.csv`, Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'), 'metadata');
  }
  for (const source of sources) {
    if (await getBackupFileVersion(source.path) !== source.version || await realpath(source.path) !== resolve(source.path)) throw new BackupFileConsistencyError('Ein Original wurde während des Exports verändert. Bitte erneut exportieren.');
  }
  const manifest = {
    format: 'bivaro-accountant-handoff', formatVersion: 2, manualRecordContractVersion: 1, paymentContractVersion, fiscalMappingStatus: adjustments.length ? 'UNREVIEWED' : 'UNCHANGED', generatedAt: snapshot.info.endedAt,
    period: { from: period.from, to: period.to, timezone: 'UTC', inclusive: true },
    scope: { purpose: 'bounded accountant working package', dateSelection: 'See README.txt; document and cash views must not be summed',
      paymentModel: 'v2/v3 immutable-positive-allocations as origin receipts and Income, separate cash-neutral allocation lineage, root-linked never-received corrections and actual current-cancellation refunds; contextOnly cash has zero periodEffectCents; no approved fiscal mapping; Income is not counted again',
      excluded: ['quotes', 'unbooked incoming inbox', 'unrelated master data', 'user accounts', 'passwords', 'API keys', 'SMTP/host settings', 'security/access/change logs', 'customer internal notes'],
      datevCertified: false, elsterSubmission: false, completeAuditExport: false, restorableBackup: false },
    snapshot: snapshot.info, moneyPolicy: MONEY_POLICY_VERSION, limits: ACCOUNTANT_EXPORT_LIMITS,
    counts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
    originalCounts: { included: originals.filter(row => row.status === 'included').length, missing: originals.filter(row => row.status === 'missing').length, notAttached: originals.filter(row => row.status === 'not-attached').length },
    warnings, warningCount: warnings.length, entries: [...entries],
    // Stable across previews; timestamps are deliberately not part of approval.
    sourceFingerprint: hashJson({ period: { from: period.from, to: period.to }, snapshotId: snapshot.info.id, entries, warnings }),
  };
  if (expectedFingerprint && manifest.sourceFingerprint !== expectedFingerprint) {
    throw new AccountantExportError('Daten oder Originale haben sich seit der Vorschau geändert. Bitte die Vorschau erneut prüfen.', 409);
  }
  // Manifest deliberately excludes itself from its hash list; its bytes still count against limits.
  addEntry('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'metadata');
  const bytes = zip ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }) : null;
  return { manifest, bytes, filename: `bivaro-uebergabepaket-${period.from}-${period.to}.zip`, warningCount: warnings.length, counts: manifest.counts };
}

export async function createAccountantExport(userId: string, period: AccountantExportPeriod, expectedFingerprint?: string) {
  const result = await buildAccountantExport(userId, period, false, expectedFingerprint);
  return { ...result, bytes: result.bytes! };
}

export async function previewAccountantExport(userId: string, period: AccountantExportPeriod) {
  const { bytes: _bytes, ...result } = await buildAccountantExport(userId, period, true);
  return result;
}
