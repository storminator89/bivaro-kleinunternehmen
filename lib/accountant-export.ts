import { Prisma } from '@prisma/client';
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
import { isSafeLegacyFileName, isSafeStoredFileName } from '@/lib/upload-path';

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
type OriginalReference = { recordType: 'invoice' | 'expense'; recordId: number; originalFileName: string | null; status: 'included' | 'missing' | 'not-attached'; zipPath: string | null };

const invoiceSelect = {
  id: true, type: true, fileName: true, storedFileName: true, invoiceDate: true, uploadedAt: true,
  dueDate: true, invoiceNumber: true, totalAmount: true, status: true, issuanceState: true,
  paidAt: true, customerId: true, originalInvoiceId: true, cancellationReason: true,
} satisfies Prisma.InvoiceSelect;

const TEXT_COLUMNS = {
  Expense: ['description', 'category', 'receiptFileName', 'storedReceiptFileName'],
  Income: ['description'],
  Invoice: ['type', 'fileName', 'storedFileName', 'invoiceNumber', 'status', 'issuanceState', 'cancellationReason'],
  CashTransaction: ['type', 'description', 'category', 'receiptNumber'],
  Customer: ['name', 'address', 'zipCode', 'city', 'taxNumber'],
  CashBook: ['name', 'currency'],
  Settings: ['companyName', 'companyAddress', 'taxNumber'],
} as const;

/** SQLite byte aggregates avoid loading arbitrarily large allowed free-text fields.
 * Identifiers come exclusively from the closed allowlist above; values stay bound.
 */
async function reserveSourceText(tx: Prisma.TransactionClient, userId: string, table: keyof typeof TEXT_COLUMNS, ids: number[] | null, budget: { bytes: number }) {
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
      { income: incomeWhere },
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
    await reserveSourceText(tx, userId, 'Settings', null, textBudget);
    const [expenses, incomes, invoices, cashTransactions, company] = await Promise.all([
      tx.expense.findMany({ where: expenseWhere, orderBy: { id: 'asc' }, select: {
        id: true, description: true, amount: true, date: true, category: true, taxRelevant: true,
        taxDeductiblePercentage: true, depreciationYears: true, receiptFileName: true, storedReceiptFileName: true,
      } }),
      tx.income.findMany({ where: incomeWhere, orderBy: { id: 'asc' }, select: {
        id: true, description: true, amount: true, date: true, customerId: true, invoiceId: true, taxRelevant: true,
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
    return { company, expenses, incomes, invoices, cashTransactions, customers, cashBooks };
  });
  const endedAt = new Date().toISOString();
  return { data, info: { id: hashJson(data), startedAt, endedAt, consistency: 'single-read-transaction' as const } };
}

const README = `Bivaro – Übergabepaket an die Steuerberatung (Format 1)
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
Vollzahlungsmodell: eine Rechnung hat derzeit höchstens eine volle Einnahme und paidAt;
keine Teilzahlungszuordnung/Bankabstimmung, kein eigenständiges Erstattungsjournal. Storno ist keine Rückzahlung.
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
  const entries: { zipPath: string; bytes: number; sha256: string; kind: 'original' | 'metadata' }[] = [];
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
  const addOriginal = async (recordType: 'invoice' | 'expense', recordId: number, storedName: string | null, originalFileName: string | null) => {
    const ref: OriginalReference = { recordType, recordId, originalFileName, status: 'missing', zipPath: null };
    originals.push(ref);
    if (!storedName && recordType === 'expense') {
      ref.status = 'not-attached';
      warnings.push({ code: 'ORIGINAL_NOT_ATTACHED', recordType, recordId, message: 'Kein Originalbeleg an der Ausgabe hinterlegt.' });
      return;
    }
    if (storedName && (isSafeStoredFileName(storedName) || isSafeLegacyFileName(storedName))) {
      const filePath = await findOwnedUploadedFile(userId, storedName);
      if (filePath) {
        try {
          // The shared resolver checks tenant/legacy ownership and lexical paths;
          // additionally reject filesystem symlinks (including parent directories).
          if (await realpath(filePath) !== resolve(filePath) || !(await lstat(filePath)).isFile()) {
            throw new Error('Unsafe original path');
          }
          const stable = await readStableBackupFile(filePath, Math.min(ACCOUNTANT_EXPORT_LIMITS.maxFileBytes, ACCOUNTANT_EXPORT_LIMITS.maxTotalBytes - totalBytes));
          if (stable) {
            const extension = storedName.match(/\.([a-zA-Z0-9]{1,16})$/u)?.[1].toLowerCase() ?? 'bin';
            const zipPath = `originals/${recordType}-${recordId}.${extension}`;
            addEntry(zipPath, stable.bytes, 'original');
            ref.status = 'included'; ref.zipPath = zipPath;
            sources.push({ path: filePath, version: stable.sourceVersion });
            return;
          }
        } catch (error) {
          if (error instanceof BackupFileSizeError) throw new AccountantExportError('Ein Original oder das Paket überschreitet das Größenlimit. Bitte Zeitraum verkürzen.', 413);
          if (error instanceof BackupFileConsistencyError || error instanceof AccountantExportError) throw error;
          // Do not leak private paths or resolver details into the handoff.
        }
      }
    }
    warnings.push({ code: 'ORIGINAL_MISSING', recordType, recordId, message: 'Referenziertes Original fehlt, ist nicht lesbar oder nicht sicher diesem Mandanten zugeordnet.' });
  };
  for (const row of snapshot.data.invoices) await addOriginal('invoice', row.id, row.storedFileName, row.fileName);
  for (const row of snapshot.data.expenses) await addOriginal('expense', row.id, row.storedReceiptFileName, row.receiptFileName);

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
      documentDateInPeriod: inPeriod(row.invoiceDate ?? row.uploadedAt), paymentDateInPeriod: row.paidAt ? inPeriod(row.paidAt) : false,
      ...money(totalAmount, 'invoice', row.id), originalZipPath: originalByRecord.get(`invoice:${row.id}`)?.zipPath ?? null };
  });
  const expenses = snapshot.data.expenses.map(row => {
    const { storedReceiptFileName: _stored, receiptFileName: originalFileName, amount, ...rest } = row;
    return { ...rest, ...money(amount, 'expense', row.id), paymentDateSource: 'expense.date (stored booking/outflow date)', originalFileName,
      originalZipPath: originalByRecord.get(`expense:${row.id}`)?.zipPath ?? null };
  });
  const incomes = snapshot.data.incomes.map(row => {
    const invoice = row.invoiceId ? invoiceById.get(row.invoiceId) ?? null : null;
    checkRef(row.customerId, customers, 'income', row.id, 'customerId');
    checkRef(row.invoiceId, invoiceIds, 'income', row.id, 'invoiceId');
    const accountingDate = getIncomeAccountingDate({ ...row, invoice });
    return { ...row, ...money(row.amount, 'income', row.id), accountingDate: formatBusinessDate(accountingDate),
      accountingDateInPeriod: inPeriod(accountingDate), cashRealized: row.invoiceId != null && !invoice ? null : isCashRealizedIncome({ ...row, invoice }),
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
  const records = { company: snapshot.data.company, invoices, expenses, incomes, cashTransactions, customers: snapshot.data.customers, cashBooks: snapshot.data.cashBooks, originals };
  addEntry('README.txt', Buffer.from(README, 'utf8'), 'metadata');
  addEntry('records.json', Buffer.from(JSON.stringify(records, null, 2), 'utf8'), 'metadata');
  const tables = { invoices, expenses, incomes, cashTransactions, customers: snapshot.data.customers, cashBooks: snapshot.data.cashBooks, originals };
  // Fixed schemas also make an empty package useful and machine-readable.
  const headers: Record<keyof typeof tables, string[]> = {
    invoices: ['id', 'type', 'invoiceNumber', 'invoiceDate', 'uploadedAt', 'dueDate', 'status', 'issuanceState', 'paidAt', 'customerId', 'originalInvoiceId', 'cancellationReason', 'currency', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'documentDateSource', 'documentDateInPeriod', 'paymentDateInPeriod', 'originalFileName', 'originalZipPath'],
    expenses: ['id', 'date', 'description', 'category', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'taxRelevant', 'taxDeductiblePercentage', 'depreciationYears', 'paymentDateSource', 'originalFileName', 'originalZipPath'],
    incomes: ['id', 'date', 'description', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'taxRelevant', 'customerId', 'invoiceId', 'accountingDate', 'accountingDateInPeriod', 'cashRealized', 'invoiceStatus', 'invoicePaidAt'],
    cashTransactions: ['id', 'date', 'type', 'description', 'currency', 'amount', 'amountCents', 'amountRoundingDifferenceCents', 'runningBalance', 'runningBalanceCents', 'runningBalanceRoundingDifferenceCents', 'category', 'receiptNumber', 'taxRelevant', 'cashBookId', 'expenseId', 'incomeId'],
    customers: ['id', 'name', 'address', 'zipCode', 'city', 'taxNumber'], cashBooks: ['id', 'name', 'currency'],
    originals: ['recordType', 'recordId', 'originalFileName', 'status', 'zipPath'],
  };
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    const lines = [headers[key].map(accountantCsvCell).join(';')];
    for (const row of tables[key]) lines.push(headers[key].map(field => {
      const value = (row as Record<string, unknown>)[field];
      return accountantCsvCell(value instanceof Date ? value.toISOString() : value);
    }).join(';'));
    addEntry(`${key}.csv`, Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'), 'metadata');
  }
  for (const source of sources) {
    if (await getBackupFileVersion(source.path) !== source.version || await realpath(source.path) !== resolve(source.path)) throw new BackupFileConsistencyError('Ein Original wurde während des Exports verändert. Bitte erneut exportieren.');
  }
  const manifest = {
    format: 'bivaro-accountant-handoff', formatVersion: 1, generatedAt: snapshot.info.endedAt,
    period: { from: period.from, to: period.to, timezone: 'UTC', inclusive: true },
    scope: { purpose: 'bounded accountant working package', dateSelection: 'See README.txt; document and cash views must not be summed',
      paymentModel: 'single-full-payment-per-invoice; no partial-payment allocation or refund journal',
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
