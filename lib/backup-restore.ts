import { formatMoneyEUR, parseMoneyEUR } from '@/lib/money';
import { EMPTY_FISCAL_PROFILE, validateFiscalProfileInput } from '@/lib/fiscal-profile';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { readFile } from 'fs/promises';
import { readPurchaseOriginal } from '@/lib/purchase-documents/original';
import { getBackupFileVersion } from '@/lib/backup-snapshot';
import { MAX_INVOICE_UPLOAD_BYTES, MAX_XML_INPUT_BYTES } from '@/lib/resource-limits';
import { CashbookError, recalculateCashBalances } from '@/lib/cashbook-service';
import { documentNumberPrefix, maximumDocumentSequence, type DocumentType } from '@/lib/invoice-numbers';
import { validateRecurringValues } from '@/lib/recurring-schedule';
import {
  CURRENT_BACKUP_VERSION,
  LEGACY_BACKUP_VERSION,
  manifestWarning,
  hashBytes,
  hashJson,
  redactAuditLog,
  validateBackupManifest,
  type BackupManifest,
} from '@/lib/backup-manifest';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import {
  deleteTenantFile,
  createTenantStoredName,
  getTenantUploadPath,
  isSafeLegacyFileName,
  isSafeStoredFileName,
  writeTenantFile,
} from '@/lib/upload-path';

type JsonRecord = Record<string, unknown>;
type FileKind = 'invoice' | 'receipt' | 'logo' | 'purchase-document';
// Optional legacy dates need a stable value so dry-run ordering and persisted
// ordering cannot diverge while importing the same source graph.
const RESTORE_DEFAULT_DATE = new Date(0);

export type RestoreFileResolver = (
  kind: FileKind,
  sourceName: string,
) => Promise<Uint8Array | null>;

export class BackupValidationError extends Error {
  readonly status = 400;
  readonly issues: readonly BackupValidationIssue[];
  readonly truncated: boolean;

  constructor(message: string, issues: readonly BackupValidationIssue[] = [], truncated = false) {
    super(message);
    this.name = 'BackupValidationError';
    this.issues = issues;
    this.truncated = truncated;
  }
}

/** A safe, bounded validation finding suitable for API responses and UI. */
export type BackupValidationIssue = { path: string; message: string };

export const MAX_BACKUP_VALIDATION_ISSUES = 25;

type RestoreOptions = {
  userId: string;
  backup: unknown;
  overwrite: boolean;
  /** Full ZIP restore supplies this. JSON restore intentionally does not. */
  resolveFile?: RestoreFileResolver;
};

type RestoreResult = {
  overwriteMode: boolean;
  deleted?: string;
  customers: { imported: number; skipped: number };
  suppliers: { imported: number; skipped: number };
  billingNotes: { imported: number; skipped: number };
  expenses: { imported: number; skipped: number };
  incomes: { imported: number; skipped: number };
  paymentJournalEvents: { imported: number; skipped: number };
  invoices: { imported: number; skipped: number };
  purchaseDocuments: { imported: number; skipped: number };
  templates: { imported: number; skipped: number };
  files: { imported: number; skipped: number };
  settings: { imported: boolean };
  recurringExpenses: { imported: number; skipped: number };
  reminders: { imported: number; skipped: number };
  cashBooks: { imported: number; skipped: number };
  cashTransactions: { imported: number; skipped: number };
  documentations: { imported: number; skipped: number };
  auditLogs: { imported: number; skipped: number };
  invoiceNumberCounters: { imported: number; skipped: number };
  warnings: string[];
};

type ValidatedBackup = {
  version: string;
  data: JsonRecord;
  manifest?: BackupManifest;
  warnings: string[];
};

const ARRAY_KEYS = [
  'customers', 'suppliers', 'expenses', 'incomes', 'paymentJournalEvents', 'invoices', 'purchaseDocuments', 'templates',
  'billingNotes', 'recurringExpenses', 'reminders', 'cashBooks', 'cashTransactions',
  'documentations', 'apiKeys', 'auditLogs',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new BackupValidationError(`${label} muss ein Objekt sein`);
  return value;
}

function asArray(data: JsonRecord, key: string): JsonRecord[] {
  const value = data[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BackupValidationError(`${key} muss ein Array sein`);
  return value.map((item, index) => asRecord(item, `${key}[${index}]`));
}

function asOptionalString(value: unknown, label: string, maxLength = 10_000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new BackupValidationError(`${label} ist ungültig`);
  }
  return value;
}

function asRequiredString(value: unknown, label: string, maxLength = 10_000): string {
  const result = asOptionalString(value, label, maxLength);
  if (!result) throw new BackupValidationError(`${label} fehlt`);
  return result;
}

function asOptionalInt(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new BackupValidationError(`${label} ist ungültig`);
  return result;
}

function asOptionalFinite(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) throw new BackupValidationError(`${label} ist ungültig`);
  return result;
}

function asBillingQuantity(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) {
    throw new BackupValidationError(`${label} ist ungültig`);
  }
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result <= 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new BackupValidationError(`${label} muss eine endliche Zahl größer als 0 sein`);
  }
  return result;
}

function asBusinessDate(value: unknown, label: string): Date {
  const result = asDate(value, label);
  if (!result) throw new BackupValidationError(`${label} fehlt`);
  if (result.getUTCHours() !== 0 || result.getUTCMinutes() !== 0 || result.getUTCSeconds() !== 0 || result.getUTCMilliseconds() !== 0) {
    throw new BackupValidationError(`${label} muss auf UTC-Mitternacht liegen`);
  }
  return result;
}

function asDate(value: unknown, label: string, fallback: Date | null = null): Date | null {
  if (value === undefined || value === null || value === '') return fallback;
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new BackupValidationError(`${label} ist ungültig`);
  return result;
}

function asOptionalBoolean(value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw new BackupValidationError(`${label} ist ungültig`);
  return value;
}

function asJson(value: unknown, label: string): Prisma.InputJsonValue {
  if (value === undefined || value === null) return {};
  try {
    JSON.stringify(value);
  } catch {
    throw new BackupValidationError(`${label} ist kein gültiges JSON`);
  }
  return value as Prisma.InputJsonValue;
}

function validateStoredName(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!(isSafeStoredFileName(value) || isSafeLegacyFileName(value))) {
    throw new BackupValidationError(`${label} enthält eine unzulässige Dateireferenz`);
  }
  return value;
}

function validateIds(records: JsonRecord[], key: string): Set<number> {
  const ids = new Set<number>();
  for (const [index, record] of records.entries()) {
    const id = asOptionalInt(record.id, `${key}[${index}].id`);
    if (id === null || id <= 0 || ids.has(id)) {
      const path = `${key}[${index}].id`;
      throw new BackupValidationError(`${key} enthält doppelte oder ungültige IDs`, [{ path, message: 'Die Objekt-ID fehlt, ist ungültig oder doppelt.' }]);
    }
    ids.add(id);
  }
  return ids;
}

function validateDateFields(records: JsonRecord[], key: string, fields: string[]): void {
  records.forEach((record, index) => {
    fields.forEach((field) => { asDate(record[field], `${key}[${index}].${field}`); });
  });
}

function validateBackupReferences(data: JsonRecord, sets: Record<string, Set<number>>): void {
  const check = (value: unknown, target: string, label: string) => {
    const id = asOptionalInt(value, label);
    if (id !== null && !sets[target].has(id)) {
      throw new BackupValidationError(`${label} verweist auf einen unbekannten Datensatz`);
    }
  };

  for (const [index, invoice] of asArray(data, 'invoices').entries()) {
    check(invoice.customerId, 'customers', `invoices[${index}].customerId`);
    check(invoice.originalInvoiceId, 'invoices', `invoices[${index}].originalInvoiceId`);
    check(invoice.convertedFromQuoteId, 'invoices', `invoices[${index}].convertedFromQuoteId`);
  }
  for (const [index, income] of asArray(data, 'incomes').entries()) {
    check(income.customerId, 'customers', `incomes[${index}].customerId`);
    check(income.invoiceId, 'invoices', `incomes[${index}].invoiceId`);
  }
  for (const [index, expense] of asArray(data, 'expenses').entries()) {
    check(expense.recurringExpenseId, 'recurringExpenses', `expenses[${index}].recurringExpenseId`);
  }
  for (const [index, recurring] of asArray(data, 'recurringExpenses').entries()) {
    asRequiredString(recurring.description, `recurringExpenses[${index}].description`, 255);
    asOptionalFinite(recurring.amount, `recurringExpenses[${index}].amount`);
  }
  for (const [index, reminder] of asArray(data, 'reminders').entries()) {
    check(reminder.invoiceId, 'invoices', `reminders[${index}].invoiceId`);
  }
  for (const [index, transaction] of asArray(data, 'cashTransactions').entries()) {
    check(transaction.cashBookId, 'cashBooks', `cashTransactions[${index}].cashBookId`);
    check(transaction.expenseId, 'expenses', `cashTransactions[${index}].expenseId`);
    check(transaction.incomeId, 'incomes', `cashTransactions[${index}].incomeId`);
  }

  for (const [index, note] of asArray(data, 'billingNotes').entries()) {
    check(note.customerId, 'customers', `billingNotes[${index}].customerId`);
    check(note.invoiceId, 'invoices', `billingNotes[${index}].invoiceId`);
    const customerId = asOptionalInt(note.customerId, `billingNotes[${index}].customerId`);
    if (customerId === null) throw new BackupValidationError(`billingNotes[${index}].customerId fehlt`);
    const invoiceId = asOptionalInt(note.invoiceId, `billingNotes[${index}].invoiceId`);
    if (customerId !== null && invoiceId !== null) {
      const invoice = asArray(data, 'invoices').find((candidate) => asOptionalInt(candidate.id, 'invoice.id') === invoiceId);
      const invoiceCustomerId = invoice ? asOptionalInt(invoice.customerId, `invoices[?].customerId`) : null;
      if (invoiceCustomerId !== customerId) {
        throw new BackupValidationError(`billingNotes[${index}].invoiceId muss zur angegebenen Kunden-ID gehören`);
      }
      if (invoice?.type !== undefined && invoice.type !== 'INVOICE') {
        throw new BackupValidationError(`billingNotes[${index}].invoiceId muss eine Rechnung referenzieren`);
      }
    }
  }
}

type RestoreInvariantValidation = {
  issues: BackupValidationIssue[];
  truncated: boolean;
};

function addInvariantIssue(state: RestoreInvariantValidation, path: string, message: string): void {
  if (state.issues.length < MAX_BACKUP_VALIDATION_ISSUES) state.issues.push({ path, message });
  else state.truncated = true;
}

function centsForRestore(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round((amount + Number.EPSILON) * 100))) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

function sameBusinessDateForRestore(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function restoreCashTransactionOrder(
  left: { transaction: JsonRecord; index: number },
  right: { transaction: JsonRecord; index: number },
): number {
  const leftDate = asDate(left.transaction.date, `cashTransactions[${left.index}].date`, RESTORE_DEFAULT_DATE)?.getTime() ?? 0;
  const rightDate = asDate(right.transaction.date, `cashTransactions[${right.index}].date`, RESTORE_DEFAULT_DATE)?.getTime() ?? 0;
  if (leftDate !== rightDate) return leftDate - rightDate;
  const leftCreated = asDate(left.transaction.createdAt, `cashTransactions[${left.index}].createdAt`, RESTORE_DEFAULT_DATE)?.getTime() ?? 0;
  const rightCreated = asDate(right.transaction.createdAt, `cashTransactions[${right.index}].createdAt`, RESTORE_DEFAULT_DATE)?.getTime() ?? 0;
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  const leftId = asOptionalInt(left.transaction.id, `cashTransactions[${left.index}].id`) ?? 0;
  const rightId = asOptionalInt(right.transaction.id, `cashTransactions[${right.index}].id`) ?? 0;
  return leftId - rightId || left.index - right.index;
}

/**
 * Domain checks shared by dry-run and the committing restore. They operate on
 * the source graph, before target IDs or database rows exist.
 */
function validateRestoreInvariants(
  data: JsonRecord,
  state: RestoreInvariantValidation,
): void {
  const invoices = asArray(data, 'invoices');
  const incomes = asArray(data, 'incomes');
  const invoiceById = new Map<number, { totalAmount: number | null; status: string }>();
  for (const [index, invoice] of invoices.entries()) {
    const id = asOptionalInt(invoice.id, `invoices[${index}].id`);
    const status = asOptionalString(invoice.status, `invoices[${index}].status`, 32) ?? 'DRAFT';
    const totalAmount = asOptionalFinite(invoice.totalAmount, `invoices[${index}].totalAmount`);
    if (status === 'PAID' && (totalAmount === null || (centsForRestore(totalAmount) ?? -1) < 0)) {
      addInvariantIssue(state, `invoices[${index}].totalAmount`, 'Eine bezahlte Rechnung benötigt einen gültigen nichtnegativen Betrag.');
    }
    if (id === null) continue;
    invoiceById.set(id, { totalAmount, status });
  }
  const incomeByInvoice = new Map<number, number>();
  for (const [index, income] of incomes.entries()) {
    const invoiceId = asOptionalInt(income.invoiceId, `incomes[${index}].invoiceId`);
    if (invoiceId === null) continue;
    if (incomeByInvoice.has(invoiceId)) {
      addInvariantIssue(state, `incomes[${index}].invoiceId`, 'Eine Rechnung darf nur eine Einnahme haben.');
      continue;
    }
    incomeByInvoice.set(invoiceId, index);
    const invoice = invoiceById.get(invoiceId);
    if (!invoice || invoice.status !== 'PAID' || invoice.totalAmount === null) continue;
    const incomeAmount = asOptionalFinite(income.amount, `incomes[${index}].amount`);
    const invoiceCents = centsForRestore(invoice.totalAmount);
    const incomeCents = centsForRestore(incomeAmount);
    if (invoiceCents === null || incomeCents === null || invoiceCents !== incomeCents) {
      addInvariantIssue(state, `incomes[${index}].amount`, 'Der Betrag der Einnahme stimmt nicht mit dem Betrag der bezahlten Rechnung überein.');
    }
  }

  const recurringExpenses = asArray(data, 'recurringExpenses');
  for (const [index, recurring] of recurringExpenses.entries()) {
    const error = validateRecurringValues({
      amount: recurring.amount,
      interval: recurring.interval,
      dayOfMonth: recurring.dayOfMonth,
      taxDeductiblePercentage: recurring.taxDeductiblePercentage,
      startDate: recurring.startDate,
      endDate: recurring.endDate,
      taxRelevant: recurring.taxRelevant,
      isActive: recurring.isActive,
    });
    if (!error) continue;
    const path = error.includes('Intervall')
      ? `recurringExpenses[${index}].interval`
      : error.includes('Monatstag')
        ? `recurringExpenses[${index}].dayOfMonth`
        : error.includes('Zeitraum')
          ? `recurringExpenses[${index}].endDate`
          : `recurringExpenses[${index}]`;
    addInvariantIssue(state, path, 'Die wiederkehrende Ausgabe verletzt die Buchungsregel.');
  }

  const cashBooks = asArray(data, 'cashBooks');
  const cashTransactions = asArray(data, 'cashTransactions');
  const cashBookById = new Map<number, { initialBalance: number }>();
  for (const [index, book] of cashBooks.entries()) {
    const id = asOptionalInt(book.id, `cashBooks[${index}].id`);
    const initialBalance = asOptionalFinite(book.initialBalance, `cashBooks[${index}].initialBalance`) ?? 0;
    if (id !== null) cashBookById.set(id, { initialBalance });
    const cents = centsForRestore(initialBalance);
    if (cents === null || initialBalance < 0 || cents < 0) {
      addInvariantIssue(state, `cashBooks[${index}].initialBalance`, 'Der Kassenanfangsbestand darf nicht negativ oder unberechenbar sein.');
    }
  }
  const incomesById = new Map<number, { amount: number | null; date: Date | null }>();
  for (const [index, income] of incomes.entries()) {
    const id = asOptionalInt(income.id, `incomes[${index}].id`);
    if (id !== null) incomesById.set(id, {
      amount: asOptionalFinite(income.amount, `incomes[${index}].amount`),
      date: asDate(income.date, `incomes[${index}].date`, RESTORE_DEFAULT_DATE),
    });
  }
  const expensesById = new Map<number, { amount: number | null; date: Date | null }>();
  for (const [index, expense] of asArray(data, 'expenses').entries()) {
    const id = asOptionalInt(expense.id, `expenses[${index}].id`);
    if (id !== null) expensesById.set(id, {
      amount: asOptionalFinite(expense.amount, `expenses[${index}].amount`),
      date: asDate(expense.date, `expenses[${index}].date`, RESTORE_DEFAULT_DATE),
    });
  }
  const transactionsByBook = new Map<number, Array<{ index: number; transaction: JsonRecord }>>();
  const linkedIncomeTransactions = new Map<number, number>();
  const linkedExpenseTransactions = new Map<number, number>();
  for (const [index, transaction] of cashTransactions.entries()) {
    const bookId = asOptionalInt(transaction.cashBookId, `cashTransactions[${index}].cashBookId`);
    const type = asOptionalString(transaction.type, `cashTransactions[${index}].type`, 32);
    const amount = asOptionalFinite(transaction.amount, `cashTransactions[${index}].amount`);
    const date = asDate(transaction.date, `cashTransactions[${index}].date`, RESTORE_DEFAULT_DATE);
    if (bookId === null || !cashBookById.has(bookId)) continue;
    if (transaction.date === undefined || transaction.date === null || transaction.date === '') {
      addInvariantIssue(state, `cashTransactions[${index}].date`, 'Eine Kassenbuchung benötigt ein fachliches Buchungsdatum.');
    }
    if (!['EINNAHME', 'AUSGABE'].includes(type ?? '') || centsForRestore(amount) === null || (centsForRestore(amount) ?? 0) <= 0) {
      addInvariantIssue(state, `cashTransactions[${index}]`, 'Die Kassenbuchung hat keinen gültigen Typ oder positiven Centbetrag.');
    }
    const incomeId = asOptionalInt(transaction.incomeId, `cashTransactions[${index}].incomeId`);
    const expenseId = asOptionalInt(transaction.expenseId, `cashTransactions[${index}].expenseId`);
    if (incomeId !== null) {
      if (linkedIncomeTransactions.has(incomeId)) {
        addInvariantIssue(state, `cashTransactions[${index}].incomeId`, 'Eine Einnahme darf nur mit einer Kassenbuchung verknüpft sein.');
      }
      linkedIncomeTransactions.set(incomeId, index);
      const income = incomesById.get(incomeId);
      if (type !== 'EINNAHME' || !income || centsForRestore(amount) !== centsForRestore(income.amount) || !date || !income.date || !sameBusinessDateForRestore(date, income.date)) {
        addInvariantIssue(state, `cashTransactions[${index}]`, 'Die Kassenbuchung stimmt nicht mit der verknüpften Einnahme überein.');
      }
    }
    if (expenseId !== null) {
      if (linkedExpenseTransactions.has(expenseId)) {
        addInvariantIssue(state, `cashTransactions[${index}].expenseId`, 'Eine Ausgabe darf nur mit einer Kassenbuchung verknüpft sein.');
      }
      linkedExpenseTransactions.set(expenseId, index);
      const expense = expensesById.get(expenseId);
      if (type !== 'AUSGABE' || !expense || centsForRestore(amount) !== centsForRestore(expense.amount) || !date || !expense.date || !sameBusinessDateForRestore(date, expense.date)) {
        addInvariantIssue(state, `cashTransactions[${index}]`, 'Die Kassenbuchung stimmt nicht mit der verknüpften Ausgabe überein.');
      }
    }
    const entries = transactionsByBook.get(bookId) ?? [];
    entries.push({ index, transaction });
    transactionsByBook.set(bookId, entries);
  }
  for (const [bookId, entries] of transactionsByBook.entries()) {
    const book = cashBookById.get(bookId)!;
    let balance = centsForRestore(book.initialBalance) ?? 0;
    entries.sort(restoreCashTransactionOrder);
    for (const entry of entries) {
      const amount = centsForRestore(entry.transaction.amount);
      if (amount === null || amount <= 0) continue;
      balance += entry.transaction.type === 'EINNAHME' ? amount : -amount;
      if (!Number.isSafeInteger(balance)) {
        addInvariantIssue(state, `cashTransactions[${entry.index}].runningBalance`, 'Der Kassenbestand überschreitet den sicher berechenbaren Bereich.');
        break;
      }
      if (balance < 0) {
        addInvariantIssue(state, `cashTransactions[${entry.index}].runningBalance`, 'Die chronologische Kassenbuchung erzeugt einen negativen Kassenbestand.');
        // One issue per book is enough; subsequent entries cannot add useful
        // information and this keeps malformed input bounded.
        break;
      }
    }
  }
}

/** No payment date/Income is inferred while restoring immutable evidence. */
function paymentEventValues(event: JsonRecord, label: string) {
  const amountCents = asRequiredString(event.amountCents, `${label}.amountCents`, 16);
  if (!/^[1-9][0-9]*$/u.test(amountCents) || BigInt(amountCents) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BackupValidationError(`${label}.amountCents muss ein positiver exakter Centbetrag sein`);
  }
  if (parseMoneyEUR(Number(formatMoneyEUR(BigInt(amountCents)))).toString() !== amountCents) {
    throw new BackupValidationError(`${label}.amountCents kann nicht verlustfrei mit der bestehenden Einnahme verknüpft werden`);
  }
  if (event.currency !== 'EUR') throw new BackupValidationError(`${label}.currency muss EUR sein`);
  const source = asRequiredString(event.source, `${label}.source`, 32);
  const dateCertainty = asRequiredString(event.dateCertainty, `${label}.dateCertainty`, 32);
  if (!['MANUAL', 'LEGACY_STATUS', 'LEGACY_IMPORT'].includes(source)
    || !['ACTUAL', 'LEGACY_INCOME', 'LEGACY_INVOICE', 'UNKNOWN'].includes(dateCertainty)) {
    throw new BackupValidationError(`${label}: Zahlungsquelle oder Datumsnachweis ist ungültig`);
  }
  const strictDate = (value: unknown, name: string, required: boolean) => {
    if (value === null || value === undefined) {
      if (required) throw new BackupValidationError(`${name} fehlt`);
      return null;
    }
    if (!(value instanceof Date) && typeof value !== 'string') throw new BackupValidationError(`${name} ist ungültig`);
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime()) || (typeof value === 'string' && date.toISOString() !== value)) {
      throw new BackupValidationError(`${name} muss ein vollständiges UTC-ISO-Datum sein`);
    }
    return date;
  };
  const paidAt = strictDate(event.paidAt, `${label}.paidAt`, dateCertainty !== 'UNKNOWN');
  const createdAt = strictDate(event.createdAt, `${label}.createdAt`, true)!;
  if ((dateCertainty === 'UNKNOWN' && paidAt !== null)
    || (source !== 'LEGACY_IMPORT' && dateCertainty !== 'ACTUAL')
    || (source === 'LEGACY_IMPORT' && dateCertainty === 'ACTUAL')) {
    throw new BackupValidationError(`${label}: Zahlungsdatum und Herkunft widersprechen sich`);
  }
  return {
    amountCents, currency: 'EUR', source, dateCertainty, paidAt, createdAt,
    reference: asRequiredString(event.reference, `${label}.reference`, 255),
    idempotencyKey: asRequiredString(event.idempotencyKey, `${label}.idempotencyKey`, 128),
  };
}

function validatePaymentJournalBackup(data: JsonRecord, version: string): void {
  const events = asArray(data, 'paymentJournalEvents');
  if (version === LEGACY_BACKUP_VERSION && events.length) {
    throw new BackupValidationError('Legacy-Backups ohne Manifest dürfen keine Zahlungsereignisse enthalten');
  }
  const invoices = new Map(asArray(data, 'invoices').map((row) => [asOptionalInt(row.id, 'invoice.id'), row]));
  const incomes = new Map(asArray(data, 'incomes').map((row) => [asOptionalInt(row.id, 'income.id'), row]));
  const invoiceIds = new Set<number>();
  const incomeIds = new Set<number>();
  const keys = new Set<string>();
  for (const [index, event] of events.entries()) {
    const label = `paymentJournalEvents[${index}]`;
    const values = paymentEventValues(event, label);
    const invoiceId = asOptionalInt(event.invoiceId, `${label}.invoiceId`);
    const incomeId = asOptionalInt(event.incomeId, `${label}.incomeId`);
    const invoice = invoiceId === null ? undefined : invoices.get(invoiceId);
    const income = incomeId === null ? undefined : incomes.get(incomeId);
    const invoiceIncome = [...incomes.values()].find((row) => asOptionalInt(row.invoiceId, 'income.invoiceId') === invoiceId);
    if (invoiceIncome && asOptionalInt(invoiceIncome.id, 'income.id') !== incomeId) {
      throw new BackupValidationError(`${label}: vorhandene Rechnungseinnahme muss mit dem Zahlungsereignis verknüpft sein`);
    }
    if (!invoice || invoiceId === null || invoiceIds.has(invoiceId) || keys.has(values.idempotencyKey)) {
      throw new BackupValidationError(`${label}: Rechnungsbezug oder Idempotenzschlüssel fehlt oder ist doppelt`);
    }
    invoiceIds.add(invoiceId);
    keys.add(values.idempotencyKey);
    if (invoice.type !== 'INVOICE' || !['PAID', 'CANCELLED'].includes(String(invoice.status))) {
      throw new BackupValidationError(`${label}: Zahlungsereignis erfordert eine bezahlte oder stornierte Rechnung`);
    }
    try {
      if (parseMoneyEUR(asOptionalFinite(invoice.totalAmount, 'invoice.totalAmount') ?? NaN).toString() !== values.amountCents) throw new Error('amount');
      if (income && parseMoneyEUR(asOptionalFinite(income.amount, 'income.amount') ?? NaN).toString() !== values.amountCents) throw new Error('amount');
    } catch { throw new BackupValidationError(`${label}: Zahlungsbetrag stimmt nicht mit Rechnung/Einnahme überein`); }
    const parsed = isRecord(invoice.parsedData) ? invoice.parsedData : {};
    if (parsed.currency !== undefined && parsed.currency !== null && parsed.currency !== 'EUR') {
      throw new BackupValidationError(`${label}: Fremdwährungszahlungen werden nicht unterstützt`);
    }
    if (incomeId !== null && (!income || incomeIds.has(incomeId) || asOptionalInt(income.invoiceId, 'income.invoiceId') !== invoiceId)) {
      throw new BackupValidationError(`${label}: Einnahmebezug fehlt, ist doppelt oder gehört zu einer anderen Rechnung`);
    }
    if (incomeId !== null) incomeIds.add(incomeId);
    if ((values.source !== 'LEGACY_IMPORT' && !income)
      || (values.dateCertainty === 'UNKNOWN' && income)
      || (values.dateCertainty === 'LEGACY_INCOME' && !income)) {
      throw new BackupValidationError(`${label}: Einnahme und historischer Datumsnachweis widersprechen sich`);
    }
    if (income && asDate(income.date, 'income.date')?.getTime() !== values.paidAt?.getTime()) {
      throw new BackupValidationError(`${label}: Zahlungsdatum stimmt nicht mit der verknüpften Einnahme überein`);
    }
    if ((values.dateCertainty === 'ACTUAL' || values.dateCertainty === 'LEGACY_INVOICE')
      && asDate(invoice.paidAt, 'invoice.paidAt')?.getTime() !== values.paidAt?.getTime()) {
      throw new BackupValidationError(`${label}: Zahlungsdatum stimmt nicht mit dem Rechnungsnachweis überein`);
    }
  }
}

/** Keep source declarations, never infer a status or invent confirmation on restore. */
function fiscalProfileForRestore(settings: JsonRecord) {
  const validation = validateFiscalProfileInput(settings);
  if (!validation.ok) {
    const [field, message] = Object.entries(validation.fieldErrors)[0];
    throw new BackupValidationError(`settings.${field}: ${message}`);
  }
  const selection = validation.selection;
  if (!selection || selection.fiscalTaxRegime === 'UNSET') {
    if (settings.fiscalConfirmedAt !== undefined && settings.fiscalConfirmedAt !== null) {
      throw new BackupValidationError('settings.fiscalConfirmedAt erfordert eine ausdrückliche steuerliche Einordnung');
    }
    return { ...EMPTY_FISCAL_PROFILE, fiscalConfirmedAt: null };
  }
  const value = settings.fiscalConfirmedAt;
  if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))) {
    throw new BackupValidationError('settings.fiscalConfirmedAt fehlt oder ist ungültig');
  }
  const confirmedAt = new Date(value);
  if (!Number.isFinite(confirmedAt.getTime()) || (typeof value === 'string' && confirmedAt.toISOString() !== value)) {
    throw new BackupValidationError('settings.fiscalConfirmedAt ist ungültig');
  }
  return { ...selection, fiscalConfirmedAt: confirmedAt };
}

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** Unlike legacy date imports, new source metadata is strict and never defaulted. */
function sourceDate(value: unknown, label: string, required = false): Date | null {
  if ((value === undefined || value === null) && !required) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new BackupValidationError(`${label} ist ungültig`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new BackupValidationError(`${label} ist ungültig`);
  return parsed;
}

function validateSourceDecimal(value: unknown, label: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || value.length > 100 || !/^-?\d+(?:\.\d+)?$/u.test(value) || !Number.isFinite(Number(value))) throw new BackupValidationError(`${label} ist ungültig`);
}

const SUPPLIER_CONTACT_LIMITS = { name: 255, address: 1_000, postalCode: 30, city: 255, country: 100, email: 255, phone: 100, taxId: 100, vatId: 100 } as const;

function validateSupplierContact(record: JsonRecord, label: string): void {
  if (typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id <= 0) throw new BackupValidationError(`${label}.id ist ungültig`);
  if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 0) throw new BackupValidationError(`${label}.revision ist ungültig`);
  for (const [field, max] of Object.entries(SUPPLIER_CONTACT_LIMITS)) {
    if (!(field in record)) throw new BackupValidationError(`${label}.${field} fehlt`);
    const value = asOptionalString(record[field], `${label}.${field}`, max);
    if ((field === 'name' && !value?.trim()) || (value && /[\u0000-\u001f\u007f]/u.test(value))) throw new BackupValidationError(`${label}.${field} ist ungültig`);
  }
}

function validateSuppliers(data: JsonRecord, manifest?: BackupManifest): void {
  const sourceUserId = manifest?.sourceUserId ?? (isRecord(data.user) ? data.user.id : undefined);
  for (const [index, supplier] of asArray(data, 'suppliers').entries()) {
    const label = `suppliers[${index}]`;
    if (supplier.userId !== undefined && supplier.userId !== sourceUserId) throw new BackupValidationError(`${label}.userId gehört nicht zum Quellmandanten`);
    validateSupplierContact(supplier, label);
    if (Object.keys(supplier).some((key) => !['id', 'userId', 'revision', 'createdAt', 'updatedAt', ...Object.keys(SUPPLIER_CONTACT_LIMITS)].includes(key))) throw new BackupValidationError(`${label} enthält unbekannte Lieferantenfelder`);
    sourceDate(supplier.createdAt, `${label}.createdAt`, true);
    sourceDate(supplier.updatedAt, `${label}.updatedAt`, true);
  }
}

function validatePurchaseDocuments(data: JsonRecord, manifest?: BackupManifest, full = false): void {
  const documents = asArray(data, 'purchaseDocuments');
  const hashes = new Set<string>();
  const storedNames = new Set<string>();
  const requestIds = new Set<string>();
  const expenseIds = new Set<number>();
  const suppliers = new Map(asArray(data, 'suppliers').map((supplier) => [asOptionalInt(supplier.id, 'supplier.id'), supplier]));
  const expenses = new Map(asArray(data, 'expenses').map((expense) => [asOptionalInt(expense.id, 'expense.id'), expense]));
  const sourceUserId = manifest?.sourceUserId ?? (isRecord(data.user) ? data.user.id : undefined);
  for (const [index, document] of documents.entries()) {
    const label = `purchaseDocuments[${index}]`;
    if (document.userId !== undefined && document.userId !== sourceUserId) throw new BackupValidationError(`${label}.userId gehört nicht zum Quellmandanten`);
    const originalFileName = asRequiredString(document.originalFileName, `${label}.originalFileName`, 240);
    if (/[\u0000-\u001f\u007f]/u.test(originalFileName)) throw new BackupValidationError(`${label}.originalFileName enthält Steuerzeichen`);
    if (!isSafeStoredFileName(document.storedFileName) || storedNames.has(document.storedFileName)) throw new BackupValidationError(`${label}.storedFileName enthält keine eindeutige private Dateireferenz`);
    storedNames.add(document.storedFileName);
    const hash = asRequiredString(document.originalSha256, `${label}.originalSha256`, 64);
    const requestId = asRequiredString(document.uploadRequestId, `${label}.uploadRequestId`, 36);
    if (!SHA256_PATTERN.test(hash) || hashes.has(hash)) throw new BackupValidationError(`${label}.originalSha256 ist ungültig oder doppelt`);
    if (!UUID_PATTERN.test(requestId) || requestId !== requestId.toLowerCase() || requestIds.has(requestId)) throw new BackupValidationError(`${label}.uploadRequestId ist ungültig oder doppelt`);
    if (full && manifest) {
      const originalEntry = manifest.fileManifest.find((entry) => entry.kind === 'purchase-document' && entry.sourceName === document.storedFileName);
      if (!originalEntry || originalEntry.sha256 !== hash || originalEntry.bytes !== document.originalByteCount) throw new BackupValidationError(`${label} ist nicht an das Original-Dateimanifest gebunden`);
    }
    hashes.add(hash);
    requestIds.add(requestId);
    const media = asRequiredString(document.mediaType, `${label}.mediaType`, 64);
    if (!['application/pdf', 'application/xml'].includes(media)) throw new BackupValidationError(`${label}.mediaType ist ungültig`);
    if (!(document.storedFileName as string).endsWith(media === 'application/pdf' ? '.pdf' : '.xml')) throw new BackupValidationError(`${label}.storedFileName entspricht nicht dem Medientyp`);
    const bytes = asOptionalInt(document.originalByteCount, `${label}.originalByteCount`);
    if (typeof document.originalByteCount !== 'number' || bytes === null || bytes <= 0 || bytes > (media === 'application/pdf' ? MAX_INVOICE_UPLOAD_BYTES : MAX_XML_INPUT_BYTES)) {
      throw new BackupValidationError(`${label}.originalByteCount ist ungültig`);
    }
    sourceDate(document.uploadedAt, `${label}.uploadedAt`, true);
    sourceDate(document.updatedAt, `${label}.updatedAt`, true);
    const invoiceDate = sourceDate(document.invoiceDate, `${label}.invoiceDate`);
    if (invoiceDate && (invoiceDate.getUTCHours() || invoiceDate.getUTCMinutes() || invoiceDate.getUTCSeconds() || invoiceDate.getUTCMilliseconds())) {
      throw new BackupValidationError(`${label}.invoiceDate muss auf UTC-Mitternacht liegen`);
    }
    if (!['PENDING', 'PARSED', 'FAILED'].includes(String(document.parseStatus))) throw new BackupValidationError(`${label}.parseStatus ist ungültig`);
    if (!['REVIEW', 'BOOKED', 'DISMISSED'].includes(String(document.reviewStatus))) throw new BackupValidationError(`${label}.reviewStatus ist ungültig`);
    const revision = asOptionalInt(document.revision, `${label}.revision`);
    if (typeof document.revision !== 'number' || revision === null || revision < 0) throw new BackupValidationError(`${label}.revision ist ungültig`);
    asOptionalString(document.parserVersion, `${label}.parserVersion`, 128);
    const parseErrorCode = asOptionalString(document.parseErrorCode, `${label}.parseErrorCode`, 128);
    if (document.parseStatus === 'FAILED' ? !parseErrorCode || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(parseErrorCode) : parseErrorCode !== null) throw new BackupValidationError(`${label}.parseErrorCode entspricht nicht dem Extraktionsstatus`);
    if (document.parseStatus !== 'PARSED' && document.parsedData !== null && document.parsedData !== undefined) throw new BackupValidationError(`${label}.parsedData darf ohne erfolgreiche Extraktion nicht gesetzt sein`);
    asOptionalString(document.supplierName, `${label}.supplierName`, 1_000);
    asOptionalString(document.invoiceNumber, `${label}.invoiceNumber`, 255);
    const currency = asOptionalString(document.currency, `${label}.currency`, 3);
    if (currency !== null && !/^[A-Z]{3}$/u.test(currency)) throw new BackupValidationError(`${label}.currency ist ungültig`);
    if (document.totalAmount !== null && document.totalAmount !== undefined && (typeof document.totalAmount !== 'number' || !Number.isFinite(document.totalAmount))) {
      throw new BackupValidationError(`${label}.totalAmount ist ungültig`);
    }
    if (document.parsedData !== null && document.parsedData !== undefined) {
      const parsed = asRecord(document.parsedData, `${label}.parsedData`);
      const previewFields = new Set(['extractionStatus', 'validationStatus', 'format', 'documentType', 'documentTypeCode', 'currency', 'invoiceNumber', 'invoiceDate', 'dueDate', 'grossAmount', 'dueAmount', 'prepaidAmount', 'roundingAmount', 'netAmount', 'taxAmount', 'sellerInfo', 'buyerInfo', 'lineItems', 'parserWarnings', 'approvalSupported']);
      if (Object.keys(parsed).some((field) => !previewFields.has(field))) throw new BackupValidationError(`${label}.parsedData enthält nicht unterstützte Vorschaufelder`);
      if (parsed.validationStatus !== 'NOT_VALIDATED' || parsed.extractionStatus !== 'PARSED') throw new BackupValidationError(`${label}.parsedData enthält keinen gültigen Extraktionsstatus`);
      if (!['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'UNKNOWN'].includes(String(parsed.documentType))) throw new BackupValidationError(`${label}.parsedData.documentType ist ungültig`);
      for (const partyName of ['sellerInfo', 'buyerInfo']) {
        const party = asRecord(parsed[partyName], `${label}.parsedData.${partyName}`);
        for (const field of ['name', 'email', 'address', 'zipCode', 'city', 'country']) asOptionalString(party[field], `${label}.parsedData.${partyName}.${field}`, 10_000);
        if (party.addressLines !== undefined && (!Array.isArray(party.addressLines) || party.addressLines.length > 100 || party.addressLines.some((line) => typeof line !== 'string' || line.length > 10_000))) throw new BackupValidationError(`${label}.parsedData.${partyName}.addressLines ist ungültig`);
      }
      if (!['CII', 'UBL'].includes(String(parsed.format)) || typeof parsed.approvalSupported !== 'boolean') throw new BackupValidationError(`${label}.parsedData enthält kein unterstütztes Vorschauformat`);
      for (const field of ['grossAmount', 'prepaidAmount', 'roundingAmount', 'dueAmount', 'netAmount', 'taxAmount']) {
        validateSourceDecimal(parsed[field], `${label}.parsedData.${field}`);
      }
      if (!Array.isArray(parsed.lineItems) || parsed.lineItems.length > 1_000) throw new BackupValidationError(`${label}.parsedData.lineItems ist ungültig`);
      for (const [lineIndex, value] of parsed.lineItems.entries()) {
        const line = asRecord(value, `${label}.parsedData.lineItems[${lineIndex}]`);
        for (const field of ['description', 'unit']) asOptionalString(line[field], `${label}.parsedData.lineItems[${lineIndex}].${field}`, 10_000);
        for (const field of ['quantity', 'unitPrice', 'amount', 'taxRate']) validateSourceDecimal(line[field], `${label}.parsedData.lineItems[${lineIndex}].${field}`);
      }
      if (!Array.isArray(parsed.parserWarnings) || parsed.parserWarnings.length > 100) throw new BackupValidationError(`${label}.parsedData.parserWarnings ist ungültig`);
      for (const warning of parsed.parserWarnings) {
        const record = asRecord(warning, `${label}.parsedData.parserWarnings`);
        asRequiredString(record.code, `${label}.parsedData.parserWarnings.code`, 128);
        asRequiredString(record.message, `${label}.parsedData.parserWarnings.message`, 2_000);
      }
      for (const field of ['invoiceDate', 'dueDate']) sourceDate(parsed[field], `${label}.parsedData.${field}`);
      asJson(parsed, `${label}.parsedData`);
    } else if (document.parseStatus === 'PARSED') {
      throw new BackupValidationError(`${label}.parsedData fehlt`);
    }
    const supplierId = asOptionalInt(document.supplierId, `${label}.supplierId`);
    const snapshot = document.selectedSupplierSnapshot == null ? null : asRecord(document.selectedSupplierSnapshot, `${label}.selectedSupplierSnapshot`);
    if ((supplierId === null) !== (snapshot === null) || (supplierId !== null && (!suppliers.has(supplierId) || typeof document.supplierId !== 'number'))) throw new BackupValidationError(`${label}.supplierId enthält keine eindeutige Lieferantenzuordnung`);
    if (snapshot) {
      validateSupplierContact(snapshot, `${label}.selectedSupplierSnapshot`);
      if (snapshot.id !== supplierId || Object.keys(snapshot).some((key) => !['id', 'revision', ...Object.keys(SUPPLIER_CONTACT_LIMITS)].includes(key))) throw new BackupValidationError(`${label}.selectedSupplierSnapshot entspricht nicht der Lieferantenzuordnung`);
    }
    const expenseId = asOptionalInt(document.expenseId, `${label}.expenseId`);
    const approvedAt = sourceDate(document.approvedAt, `${label}.approvedAt`);
    const approvalRequestId = asOptionalString(document.approvalRequestId, `${label}.approvalRequestId`, 36);
    const approvalFingerprint = asOptionalString(document.approvalFingerprint, `${label}.approvalFingerprint`, 64);
    const dismissedAt = sourceDate(document.dismissedAt, `${label}.dismissedAt`);
    const dismissalReason = asOptionalString(document.dismissalReason, `${label}.dismissalReason`, 2_000);
    if (document.reviewStatus === 'BOOKED') {
      if (supplierId === null || !snapshot) throw new BackupValidationError(`${label}: Gebuchte Eingangsbelege benötigen einen ausdrücklich ausgewählten Lieferanten und historischen Snapshot; alte Buchungen ohne Lieferantenzuordnung können nicht automatisch ergänzt werden`);
      if (expenseId === null || !approvedAt || !approvalRequestId || !UUID_PATTERN.test(approvalRequestId) || !approvalFingerprint || !SHA256_PATTERN.test(approvalFingerprint) || document.parseStatus !== 'PARSED' || dismissedAt || dismissalReason) throw new BackupValidationError(`${label} enthält einen inkonsistenten Buchungszustand`);
      const expense = expenses.get(expenseId);
      if (!expense || expenseIds.has(expenseId) || expense.storedReceiptFileName !== document.storedFileName || (expense.userId !== undefined && expense.userId !== sourceUserId)) throw new BackupValidationError(`${label}.expenseId enthält keinen eindeutigen Originalbezug`);
      if (expense.recurringExpenseId != null || expense.scheduledDate != null
        || asArray(data, 'cashTransactions').some((entry) => asOptionalInt(entry.expenseId, 'cashTransaction.expenseId') === expenseId)) throw new BackupValidationError(`${label}.expenseId darf nicht mit Wiederholung, Ausführungstermin oder Kassenbuchung verknüpft sein`);
      if (full && manifest) {
        const originalEntry = manifest.fileManifest.find((entry) => entry.kind === 'purchase-document' && entry.sourceName === document.storedFileName);
        const receiptEntry = manifest.fileManifest.find((entry) => entry.kind === 'receipt' && entry.sourceName === document.storedFileName);
        if (!receiptEntry || receiptEntry.sha256 !== hash || receiptEntry.bytes !== bytes || (receiptEntry.zipPath && originalEntry?.zipPath && receiptEntry.zipPath !== originalEntry.zipPath)) throw new BackupValidationError(`${label}.expenseId enthält keinen übereinstimmenden Dateimanifest-Bezug`);
      }
      expenseIds.add(expenseId);
    } else if (expenseId !== null || approvedAt || approvalRequestId || approvalFingerprint) {
      throw new BackupValidationError(`${label} darf ohne Buchung keine Ausgabe oder Freigabemetadaten referenzieren`);
    }
    if (document.reviewStatus === 'DISMISSED' && (!dismissedAt || !dismissalReason?.trim())) throw new BackupValidationError(`${label} benötigt Ablehnungsgrund und Zeitpunkt`);
    if (document.reviewStatus === 'REVIEW' && (dismissedAt || dismissalReason)) throw new BackupValidationError(`${label} enthält einen inkonsistenten Prüfzustand`);
  }
}

/** Validate shape, scalar values, IDs and all relations before any mutation. */
export function validateBackupForRestore(backup: unknown): ValidatedBackup {
  const root = asRecord(backup, 'Backup');
  const version = asRequiredString(root.version, 'Backup-Version', 32);
  if (version !== LEGACY_BACKUP_VERSION && version !== CURRENT_BACKUP_VERSION) throw new BackupValidationError(`Nicht unterstützte Backup-Version ${version}`);
  const data = asRecord(root.data, 'Backup-Daten');
  let manifest: BackupManifest | undefined;
  const warnings: string[] = [];
  if (version === CURRENT_BACKUP_VERSION) {
    try {
      manifest = validateBackupManifest(root.manifest, data);
    } catch (error) {
      throw new BackupValidationError(error instanceof Error ? error.message : 'Backup-Manifest ist ungültig');
    }
    const dataUser = asRecord(data.user, 'Backup-Daten.user');
    if (asRequiredString(dataUser.id, 'Backup-Daten.user.id', 255) !== manifest.sourceUserId) {
      throw new BackupValidationError('Backup-Manifest sourceUserId stimmt nicht mit data.user.id überein');
    }
    if (root.user !== undefined && root.user !== null) {
      const topLevelUser = asRecord(root.user, 'Backup.user');
      if (asRequiredString(topLevelUser.id, 'Backup.user.id', 255) !== manifest.sourceUserId) {
        throw new BackupValidationError('Backup-Manifest sourceUserId stimmt nicht mit user.id überein');
      }
    }
  } else {
    warnings.push(manifestWarning(LEGACY_BACKUP_VERSION)!);
  }

  const arrays = Object.fromEntries(ARRAY_KEYS.map((key) => [key, asArray(data, key)]));
  if (version === LEGACY_BACKUP_VERSION && arrays.suppliers.length > 0) throw new BackupValidationError('Legacy-Backups dürfen keine ungebundenen Lieferanten enthalten');
  if (version === LEGACY_BACKUP_VERSION && arrays.purchaseDocuments.length > 0) throw new BackupValidationError('Legacy-Backups dürfen keine ungebundenen Eingangsbelege enthalten');
  const sets: Record<string, Set<number>> = {};
  for (const key of ARRAY_KEYS) {
    if (key !== 'apiKeys') sets[key] = validateIds(arrays[key], key);
  }

  validateDateFields(arrays.customers, 'customers', ['createdAt']);
  validateDateFields(arrays.expenses, 'expenses', ['date']);
  validateDateFields(arrays.incomes, 'incomes', ['date']);
  validateDateFields(arrays.invoices, 'invoices', ['uploadedAt', 'invoiceDate', 'dueDate', 'paidAt', 'validUntil']);
  validateDateFields(arrays.templates, 'templates', ['createdAt', 'updatedAt']);
  validateDateFields(arrays.recurringExpenses, 'recurringExpenses', ['startDate', 'endDate', 'lastExecuted', 'nextExecution', 'createdAt', 'updatedAt']);
  validateDateFields(arrays.reminders, 'reminders', ['sentAt', 'dueDate', 'createdAt']);
  validateDateFields(arrays.cashBooks, 'cashBooks', ['createdAt', 'updatedAt']);
  validateDateFields(arrays.cashTransactions, 'cashTransactions', ['date', 'createdAt', 'updatedAt']);
  validateDateFields(arrays.documentations, 'documentations', ['createdAt', 'updatedAt']);
  validateDateFields(arrays.billingNotes, 'billingNotes', ['serviceDate', 'createdAt', 'updatedAt']);

  arrays.customers.forEach((customer, index) => {
    asRequiredString(customer.name, `customers[${index}].name`, 255);
    asOptionalString(customer.internalNote, `customers[${index}].internalNote`, 5_000);
    if (customer.noteVisibility !== undefined && !['EDITOR', 'SEND', 'BOTH'].includes(String(customer.noteVisibility))) {
      throw new BackupValidationError(`customers[${index}].noteVisibility ist ungültig`);
    }
  });

  arrays.invoices.forEach((invoice, index) => {
    asRequiredString(invoice.fileName, `invoices[${index}].fileName`, 255);
    validateStoredName(invoice.storedFileName, `invoices[${index}].storedFileName`);
    asOptionalString(invoice.invoiceNumber, `invoices[${index}].invoiceNumber`, 255);
    asOptionalFinite(invoice.totalAmount, `invoices[${index}].totalAmount`);
    if (version === CURRENT_BACKUP_VERSION && invoice.issuanceState !== undefined && !['UNKNOWN', 'UNISSUED', 'ISSUED'].includes(String(invoice.issuanceState))) {
      throw new BackupValidationError(`invoices[${index}].issuanceState ist ungültig`);
    }
    if (invoice.parsedData !== undefined) asJson(invoice.parsedData, `invoices[${index}].parsedData`);
  });
  arrays.expenses.forEach((expense, index) => {
    asRequiredString(expense.description, `expenses[${index}].description`, 255);
    asOptionalFinite(expense.amount, `expenses[${index}].amount`);
    validateStoredName(expense.storedReceiptFileName, `expenses[${index}].storedReceiptFileName`);
    asOptionalFinite(expense.taxDeductiblePercentage, `expenses[${index}].taxDeductiblePercentage`);
    asOptionalInt(expense.depreciationYears, `expenses[${index}].depreciationYears`);
  });
  arrays.incomes.forEach((income, index) => {
    asRequiredString(income.description, `incomes[${index}].description`, 255);
    asOptionalFinite(income.amount, `incomes[${index}].amount`);
  });
  arrays.cashTransactions.forEach((transaction, index) => {
    asRequiredString(transaction.type, `cashTransactions[${index}].type`, 32);
    asRequiredString(transaction.description, `cashTransactions[${index}].description`, 255);
    asOptionalFinite(transaction.amount, `cashTransactions[${index}].amount`);
    asOptionalFinite(transaction.runningBalance, `cashTransactions[${index}].runningBalance`);
  });
  arrays.templates.forEach((template, index) => {
    asRequiredString(template.name, `templates[${index}].name`, 255);
    asJson(template.data, `templates[${index}].data`);
  });
  arrays.documentations.forEach((doc, index) => {
    asRequiredString(doc.version, `documentations[${index}].version`, 64);
    asRequiredString(doc.content, `documentations[${index}].content`, 2_000_000);
  });
  arrays.billingNotes.forEach((note, index) => {
    asBusinessDate(note.serviceDate, `billingNotes[${index}].serviceDate`);
    asRequiredString(note.description, `billingNotes[${index}].description`, 500);
    asBillingQuantity(note.quantity, `billingNotes[${index}].quantity`);
    const unit = asOptionalString(note.unit, `billingNotes[${index}].unit`, 100);
    if (unit !== null && unit.length === 0) throw new BackupValidationError(`billingNotes[${index}].unit darf nicht leer sein`);
  });
  arrays.auditLogs.forEach((audit, index) => {
    asOptionalInt(audit.id, `auditLogs[${index}].id`);
    asRequiredString(audit.action, `auditLogs[${index}].action`, 64);
    asRequiredString(audit.entityType, `auditLogs[${index}].entityType`, 64);
    asOptionalString(audit.entityId, `auditLogs[${index}].entityId`, 255);
    asOptionalString(audit.entityName, `auditLogs[${index}].entityName`, 1_000);
    asOptionalString(audit.oldValues, `auditLogs[${index}].oldValues`, 2_000_000);
    asOptionalString(audit.newValues, `auditLogs[${index}].newValues`, 2_000_000);
    asOptionalString(audit.changedFields, `auditLogs[${index}].changedFields`, 100_000);
    asOptionalString(audit.metadata, `auditLogs[${index}].metadata`, 2_000_000);
    asOptionalString(audit.userId, `auditLogs[${index}].userId`, 255);
    asDate(audit.createdAt, `auditLogs[${index}].createdAt`);
  });
  const counterKeys = new Set<string>();
  for (const [index, counter] of asArray(data, 'invoiceNumberCounters').entries()) {
    const type = asRequiredString(counter.type, `invoiceNumberCounters[${index}].type`, 32);
    const year = asOptionalInt(counter.year, `invoiceNumberCounters[${index}].year`);
    const value = asOptionalInt(counter.value, `invoiceNumberCounters[${index}].value`);
    if (year === null || year < 0 || value === null || value < 0) throw new BackupValidationError(`invoiceNumberCounters[${index}] ist ungültig`);
    const key = `${type}:${year}`;
    if (counterKeys.has(key)) throw new BackupValidationError(`invoiceNumberCounters enthält doppelte Schlüssel: ${key}`);
    counterKeys.add(key);
  }

  if (data.settings !== undefined && data.settings !== null) fiscalProfileForRestore(asRecord(data.settings, 'settings'));
  validateBackupReferences(data, sets);
  validateSuppliers(data, manifest);
  validatePurchaseDocuments(data, manifest, root.type === 'full');
  validatePaymentJournalBackup(data, version);
  const invariantValidation: RestoreInvariantValidation = { issues: [], truncated: false };
  validateRestoreInvariants(data, invariantValidation);
  if (invariantValidation.issues.length > 0) {
    throw new BackupValidationError(
      invariantValidation.issues[0].message,
      invariantValidation.issues,
      invariantValidation.truncated,
    );
  }
  return { version, data, manifest, warnings };
}

function resultTemplate(overwrite: boolean): RestoreResult {
  return {
    overwriteMode: overwrite,
    deleted: overwrite ? 'Alle bestehenden Daten wurden gelöscht' : undefined,
    customers: { imported: 0, skipped: 0 },
    suppliers: { imported: 0, skipped: 0 },
    billingNotes: { imported: 0, skipped: 0 },
    expenses: { imported: 0, skipped: 0 },
    incomes: { imported: 0, skipped: 0 },
    paymentJournalEvents: { imported: 0, skipped: 0 },
    invoices: { imported: 0, skipped: 0 },
    purchaseDocuments: { imported: 0, skipped: 0 },
    templates: { imported: 0, skipped: 0 },
    files: { imported: 0, skipped: 0 },
    settings: { imported: false },
    recurringExpenses: { imported: 0, skipped: 0 },
    reminders: { imported: 0, skipped: 0 },
    cashBooks: { imported: 0, skipped: 0 },
    cashTransactions: { imported: 0, skipped: 0 },
    documentations: { imported: 0, skipped: 0 },
    auditLogs: { imported: 0, skipped: 0 },
    invoiceNumberCounters: { imported: 0, skipped: 0 },
    warnings: [],
  };
}

function relationMapValue(map: Map<number, number>, value: unknown, label: string): number | null {
  const sourceId = asOptionalInt(value, label);
  if (sourceId === null) return null;
  const target = map.get(sourceId);
  if (!target) throw new BackupValidationError(`${label} konnte nicht zugeordnet werden`);
  return target;
}

function logoFileName(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/(?:[?&]file=|\/uploads\/)([^&]+)/u);
  if (!match) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(match[1]); } catch { return null; }
  return (isSafeStoredFileName(decoded) || isSafeLegacyFileName(decoded)) ? decoded : null;
}

type CounterValueMap = Map<string, number>;

function counterKey(type: string, year: number): string {
  return `${type}:${year}`;
}

function addCounterValue(target: CounterValueMap, type: string, year: number, value: number): void {
  const key = counterKey(type, year);
  target.set(key, Math.max(target.get(key) ?? 0, value));
}

function historicalCounterValues(invoices: Array<{ type: string; invoiceNumber: string | null }>): CounterValueMap {
  const values: CounterValueMap = new Map();
  const supportedTypes: DocumentType[] = ['INVOICE', 'QUOTE', 'CREDIT_NOTE'];
  for (const invoice of invoices) {
    if (!supportedTypes.includes(invoice.type as DocumentType) || !invoice.invoiceNumber) continue;
    const type = invoice.type as DocumentType;
    const numberPattern = type === 'QUOTE' ? /^AN-(\d{4})-(\d+)$/u : type === 'CREDIT_NOTE' ? /^GS-(\d{4})-(\d+)$/u : /^(\d{4})-(\d+)$/u;
    const match = invoice.invoiceNumber.match(numberPattern);
    if (!match) continue;
    const year = Number(match[1]);
    const sequence = maximumDocumentSequence([invoice.invoiceNumber], documentNumberPrefix(type, year));
    if (sequence > 0) addCounterValue(values, type, year, sequence);
  }
  return values;
}

function mapAuditEntityId(entityType: string, sourceEntityId: string | null, maps: {
  userId: string;
  sourceUserId?: string;
  customers: Map<number, number>;
  suppliers: Map<number, number>;
  billingNotes: Map<number, number>;
  expenses: Map<number, number>;
  incomes: Map<number, number>;
  paymentJournalEvents: Map<number, number>;
  invoices: Map<number, number>;
  purchaseDocuments: Map<number, number>;
  recurringExpenses: Map<number, number>;
  reminders: Map<number, number>;
  cashBooks: Map<number, number>;
  cashTransactions: Map<number, number>;
  templates: Map<number, number>;
  documentations: Map<number, number>;
  settings: Map<number, number>;
}): { entityId: string | null; state: 'mapped' | 'unresolved' | 'not-applicable'; sourceEntityId: string | null } {
  if (!sourceEntityId) return { entityId: null, state: 'not-applicable', sourceEntityId: null };
  if (entityType === 'User') {
    return { entityId: maps.sourceUserId === sourceEntityId ? maps.userId : null, state: maps.sourceUserId === sourceEntityId ? 'mapped' : 'unresolved', sourceEntityId };
  }
  const mapByType: Record<string, Map<number, number> | undefined> = {
    Customer: maps.customers,
    Supplier: maps.suppliers,
    BillingNote: maps.billingNotes,
    Expense: maps.expenses,
    Income: maps.incomes,
    PaymentJournalEvent: maps.paymentJournalEvents,
    Invoice: maps.invoices,
    PurchaseDocument: maps.purchaseDocuments,
    Quote: maps.invoices,
    CreditNote: maps.invoices,
    RecurringExpense: maps.recurringExpenses,
    Reminder: maps.reminders,
    CashBook: maps.cashBooks,
    CashTransaction: maps.cashTransactions,
    InvoiceTemplate: maps.templates,
    Documentation: maps.documentations,
    Settings: maps.settings,
  };
  const map = mapByType[entityType];
  const numericId = Number(sourceEntityId);
  if (!map || !Number.isSafeInteger(numericId)) return { entityId: null, state: 'unresolved', sourceEntityId };
  const mapped = map.get(numericId);
  return { entityId: mapped === undefined ? null : String(mapped), state: mapped === undefined ? 'unresolved' : 'mapped', sourceEntityId };
}

function auditImportKey(backupId: string, sourceUserId: string | undefined, sourceAuditId: number | null, index: number): string {
  if (sourceAuditId !== null) return `${sourceUserId ?? 'unknown-source'}:audit:${sourceAuditId}`;
  return `${backupId}:index-${index}`;
}

function billingNoteImportKey(sourceUserId: string | undefined, sourceNoteId: number): string {
  return `${sourceUserId ?? 'unknown-source'}:billing-note:${sourceNoteId}`;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function restoredIssuanceState(invoice: JsonRecord, version: string, paidInvoiceIds: Set<number>): 'UNKNOWN' | 'UNISSUED' | 'ISSUED' {
  if (version === LEGACY_BACKUP_VERSION || typeof invoice.issuanceState !== 'string') return 'UNKNOWN';
  const candidate = invoice.issuanceState;
  if (!['UNKNOWN', 'UNISSUED', 'ISSUED'].includes(candidate)) throw new BackupValidationError('invoice.issuanceState ist ungültig');
  const sourceId = asOptionalInt(invoice.id, 'invoice.id');
  const status = asOptionalString(invoice.status, 'invoice.status', 32) ?? 'DRAFT';
  if (candidate === 'UNISSUED' && (status !== 'DRAFT' || (sourceId !== null && paidInvoiceIds.has(sourceId)))) return 'ISSUED';
  // A backup is an untrusted import.  It may preserve a trusted ISSUED
  // state, but it cannot establish the positive evidence required for
  // UNISSUED; keep that conservative state UNKNOWN.
  return candidate === 'ISSUED' ? 'ISSUED' : 'UNKNOWN';
}

function issuanceStateRank(value: string | null | undefined): number {
  // UNKNOWN is the conservative deletion guard: an imported backup cannot
  // prove UNISSUED, while ISSUED remains the strongest state.
  return value === 'ISSUED' ? 2 : value === 'UNKNOWN' ? 1 : 0;
}

async function deleteUserData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.cashTransaction.deleteMany({ where: { userId } });
  await tx.reminder.deleteMany({ where: { userId } });
  await tx.invoice.updateMany({ where: { userId }, data: { originalInvoiceId: null, convertedFromQuoteId: null } });
  await tx.income.deleteMany({ where: { userId } });
  await tx.purchaseDocument.deleteMany({ where: { userId } });
  await tx.supplier.deleteMany({ where: { userId } });
  await tx.expense.deleteMany({ where: { userId } });
  await tx.cashBook.deleteMany({ where: { userId } });
  await tx.documentation.deleteMany({ where: { userId } });
  await tx.recurringExpense.deleteMany({ where: { userId } });
  await tx.apiLog.deleteMany({ where: { userId } });
  await tx.apiKey.deleteMany({ where: { userId } });
  await tx.invoiceTemplate.deleteMany({ where: { userId } });
  await tx.billingNote.deleteMany({ where: { userId } });
  await tx.invoice.deleteMany({ where: { userId } });
  await tx.customer.deleteMany({ where: { userId } });
  await tx.settings.deleteMany({ where: { userId } });
  // AuditLog is intentionally preserved as an immutable restore trail.
}

function purchaseOriginalIdentity(record: JsonRecord): string {
  return hashJson(Object.fromEntries(['id', 'userId', 'storedFileName', 'originalSha256', 'originalByteCount', 'mediaType'].map((field) => [field, record[field]])));
}

function purchaseSourceFingerprint(record: JsonRecord, supplierMap?: Map<number, number>): string {
  const dateFields = ['uploadedAt', 'invoiceDate', 'approvedAt', 'dismissedAt'];
  const fields = ['originalFileName', 'originalSha256', 'originalByteCount', 'mediaType', 'uploadRequestId', 'parsedData', 'parseStatus', 'parserVersion', 'parseErrorCode', 'supplierName', 'invoiceNumber', 'currency', 'totalAmount', 'reviewStatus', 'revision', 'approvalRequestId', 'approvalFingerprint', 'dismissalReason'];
  return hashJson({
    ...Object.fromEntries(fields.map((field) => [field, record[field] ?? null])),
    ...Object.fromEntries(dateFields.map((field) => [field, sourceDate(record[field], field)?.toISOString() ?? null])),
    linked: record.expenseId !== null && record.expenseId !== undefined,
    supplierId: supplierMap ? relationMapValue(supplierMap, record.supplierId, 'purchaseDocument.supplierId') : record.supplierId ?? null,
    selectedSupplierSnapshot: remapSupplierSnapshot(record.selectedSupplierSnapshot, supplierMap),
  });
}

function remapSupplierSnapshot(value: unknown, supplierMap?: Map<number, number>): JsonRecord | null {
  if (value == null) return null;
  const snapshot = asRecord(value, 'selectedSupplierSnapshot');
  return { ...snapshot, id: supplierMap ? relationMapValue(supplierMap, snapshot.id, 'selectedSupplierSnapshot.id') : snapshot.id };
}

function supplierFingerprint(record: JsonRecord): string {
  return hashJson({
    ...Object.fromEntries([...Object.keys(SUPPLIER_CONTACT_LIMITS), 'revision'].map((field) => [field, record[field] ?? null])),
    createdAt: sourceDate(record.createdAt, 'supplier.createdAt', true)!.toISOString(),
    updatedAt: sourceDate(record.updatedAt, 'supplier.updatedAt', true)!.toISOString(),
  });
}

function supplierImportKey(sourceUserId: string, sourceId: number): string {
  return `${sourceUserId}:supplier:${sourceId}`;
}

function purchaseExpenseFingerprint(record: JsonRecord): string {
  // Recurrence cannot be silently rematched by an original hash.
  if (record.recurringExpenseId !== null && record.recurringExpenseId !== undefined) throw new BackupValidationError('Eingangsbeleg-Kollision mit wiederkehrender Ausgabe erfordert gesonderte Prüfung');
  const fields = ['description', 'category', 'receiptUrl', 'receiptFileName', 'depreciationYears', 'taxDeductiblePercentage'];
  return hashJson({
    ...Object.fromEntries(fields.map((field) => [field, record[field] ?? null])),
    amount: centsForRestore(record.amount),
    date: asDate(record.date, 'expense.date', RESTORE_DEFAULT_DATE)?.toISOString(),
    taxRelevant: record.taxRelevant ?? true,
    scheduledDate: asDate(record.scheduledDate, 'expense.scheduledDate')?.toISOString() ?? null,
  });
}

export async function restoreBackupData(options: RestoreOptions): Promise<RestoreResult> {
  const { userId, overwrite, resolveFile } = options;
  const { data, manifest, warnings: validationWarnings } = validateBackupForRestore(options.backup);
  const result = resultTemplate(overwrite);
  result.warnings.push(...validationWarnings);
  const documents = asArray(data, 'purchaseDocuments');
  if (documents.length > 0 && !resolveFile) {
    throw new BackupValidationError('Eingangsbeleg-Originale erfordern ein vollständiges ZIP-Backup; JSON-Metadaten allein sind nicht wiederherstellbar.');
  }
  const stagedFiles = new Set<string>();
  const usedFiles = new Set<string>();
  const fileMap = new Map<string, string>();
  const missingFiles = new Set<string>();
  const verifiedExistingOriginals = new Map<number, { identity: string; path: string; version: string }>();

  const stageFile = async (kind: FileKind, sourceName: string, originalName: string, expected?: { sha256: string; bytes: number }): Promise<string> => {
    const key = `${kind}:${sourceName}`;
    const known = fileMap.get(key);
    if (known) return known;
    let bytes: Uint8Array | null;
    if (resolveFile) {
      bytes = await resolveFile(kind, sourceName);
    } else {
      const existingPath = await findOwnedUploadedFile(userId, sourceName);
      bytes = existingPath ? await readFile(existingPath) : null;
    }
    if (bytes && bytes.byteLength === 0) bytes = null;
    if (resolveFile && bytes === null) {
      throw new BackupValidationError(`Datei ${sourceName} fehlt im Backup`);
    }
    if (expected && (!bytes || bytes.byteLength !== expected.bytes || hashBytes(bytes) !== expected.sha256)) {
      throw new BackupValidationError('Integritätsprüfung eines Eingangsbeleg-Originals fehlgeschlagen');
    }
    const missing = bytes === null;
    const storedName = missing
      ? createTenantStoredName(originalName)
      : await writeTenantFile(userId, originalName, bytes!);
    fileMap.set(key, storedName);
    if (missing) {
      missingFiles.add(key);
      result.warnings.push(`${kind}:${sourceName} enthält keine wiederherstellbaren Dateibytes; die Dateireferenz bleibt ausdrücklich ohne Datei.`);
    } else {
      stagedFiles.add(storedName);
      result.files.imported += 1;
    }
    return storedName;
  };

  const removeUnreferencedStage = async (storedName: string): Promise<void> => {
    const references = await Promise.all([
      prisma.purchaseDocument.count({ where: { userId, storedFileName: storedName } }),
      prisma.expense.count({ where: { userId, storedReceiptFileName: storedName } }),
      prisma.invoice.count({ where: { userId, storedFileName: storedName } }),
      prisma.settings.count({ where: { userId, logoUrl: `/api/files/logo?file=${encodeURIComponent(storedName)}` } }),
    ]);
    if (references.every((count) => count === 0)) await deleteTenantFile(userId, storedName);
  };

  try {
    const customers = asArray(data, 'customers');
    const suppliers = asArray(data, 'suppliers');
    const expenses = asArray(data, 'expenses');
    const incomes = asArray(data, 'incomes');
    const paymentJournalEvents = asArray(data, 'paymentJournalEvents');
    const invoices = asArray(data, 'invoices');
    const templates = asArray(data, 'templates');
    const recurringExpenses = asArray(data, 'recurringExpenses');
    const reminders = asArray(data, 'reminders');
    const billingNotes = asArray(data, 'billingNotes');
    const cashBooks = asArray(data, 'cashBooks');
    const cashTransactions = asArray(data, 'cashTransactions');
    const orderedCashTransactions = cashTransactions
      .map((transaction, index) => ({ transaction, index }))
      .sort(restoreCashTransactionOrder)
      .map(({ transaction }) => transaction);
    const documentations = asArray(data, 'documentations');
    const apiKeys = asArray(data, 'apiKeys');
    const auditLogs = asArray(data, 'auditLogs');
    const invoiceNumberCounters = asArray(data, 'invoiceNumberCounters');
    const paidInvoiceIds = new Set(incomes.map((income) => asOptionalInt(income.invoiceId, 'income.invoiceId')).filter((id): id is number => id !== null));
    const settings = data.settings === null || data.settings === undefined ? null : asRecord(data.settings, 'settings');
    const sourceUserId = manifest?.sourceUserId
      ?? (isRecord(data.user) && typeof data.user.id === 'string' ? data.user.id : undefined);
    const backupId = manifest?.backupId ?? 'legacy-v2';
    if (apiKeys.length > 0) {
      result.warnings.push(`${apiKeys.length} API-Schlüssel wurden nicht übernommen; aus Sicherheitsgründen müssen neue Schlüssel erstellt werden.`);
    }

    // A merge may keep an existing component only if its original is still
    // usable. Metadata equality alone must not preserve a missing/tampered file.
    if (!overwrite && documents.length > 0) {
      const sourceHashes = new Set(documents.map((document) => document.originalSha256 as string));
      const candidates = await prisma.purchaseDocument.findMany({ where: { userId } });
      for (const existing of candidates) {
        if (!sourceHashes.has(existing.originalSha256)) continue;
        try {
          const originalPath = getTenantUploadPath(userId, existing.storedFileName);
          const before = await getBackupFileVersion(originalPath);
          await readPurchaseOriginal(existing);
          const after = await getBackupFileVersion(originalPath);
          if (!before || before !== after) throw new Error('original-version-drift');
          verifiedExistingOriginals.set(existing.id, { identity: purchaseOriginalIdentity(existing as unknown as JsonRecord), path: originalPath, version: after! });
        } catch {
          throw new BackupValidationError('Bestehendes Eingangsbeleg-Original fehlt oder ist verändert; Zusammenführen ohne geprüfte Originalwiederherstellung ist nicht möglich.');
        }
      }
    }

    // Stage all referenced files before touching the database. JSON backups do
    // not contain bytes; those references stay opaque and are reported as
    // missing instead of creating a corrupt empty PDF/receipt.
    for (const invoice of invoices) {
      const sourceName = validateStoredName(invoice.storedFileName, 'invoice.storedFileName')
        ?? `invoice-${String(invoice.id)}`;
      await stageFile('invoice', sourceName, asRequiredString(invoice.fileName, 'invoice.fileName', 255));
    }
    for (const document of documents) {
      const sourceName = document.storedFileName as string;
      const targetName = await stageFile('purchase-document', sourceName, document.mediaType === 'application/pdf' ? 'original.pdf' : 'original.xml', {
        sha256: document.originalSha256 as string, bytes: document.originalByteCount as number,
      });
      // A booked expense and its source retain the exact same private file.
      fileMap.set(`receipt:${sourceName}`, targetName);
    }
    for (const expense of expenses) {
      const sourceName = validateStoredName(expense.storedReceiptFileName, 'expense.storedReceiptFileName');
      if (sourceName) await stageFile('receipt', sourceName, asOptionalString(expense.receiptFileName, 'expense.receiptFileName', 255) ?? sourceName);
    }
    const sourceLogo = settings ? logoFileName(settings.logoUrl) : null;
    if (settings?.logoUrl && typeof settings.logoUrl === 'string' && !sourceLogo) {
      throw new BackupValidationError('settings.logoUrl enthält eine unzulässige Dateireferenz');
    }
    if (sourceLogo) await stageFile('logo', sourceLogo, sourceLogo);

    await prisma.$transaction(async (tx) => {
      // Read both counters and invoice-number history before overwrite can
      // remove the rows.  Historical years come from the number grammar.
      const [existingCounters, existingInvoices] = await Promise.all([
        tx.invoiceNumberCounter.findMany({ where: { userId } }),
        tx.invoice.findMany({ where: { userId }, select: { type: true, invoiceNumber: true } }),
      ]);
      const preservedCounterValues: CounterValueMap = new Map();
      for (const counter of existingCounters) addCounterValue(preservedCounterValues, counter.type, counter.year, counter.value);
      for (const [key, value] of historicalCounterValues(existingInvoices).entries()) {
        const separator = key.lastIndexOf(':');
        addCounterValue(preservedCounterValues, key.slice(0, separator), Number(key.slice(separator + 1)), value);
      }

      if (overwrite && await tx.paymentJournalEvent.count({ where: { userId } }) > 0) {
        throw new BackupValidationError('Überschreiben würde unveränderliche Zahlungsereignisse löschen. Bitte Zusammenführen oder ein leeres Wiederherstellungsziel verwenden.');
      }
      if (overwrite) await deleteUserData(tx, userId);
      const existingPaymentEvents = await tx.paymentJournalEvent.findMany({ where: { userId } });
      const existingPaymentByKey = new Map(existingPaymentEvents.map((event) => [event.idempotencyKey, event]));
      const existingPaymentByInvoice = new Map(existingPaymentEvents.map((event) => [event.invoiceId, event]));
      const sourcePaymentByInvoice = new Map(paymentJournalEvents.map((event) => [asOptionalInt(event.invoiceId, 'payment.invoiceId'), event]));

      const customerMap = new Map<number, number>();
      const supplierMap = new Map<number, number>();
      const invoiceMap = new Map<number, number>();
      const purchaseDocumentMap = new Map<number, number>();
      const cashBookMap = new Map<number, number>();
      const recurringMap = new Map<number, number>();
      const expenseMap = new Map<number, number>();
      const incomeMap = new Map<number, number>();
      const skippedSourceExpenses = new Set<number>();
      const paymentJournalMap = new Map<number, number>();
      const templateMap = new Map<number, number>();
      const reminderMap = new Map<number, number>();
      const billingNoteMap = new Map<number, number>();
      const cashTransactionMap = new Map<number, number>();
      const documentationMap = new Map<number, number>();
      const settingsMap = new Map<number, number>();
      const createdInvoiceIds = new Set<number>();
      const existingAuditImportRows = new Map<string, { id: number; entityId: string | null; metadata: string | null }>();
      const existingSupplierImports = new Map<string, { entityId: string | null }>();
      const existingBillingNoteImports = new Map<string, { id: number; entityId: string | null; metadata: string | null }>();
      const existingAuditRows = await tx.auditLog.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: { id: true, action: true, entityType: true, entityId: true, metadata: true } });
      for (const row of existingAuditRows) {
        const metadata = parseObject(row.metadata);
        const key = metadata?.backupImport && typeof metadata.backupImport === 'object'
          ? (metadata.backupImport as Record<string, unknown>).importKey
          : null;
        if (typeof key === 'string') existingAuditImportRows.set(key, row);
        const provenance = metadata?.backupImport;
        if (row.action === 'RESTORE' && row.entityType === 'Supplier' && isRecord(provenance)
          && provenance.sourceEntityType === 'Supplier' && provenance.targetTenantId === userId
          && typeof provenance.importKey === 'string') existingSupplierImports.set(provenance.importKey, row);
        if (row.action === 'RESTORE' && row.entityType === 'BillingNote'
          && typeof provenance === 'object' && provenance !== null
          && (provenance as Record<string, unknown>).sourceEntityType === 'BillingNote'
          && typeof (provenance as Record<string, unknown>).importKey === 'string') {
          existingBillingNoteImports.set((provenance as Record<string, unknown>).importKey as string, row);
        }
      }

      // In merge mode only records that existed before this restore are
      // deduplicated by name. Two same-named records in one backup remain
      // distinct so their source IDs and relationships are preserved.
      const existingCustomersByName = new Map<string, number>();
      const existingCashBooksByName = new Map<string, number>();
      const existingTemplatesByName = new Map<string, number>();
      if (!overwrite) {
        const [existingCustomers, existingCashBooks, existingTemplates] = await Promise.all([
          tx.customer.findMany({ where: { userId }, select: { id: true, name: true } }),
          tx.cashBook.findMany({ where: { userId }, select: { id: true, name: true } }),
          tx.invoiceTemplate.findMany({ where: { userId }, select: { id: true, name: true } }),
        ]);
        for (const existing of existingCustomers) existingCustomersByName.set(existing.name, existing.id);
        for (const existing of existingCashBooks) existingCashBooksByName.set(existing.name, existing.id);
        for (const existing of existingTemplates) existingTemplatesByName.set(existing.name, existing.id);
      }

      // Supplier identity is source-tenant + source ID, never a display name.
      // Preserve current master data and historical selected snapshots separately.
      for (const supplier of suppliers) {
        const sourceId = supplier.id as number;
        if (!sourceUserId) throw new BackupValidationError('Lieferanten benötigen eine eindeutige Backup-Quellidentität');
        const importKey = supplierImportKey(sourceUserId, sourceId);
        const prior = overwrite ? undefined : existingSupplierImports.get(importKey);
        const targetId = prior?.entityId ? asOptionalInt(prior.entityId, 'supplier.targetId') : !overwrite && sourceUserId === userId ? sourceId : null;
        const existing = targetId === null ? null : await tx.supplier.findFirst({ where: { id: targetId, userId } });
        if (existing) {
          if (supplierFingerprint(supplier) !== supplierFingerprint(existing as unknown as JsonRecord)) throw new BackupValidationError('Lieferanten-Kollision: Quellidentität verweist auf abweichende Stammdaten; bitte separat prüfen');
          supplierMap.set(sourceId, existing.id);
          result.suppliers.skipped += 1;
          continue;
        }
        const created = await tx.supplier.create({ data: {
          userId,
          name: supplier.name as string,
          ...Object.fromEntries(Object.keys(SUPPLIER_CONTACT_LIMITS).filter(field => field !== 'name').map(field => [field, supplier[field] ?? null])),
          revision: supplier.revision as number,
          createdAt: sourceDate(supplier.createdAt, 'supplier.createdAt', true)!,
          updatedAt: sourceDate(supplier.updatedAt, 'supplier.updatedAt', true)!,
        } });
        supplierMap.set(sourceId, created.id);
        result.suppliers.imported += 1;
        await tx.auditLog.create({ data: { userId, action: 'RESTORE', entityType: 'Supplier', entityId: String(created.id), entityName: created.name,
          metadata: JSON.stringify({ backupImport: { importKey, backupId, sourceUserId, sourceEntityType: 'Supplier', sourceEntityId: String(sourceId), targetTenantId: userId, entityMapping: 'mapped' } }),
        } });
      }

      // Resolve exact-source collisions as a whole linked component before
      // importing expenses. Never create an orphan financial row then skip its source.
      if (!overwrite && documents.length > 0) {
        const existingDocuments = await tx.purchaseDocument.findMany({ where: { userId }, include: { expense: { include: { cashTransaction: true } } } });
        for (const source of documents) {
          const requestMatch = existingDocuments.find((item) => item.uploadRequestId === source.uploadRequestId);
          if (requestMatch && requestMatch.originalSha256 !== source.originalSha256) throw new BackupValidationError('Upload-Anfrage eines Eingangsbelegs kollidiert mit anderen Originalbytes');
          const existing = existingDocuments.find((item) => item.originalSha256 === source.originalSha256);
          if (!existing) continue;
          const verified = verifiedExistingOriginals.get(existing.id);
          if (!verified || verified.identity !== purchaseOriginalIdentity(existing as unknown as JsonRecord) || await getBackupFileVersion(verified.path) !== verified.version) throw new BackupValidationError('Bestehendes Eingangsbeleg-Original wurde während der Wiederherstellung verändert; bitte erneut prüfen.');
          if (purchaseSourceFingerprint(source, supplierMap) !== purchaseSourceFingerprint(existing as unknown as JsonRecord)) throw new BackupValidationError('Eingangsbeleg-Kollision: Prüfzustand oder Originalmetadaten unterscheiden sich');
          const sourceExpenseId = asOptionalInt(source.expenseId, 'purchaseDocument.expenseId');
          if (sourceExpenseId !== null) {
            const sourceExpense = expenses.find((expense) => expense.id === sourceExpenseId);
            if (!sourceExpense || !existing.expense || existing.expense.userId !== userId
              || purchaseExpenseFingerprint(sourceExpense) !== purchaseExpenseFingerprint(existing.expense as unknown as JsonRecord)) throw new BackupValidationError('Eingangsbeleg-Kollision: verknüpfte Ausgaben unterscheiden sich');
            // The first source-approval slice has no cash semantics. Existing cash
            // components need a separately reviewed merge rather than duplicate links.
            if (existing.expense.cashTransaction || cashTransactions.some((entry) => entry.expenseId === sourceExpenseId)) throw new BackupValidationError('Eingangsbeleg-Kollision mit verknüpfter Kassenbuchung erfordert gesonderte Prüfung');
            expenseMap.set(sourceExpenseId, existing.expense.id);
            skippedSourceExpenses.add(sourceExpenseId);
          }
          purchaseDocumentMap.set(source.id as number, existing.id);
          result.purchaseDocuments.skipped += 1;
        }
      }

      // Recurring expenses must precede expenses so execution keys survive.
      for (const recurring of recurringExpenses) {
        const sourceId = asOptionalInt(recurring.id, 'recurringExpense.id')!;
        const created = await tx.recurringExpense.create({ data: {
          description: asRequiredString(recurring.description, 'recurringExpense.description', 255),
          amount: asOptionalFinite(recurring.amount, 'recurringExpense.amount') ?? 0,
          category: asOptionalString(recurring.category, 'recurringExpense.category', 255),
          taxRelevant: asOptionalBoolean(recurring.taxRelevant, 'recurringExpense.taxRelevant') ?? true,
          taxDeductiblePercentage: asOptionalFinite(recurring.taxDeductiblePercentage, 'recurringExpense.taxDeductiblePercentage') ?? 100,
          interval: asRequiredString(recurring.interval, 'recurringExpense.interval', 32).toUpperCase(),
          dayOfMonth: asOptionalInt(recurring.dayOfMonth, 'recurringExpense.dayOfMonth') ?? 1,
          startDate: asDate(recurring.startDate, 'recurringExpense.startDate', new Date())!,
          endDate: asDate(recurring.endDate, 'recurringExpense.endDate'),
          lastExecuted: asDate(recurring.lastExecuted, 'recurringExpense.lastExecuted'),
          nextExecution: asDate(recurring.nextExecution, 'recurringExpense.nextExecution', new Date())!,
          isActive: asOptionalBoolean(recurring.isActive, 'recurringExpense.isActive') ?? true,
          createdAt: asDate(recurring.createdAt, 'recurringExpense.createdAt', new Date())!,
          updatedAt: asDate(recurring.updatedAt, 'recurringExpense.updatedAt', new Date())!,
          userId,
        } });
        recurringMap.set(sourceId, created.id);
        result.recurringExpenses.imported += 1;
      }

      for (const customer of customers) {
        const sourceId = asOptionalInt(customer.id, 'customer.id')!;
        const name = asRequiredString(customer.name, 'customer.name', 255);
        const existingId = existingCustomersByName.get(name);
        if (existingId) {
          customerMap.set(sourceId, existingId);
          result.customers.skipped += 1;
        } else {
          const created = await tx.customer.create({ data: {
            name,
            contactPerson: asOptionalString(customer.contactPerson, 'customer.contactPerson', 255),
            email: asOptionalString(customer.email, 'customer.email', 320),
            phone: asOptionalString(customer.phone, 'customer.phone', 64),
            address: asOptionalString(customer.address, 'customer.address', 1_000),
            zipCode: asOptionalString(customer.zipCode, 'customer.zipCode', 32),
            city: asOptionalString(customer.city, 'customer.city', 255),
            taxNumber: asOptionalString(customer.taxNumber, 'customer.taxNumber', 128),
            internalNote: asOptionalString(customer.internalNote, 'customer.internalNote', 5_000),
            noteVisibility: asOptionalString(customer.noteVisibility, 'customer.noteVisibility', 16) ?? 'BOTH',
            createdAt: asDate(customer.createdAt, 'customer.createdAt', new Date())!,
            userId,
          } });
          customerMap.set(sourceId, created.id);
          result.customers.imported += 1;
        }
      }

      for (const invoice of invoices) {
        const sourceId = asOptionalInt(invoice.id, 'invoice.id')!;
        const invoiceNumber = asOptionalString(invoice.invoiceNumber, 'invoice.invoiceNumber', 255);
        const sourcePayment = sourcePaymentByInvoice.get(sourceId);
        const existingPayment = sourcePayment && existingPaymentByKey.get(String(sourcePayment.idempotencyKey));
        const existing = existingPayment
          ? await tx.invoice.findFirst({ where: { id: existingPayment.invoiceId, userId } })
          : invoiceNumber ? await tx.invoice.findFirst({ where: { userId, invoiceNumber } }) : null;
        if (existing && sourcePayment && (existing.type !== invoice.type || existing.invoiceNumber !== invoiceNumber
          || existing.totalAmount !== asOptionalFinite(invoice.totalAmount, 'invoice.totalAmount')
          || existing.status !== invoice.status
          || existing.customerId !== relationMapValue(customerMap, invoice.customerId, 'invoice.customerId')
          || (isRecord(existing.parsedData) && existing.parsedData.currency != null && existing.parsedData.currency !== 'EUR')
          || existing.paidAt?.getTime() !== asDate(invoice.paidAt, 'invoice.paidAt')?.getTime())) {
          throw new BackupValidationError('Die Zielrechnung weicht vom unveränderlichen Zahlungsnachweis ab.');
        }
        if (existing) {
          const importedIssuanceState = restoredIssuanceState(invoice, manifest?.version ?? LEGACY_BACKUP_VERSION, paidInvoiceIds);
          if (issuanceStateRank(importedIssuanceState) > issuanceStateRank(existing.issuanceState)) {
            await tx.invoice.update({ where: { id: existing.id, userId }, data: { issuanceState: importedIssuanceState } });
          }
          invoiceMap.set(sourceId, existing.id);
          result.invoices.skipped += 1;
          continue;
        }
        const sourceName = validateStoredName(invoice.storedFileName, 'invoice.storedFileName') ?? `invoice-${String(sourceId)}`;
        const created = await tx.invoice.create({ data: {
          type: asOptionalString(invoice.type, 'invoice.type', 32) ?? 'INVOICE',
          fileName: asRequiredString(invoice.fileName, 'invoice.fileName', 255),
          storedFileName: fileMap.get(`invoice:${sourceName}`)!,
          invoiceNumber,
          uploadedAt: asDate(invoice.uploadedAt, 'invoice.uploadedAt', new Date())!,
          invoiceDate: asDate(invoice.invoiceDate, 'invoice.invoiceDate'),
          dueDate: asDate(invoice.dueDate, 'invoice.dueDate'),
          validUntil: asDate(invoice.validUntil, 'invoice.validUntil'),
          parsedData: asJson(invoice.parsedData, 'invoice.parsedData'),
          totalAmount: asOptionalFinite(invoice.totalAmount, 'invoice.totalAmount'),
          status: asOptionalString(invoice.status, 'invoice.status', 32) ?? 'DRAFT',
          issuanceState: restoredIssuanceState(invoice, manifest?.version ?? LEGACY_BACKUP_VERSION, paidInvoiceIds),
          paidAt: asDate(invoice.paidAt, 'invoice.paidAt'),
          cancellationReason: asOptionalString(invoice.cancellationReason, 'invoice.cancellationReason', 1_000),
          customerId: relationMapValue(customerMap, invoice.customerId, 'invoice.customerId'),
          userId,
        } });
        usedFiles.add(fileMap.get(`invoice:${sourceName}`)!);
        invoiceMap.set(sourceId, created.id);
        createdInvoiceIds.add(sourceId);
        result.invoices.imported += 1;
      }

      for (const note of billingNotes) {
        const sourceId = asOptionalInt(note.id, 'billingNote.id')!;
        const importKey = billingNoteImportKey(sourceUserId, sourceId);
        const existingImported = overwrite ? undefined : existingBillingNoteImports.get(importKey);
        if (existingImported?.entityId) {
          const existingId = asOptionalInt(existingImported.entityId, `billingNotes[${sourceId}].targetId`);
          const existingNote = existingId === null
            ? null
            : await tx.billingNote.findFirst({ where: { id: existingId, userId }, select: { id: true } });
          if (existingNote) {
            billingNoteMap.set(sourceId, existingNote.id);
            result.billingNotes.skipped += 1;
            continue;
          }
        }
        const customerId = relationMapValue(customerMap, note.customerId, 'billingNote.customerId');
        if (!customerId) throw new BackupValidationError('billingNote.customerId fehlt');
        const invoiceId = relationMapValue(invoiceMap, note.invoiceId, 'billingNote.invoiceId');
        if (invoiceId !== null) {
          const targetInvoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId, type: 'INVOICE' }, select: { customerId: true } });
          if (!targetInvoice || targetInvoice.customerId !== customerId) {
            throw new BackupValidationError('billingNote.invoiceId muss zur angegebenen Kunden-ID gehören');
          }
        }
        const created = await tx.billingNote.create({ data: {
          customerId,
          serviceDate: asBusinessDate(note.serviceDate, 'billingNote.serviceDate'),
          description: asRequiredString(note.description, 'billingNote.description', 500),
          quantity: asBillingQuantity(note.quantity, 'billingNote.quantity'),
          unit: asOptionalString(note.unit, 'billingNote.unit', 100) ?? 'Stunde',
          invoiceId,
          createdAt: asDate(note.createdAt, 'billingNote.createdAt', new Date())!,
          updatedAt: asDate(note.updatedAt, 'billingNote.updatedAt', new Date())!,
          userId,
        } });
        billingNoteMap.set(sourceId, created.id);
        result.billingNotes.imported += 1;
        const provenance = JSON.stringify({ backupImport: {
          importKey,
          backupId,
          sourceUserId: sourceUserId ?? null,
          sourceActorId: sourceUserId ?? null,
          sourceTenantId: sourceUserId ?? null,
          targetTenantId: userId,
          targetUserId: userId,
          sourceNoteId: sourceId,
          sourceEntityType: 'BillingNote',
          sourceEntityId: String(sourceId),
          entityMapping: 'mapped',
        } });
        await tx.auditLog.create({ data: {
          userId,
          action: 'RESTORE',
          entityType: 'BillingNote',
          entityId: String(created.id),
          entityName: asOptionalString(note.description, 'billingNote.description', 500),
          metadata: provenance,
        } });
        existingAuditImportRows.set(importKey, { id: -1, entityId: String(created.id), metadata: provenance });
        existingBillingNoteImports.set(importKey, { id: -1, entityId: String(created.id), metadata: provenance });
      }

      // Self-relations are restored after all invoice IDs are mapped.
      for (const invoice of invoices) {
        const sourceId = asOptionalInt(invoice.id, 'invoice.id')!;
        if (!createdInvoiceIds.has(sourceId)) continue;
        const targetId = invoiceMap.get(sourceId);
        const originalId = relationMapValue(invoiceMap, invoice.originalInvoiceId, 'invoice.originalInvoiceId');
        const convertedFromQuoteId = relationMapValue(invoiceMap, invoice.convertedFromQuoteId, 'invoice.convertedFromQuoteId');
        if (targetId && (originalId || convertedFromQuoteId)) {
          await tx.invoice.update({ where: { id: targetId, userId }, data: {
            ...(originalId ? { originalInvoiceId: originalId } : {}),
            ...(convertedFromQuoteId ? { convertedFromQuoteId } : {}),
          } });
        }
      }

      for (const expense of expenses) {
        const sourceId = asOptionalInt(expense.id, 'expense.id')!;
        if (skippedSourceExpenses.has(sourceId)) { result.expenses.skipped += 1; continue; }
        const created = await tx.expense.create({ data: {
          description: asRequiredString(expense.description, 'expense.description', 255),
          amount: asOptionalFinite(expense.amount, 'expense.amount') ?? 0,
          date: asDate(expense.date, 'expense.date', RESTORE_DEFAULT_DATE)!,
          category: asOptionalString(expense.category, 'expense.category', 255),
          receiptUrl: asOptionalString(expense.receiptUrl, 'expense.receiptUrl', 2_000),
          taxRelevant: asOptionalBoolean(expense.taxRelevant, 'expense.taxRelevant') ?? true,
          taxDeductiblePercentage: asOptionalFinite(expense.taxDeductiblePercentage, 'expense.taxDeductiblePercentage'),
          receiptFileName: asOptionalString(expense.receiptFileName, 'expense.receiptFileName', 255),
            storedReceiptFileName: (() => {
            const sourceName = validateStoredName(expense.storedReceiptFileName, 'expense.storedReceiptFileName');
            return sourceName && !missingFiles.has(`receipt:${sourceName}`)
              ? fileMap.get(`receipt:${sourceName}`)!
              : null;
          })(),
          depreciationYears: asOptionalInt(expense.depreciationYears, 'expense.depreciationYears'),
          recurringExpenseId: relationMapValue(recurringMap, expense.recurringExpenseId, 'expense.recurringExpenseId'),
          scheduledDate: asDate(expense.scheduledDate, 'expense.scheduledDate'),
          userId,
        } });
        const expenseSourceName = validateStoredName(expense.storedReceiptFileName, 'expense.storedReceiptFileName');
        if (expenseSourceName) usedFiles.add(fileMap.get(`receipt:${expenseSourceName}`)!);
        expenseMap.set(sourceId, created.id);
        result.expenses.imported += 1;
      }

      for (const document of documents) {
        const sourceId = document.id as number;
        if (purchaseDocumentMap.has(sourceId)) continue;
        const storedFileName = fileMap.get(`purchase-document:${document.storedFileName}`)!;
        const created = await tx.purchaseDocument.create({ data: {
          userId,
          originalFileName: document.originalFileName as string,
          storedFileName,
          originalSha256: document.originalSha256 as string,
          originalByteCount: document.originalByteCount as number,
          mediaType: document.mediaType as string,
          uploadedAt: sourceDate(document.uploadedAt, 'purchaseDocument.uploadedAt', true)!,
          uploadRequestId: document.uploadRequestId as string,
          parsedData: document.parsedData === null || document.parsedData === undefined ? Prisma.DbNull : asJson(document.parsedData, 'purchaseDocument.parsedData'),
          parseStatus: document.parseStatus as string,
          parserVersion: asOptionalString(document.parserVersion, 'purchaseDocument.parserVersion', 128),
          parseErrorCode: asOptionalString(document.parseErrorCode, 'purchaseDocument.parseErrorCode', 128),
          supplierName: asOptionalString(document.supplierName, 'purchaseDocument.supplierName', 1_000),
          supplierId: relationMapValue(supplierMap, document.supplierId, 'purchaseDocument.supplierId'),
          selectedSupplierSnapshot: document.selectedSupplierSnapshot == null ? Prisma.DbNull : asJson(remapSupplierSnapshot(document.selectedSupplierSnapshot, supplierMap), 'purchaseDocument.selectedSupplierSnapshot'),
          invoiceNumber: asOptionalString(document.invoiceNumber, 'purchaseDocument.invoiceNumber', 255),
          invoiceDate: sourceDate(document.invoiceDate, 'purchaseDocument.invoiceDate'),
          currency: asOptionalString(document.currency, 'purchaseDocument.currency', 3),
          totalAmount: asOptionalFinite(document.totalAmount, 'purchaseDocument.totalAmount'),
          reviewStatus: document.reviewStatus as string,
          revision: document.revision as number,
          expenseId: relationMapValue(expenseMap, document.expenseId, 'purchaseDocument.expenseId'),
          approvalRequestId: asOptionalString(document.approvalRequestId, 'purchaseDocument.approvalRequestId', 36),
          approvalFingerprint: asOptionalString(document.approvalFingerprint, 'purchaseDocument.approvalFingerprint', 64),
          approvedAt: sourceDate(document.approvedAt, 'purchaseDocument.approvedAt'),
          dismissedAt: sourceDate(document.dismissedAt, 'purchaseDocument.dismissedAt'),
          dismissalReason: asOptionalString(document.dismissalReason, 'purchaseDocument.dismissalReason', 2_000),
          updatedAt: sourceDate(document.updatedAt, 'purchaseDocument.updatedAt', true)!,
        } });
        purchaseDocumentMap.set(sourceId, created.id);
        usedFiles.add(storedFileName);
        result.purchaseDocuments.imported += 1;
      }

      for (const income of incomes) {
        const sourceId = asOptionalInt(income.id, 'income.id')!;
        const description = asRequiredString(income.description, 'income.description', 255);
        const amount = asOptionalFinite(income.amount, 'income.amount') ?? 0;
        const date = asDate(income.date, 'income.date', RESTORE_DEFAULT_DATE)!;
        const customerId = relationMapValue(customerMap, income.customerId, 'income.customerId');
        const invoiceId = relationMapValue(invoiceMap, income.invoiceId, 'income.invoiceId');
        const taxRelevant = asOptionalBoolean(income.taxRelevant, 'income.taxRelevant') ?? true;
        const existing = invoiceId === null ? null : await tx.income.findUnique({ where: { invoiceId } });
        const targetPayment = invoiceId === null ? undefined : existingPaymentByInvoice.get(invoiceId);
        // An older backup may have Income but no source journal. The immutable
        // target event still owns its projection contract: never manufacture a
        // new orphan Income or silently attach one to historical null evidence.
        if (targetPayment && (!existing || targetPayment.incomeId !== existing.id)) {
          throw new BackupValidationError(`income.invoiceId ${invoiceId}: Die Zieleinnahme widerspricht dem unveränderlichen Zahlungsereignis. Bitte die historischen Zahlungsnachweise getrennt prüfen.`);
        }
        if (existing) {
          const sameIncome = existing.description === description
            && existing.amount === amount
            && existing.date.getTime() === date.getTime()
            && existing.customerId === customerId
            && existing.taxRelevant === taxRelevant;
          if (!sameIncome) {
            throw new BackupValidationError(`income.invoiceId ${invoiceId} ist bereits mit abweichenden Einnahmedaten verknüpft`);
          }
          incomeMap.set(sourceId, existing.id);
          result.incomes.skipped += 1;
          continue;
        }
        const created = await tx.income.create({ data: {
          description,
          amount,
          date,
          customerId,
          invoiceId,
          taxRelevant,
          userId,
        } });
        incomeMap.set(sourceId, created.id);
        result.incomes.imported += 1;
      }

      for (const [index, event] of paymentJournalEvents.entries()) {
        const label = `paymentJournalEvents[${index}]`;
        const values = paymentEventValues(event, label);
        const invoiceId = relationMapValue(invoiceMap, event.invoiceId, `${label}.invoiceId`)!;
        const incomeId = relationMapValue(incomeMap, event.incomeId, `${label}.incomeId`);
        const targetIncome = await tx.income.findUnique({ where: { invoiceId } });
        if ((targetIncome?.id ?? null) !== incomeId) {
          throw new BackupValidationError(`${label}: vorhandene Zieleinnahme stimmt nicht mit dem Zahlungsbezug überein`);
        }
        const existing = existingPaymentByKey.get(values.idempotencyKey)
          ?? await tx.paymentJournalEvent.findFirst({ where: { userId, invoiceId } });
        if (existing) {
          if (existing.invoiceId !== invoiceId || existing.incomeId !== incomeId
            || existing.idempotencyKey !== values.idempotencyKey || existing.amountCents !== values.amountCents
            || existing.currency !== values.currency || existing.source !== values.source
            || existing.dateCertainty !== values.dateCertainty || existing.reference !== values.reference
            || existing.paidAt?.getTime() !== values.paidAt?.getTime()
            || existing.createdAt.getTime() !== values.createdAt.getTime()) {
            throw new BackupValidationError(`${label}: Kollision mit abweichendem unveränderlichem Zahlungsereignis`);
          }
          paymentJournalMap.set(asOptionalInt(event.id, `${label}.id`)!, existing.id);
          result.paymentJournalEvents.skipped += 1;
          continue;
        }
        const created = await tx.paymentJournalEvent.create({ data: { ...values, userId, invoiceId, incomeId } });
        paymentJournalMap.set(asOptionalInt(event.id, `${label}.id`)!, created.id);
        result.paymentJournalEvents.imported += 1;
        await createFinancialAuditLog({
          userId, action: 'RESTORE', entityType: 'Invoice', entityId: invoiceId,
          newValues: { paymentJournalEventId: created.id, amountCents: created.amountCents, paidAt: created.paidAt,
            dateCertainty: created.dateCertainty, incomeId: created.incomeId, sourceEventId: event.id },
          metadata: { actorId: userId, tenantId: userId, operation: 'payment-journal.restore',
            originalReference: `backup:${backupId}:payment:${String(event.id)}`,
            reason: 'Unveränderliches Zahlungsereignis mit ursprünglichem Datumsnachweis wiederhergestellt.' },
        }, tx);
      }

      if (settings) {
        const mappedLogo = sourceLogo && !missingFiles.has(`logo:${sourceLogo}`)
          ? fileMap.get(`logo:${sourceLogo}`)
          : null;
        const settingData = {
          ...fiscalProfileForRestore(settings),
          companyName: asOptionalString(settings.companyName, 'settings.companyName', 255),
          companyAddress: asOptionalString(settings.companyAddress, 'settings.companyAddress', 2_000),
          email: asOptionalString(settings.email, 'settings.email', 320),
          telephone: asOptionalString(settings.telephone, 'settings.telephone', 64),
          taxNumber: asOptionalString(settings.taxNumber, 'settings.taxNumber', 128),
          bankName: asOptionalString(settings.bankName, 'settings.bankName', 255),
          iban: asOptionalString(settings.iban, 'settings.iban', 64),
          bic: asOptionalString(settings.bic, 'settings.bic', 32),
          footerText: asOptionalString(settings.footerText, 'settings.footerText', 5_000),
          logoUrl: mappedLogo ? `/api/files/logo?file=${encodeURIComponent(mappedLogo)}` : null,
          allowedOrigins: asOptionalString(settings.allowedOrigins, 'settings.allowedOrigins', 10_000),
        };
        const restoredSettings = await tx.settings.upsert({ where: { userId }, update: settingData, create: { userId, ...settingData } });
        const sourceSettingsId = asOptionalInt(settings.id, 'settings.id');
        if (sourceSettingsId !== null) settingsMap.set(sourceSettingsId, restoredSettings.id);
        if (mappedLogo) usedFiles.add(mappedLogo);
        result.settings.imported = true;
      }

      for (const template of templates) {
        const sourceId = asOptionalInt(template.id, 'template.id');
        const name = asRequiredString(template.name, 'template.name', 255);
        const existingId = existingTemplatesByName.get(name);
        if (existingId) {
          if (sourceId !== null) templateMap.set(sourceId, existingId);
          result.templates.skipped += 1;
        }
        else {
          const created = await tx.invoiceTemplate.create({ data: {
            name,
            data: asJson(template.data, 'template.data'),
            createdAt: asDate(template.createdAt, 'template.createdAt', new Date())!,
            updatedAt: asDate(template.updatedAt, 'template.updatedAt', new Date())!,
            userId,
          } });
          if (sourceId !== null) templateMap.set(sourceId, created.id);
          result.templates.imported += 1;
        }
      }

      for (const reminder of reminders) {
        const sourceId = asOptionalInt(reminder.id, 'reminder.id');
        const invoiceId = relationMapValue(invoiceMap, reminder.invoiceId, 'reminder.invoiceId');
        if (!invoiceId) throw new BackupValidationError('reminder.invoiceId fehlt');
        const created = await tx.reminder.create({ data: {
          invoiceId,
          reminderLevel: asOptionalInt(reminder.reminderLevel, 'reminder.reminderLevel') ?? 1,
          sentAt: asDate(reminder.sentAt, 'reminder.sentAt', new Date())!,
          dueDate: asDate(reminder.dueDate, 'reminder.dueDate', new Date())!,
          fee: asOptionalFinite(reminder.fee, 'reminder.fee') ?? 0,
          notes: asOptionalString(reminder.notes, 'reminder.notes', 5_000),
          createdAt: asDate(reminder.createdAt, 'reminder.createdAt', new Date())!,
          userId,
        } });
        if (sourceId !== null) reminderMap.set(sourceId, created.id);
        result.reminders.imported += 1;
      }

      for (const cashBook of cashBooks) {
        const sourceId = asOptionalInt(cashBook.id, 'cashBook.id')!;
        const name = asRequiredString(cashBook.name, 'cashBook.name', 255);
        const existingId = existingCashBooksByName.get(name);
        if (existingId) {
          cashBookMap.set(sourceId, existingId);
          result.cashBooks.skipped += 1;
        } else {
          const created = await tx.cashBook.create({ data: {
            name,
            description: asOptionalString(cashBook.description, 'cashBook.description', 2_000),
            initialBalance: asOptionalFinite(cashBook.initialBalance, 'cashBook.initialBalance') ?? 0,
            currency: asOptionalString(cashBook.currency, 'cashBook.currency', 8) ?? 'EUR',
            isActive: asOptionalBoolean(cashBook.isActive, 'cashBook.isActive') ?? true,
            createdAt: asDate(cashBook.createdAt, 'cashBook.createdAt', new Date())!,
            updatedAt: asDate(cashBook.updatedAt, 'cashBook.updatedAt', new Date())!,
            userId,
          } });
          cashBookMap.set(sourceId, created.id);
          result.cashBooks.imported += 1;
        }
      }

      for (const transaction of orderedCashTransactions) {
        const sourceId = asOptionalInt(transaction.id, 'cashTransaction.id');
        const cashBookId = relationMapValue(cashBookMap, transaction.cashBookId, 'cashTransaction.cashBookId');
        if (!cashBookId) throw new BackupValidationError('cashTransaction.cashBookId fehlt');
        const created = await tx.cashTransaction.create({ data: {
          date: asDate(transaction.date, 'cashTransaction.date', new Date(0))!,
          createdAt: asDate(transaction.createdAt, 'cashTransaction.createdAt', new Date(0))!,
          updatedAt: asDate(transaction.updatedAt, 'cashTransaction.updatedAt', new Date())!,
          type: asRequiredString(transaction.type, 'cashTransaction.type', 32),
          description: asRequiredString(transaction.description, 'cashTransaction.description', 255),
          amount: asOptionalFinite(transaction.amount, 'cashTransaction.amount') ?? 0,
          runningBalance: asOptionalFinite(transaction.runningBalance, 'cashTransaction.runningBalance') ?? 0,
          category: asOptionalString(transaction.category, 'cashTransaction.category', 255),
          receiptNumber: asOptionalString(transaction.receiptNumber, 'cashTransaction.receiptNumber', 255),
          taxRelevant: asOptionalBoolean(transaction.taxRelevant, 'cashTransaction.taxRelevant') ?? true,
          notes: asOptionalString(transaction.notes, 'cashTransaction.notes', 5_000),
          cashBookId,
          expenseId: relationMapValue(expenseMap, transaction.expenseId, 'cashTransaction.expenseId'),
          incomeId: relationMapValue(incomeMap, transaction.incomeId, 'cashTransaction.incomeId'),
          userId,
        } });
        if (sourceId !== null) cashTransactionMap.set(sourceId, created.id);
        result.cashTransactions.imported += 1;
      }

      const importedCashBookIds = new Set(cashBookMap.values());
      for (const cashBookId of importedCashBookIds) {
        try {
          await recalculateCashBalances(tx, cashBookId, userId);
        } catch (error) {
          if (error instanceof CashbookError) throw new BackupValidationError(error.message);
          throw error;
        }
      }

      for (const doc of documentations) {
        const sourceId = asOptionalInt(doc.id, 'documentation.id');
        const created = await tx.documentation.create({ data: {
          version: asRequiredString(doc.version, 'documentation.version', 64),
          title: asOptionalString(doc.title, 'documentation.title', 255) ?? 'Verfahrensdokumentation',
          content: asRequiredString(doc.content, 'documentation.content', 2_000_000),
          createdAt: asDate(doc.createdAt, 'documentation.createdAt', new Date())!,
          updatedAt: asDate(doc.updatedAt, 'documentation.updatedAt', new Date())!,
          userId,
        } });
        if (sourceId !== null) documentationMap.set(sourceId, created.id);
        result.documentations.imported += 1;
      }

      const restoredCounterValues: CounterValueMap = new Map(preservedCounterValues);
      for (const counter of invoiceNumberCounters) {
        addCounterValue(
          restoredCounterValues,
          asRequiredString(counter.type, 'invoiceNumberCounter.type', 32),
          asOptionalInt(counter.year, 'invoiceNumberCounter.year')!,
          asOptionalInt(counter.value, 'invoiceNumberCounter.value')!,
        );
      }
      const importedInvoiceHistory = invoices.map((invoice) => ({
        type: asOptionalString(invoice.type, 'invoice.type', 32) ?? 'INVOICE',
        invoiceNumber: asOptionalString(invoice.invoiceNumber, 'invoice.invoiceNumber', 255),
      }));
      for (const [key, value] of historicalCounterValues(importedInvoiceHistory).entries()) {
        const separator = key.lastIndexOf(':');
        addCounterValue(restoredCounterValues, key.slice(0, separator), Number(key.slice(separator + 1)), value);
      }
      const importedCounterKeys = new Set(invoiceNumberCounters.map((counter) => counterKey(String(counter.type), Number(counter.year))));
      for (const [key, value] of restoredCounterValues.entries()) {
        const separator = key.lastIndexOf(':');
        const type = key.slice(0, separator);
        const year = Number(key.slice(separator + 1));
        const existingValue = preservedCounterValues.get(key) ?? 0;
        await tx.invoiceNumberCounter.upsert({
          where: { userId_type_year: { userId, type, year } },
          create: { userId, type, year, value },
          update: { value },
        });
        if (importedCounterKeys.has(key) && value > existingValue) result.invoiceNumberCounters.imported += 1;
        else if (importedCounterKeys.has(key)) result.invoiceNumberCounters.skipped += 1;
      }

      const auditMaps = {
        userId,
        sourceUserId,
        customers: customerMap,
        suppliers: supplierMap,
        billingNotes: billingNoteMap,
        expenses: expenseMap,
        incomes: incomeMap,
        paymentJournalEvents: paymentJournalMap,
        invoices: invoiceMap,
        purchaseDocuments: purchaseDocumentMap,
        recurringExpenses: recurringMap,
        reminders: reminderMap,
        cashBooks: cashBookMap,
        cashTransactions: cashTransactionMap,
        templates: templateMap,
        documentations: documentationMap,
        settings: settingsMap,
      };
      for (const [index, audit] of auditLogs.entries()) {
        const sanitizedAudit = redactAuditLog({ ...audit });
        const sourceAuditId = asOptionalInt(sanitizedAudit.id, `auditLogs[${index}].id`);
        const auditSourceUserId = typeof sanitizedAudit.userId === 'string' ? sanitizedAudit.userId : sourceUserId;
        const importKey = auditImportKey(backupId, auditSourceUserId, sourceAuditId, index);
        const sourceEntityId = asOptionalString(sanitizedAudit.entityId, `auditLogs[${index}].entityId`, 255);
        const sourceEntityType = asRequiredString(sanitizedAudit.entityType, `auditLogs[${index}].entityType`, 64);
        const mapped = mapAuditEntityId(sourceEntityType, sourceEntityId, auditMaps);
        const existingImported = existingAuditImportRows.get(importKey);
        if (existingImported) {
          result.auditLogs.skipped += 1;
          if (existingImported.entityId !== mapped.entityId) {
            // Audit rows are append-only.  An overwrite creates new target
            // IDs, so retain the original imported row and append a mapping
            // event that records the previous and current target references.
            const mappingImportKey = `${importKey}:mapping:${mapped.entityId ?? 'unresolved'}`;
            if (!existingAuditImportRows.has(mappingImportKey)) {
              const mappingProvenance = {
                importKey: mappingImportKey,
                sourceImportKey: importKey,
                backupId,
                sourceUserId: auditSourceUserId ?? null,
                sourceActorId: auditSourceUserId ?? null,
                sourceTenantId: sourceUserId ?? null,
                targetTenantId: userId,
                targetUserId: userId,
                sourceAuditId,
                sourceEntityType,
                sourceEntityId,
                entityMapping: mapped.state,
                mappingEvent: true,
                previousTargetEntityId: existingImported.entityId,
                targetEntityId: mapped.entityId,
                ...(mapped.state === 'unresolved' ? { unresolvedReference: true } : {}),
              };
              const mappingMetadata = JSON.stringify({ backupImport: mappingProvenance });
              await tx.auditLog.create({ data: {
                userId,
                action: 'RESTORE',
                entityType: sourceEntityType,
                entityId: mapped.entityId,
                entityName: asOptionalString(sanitizedAudit.entityName, `auditLogs[${index}].entityName`, 1_000),
                oldValues: JSON.stringify({ entityId: existingImported.entityId, importKey }),
                newValues: JSON.stringify({ entityId: mapped.entityId, importKey }),
                changedFields: JSON.stringify(['entityId']),
                metadata: mappingMetadata,
                createdAt: new Date(),
              } });
              existingAuditImportRows.set(mappingImportKey, { id: -1, entityId: mapped.entityId, metadata: mappingMetadata });
              result.auditLogs.imported += 1;
            }
          }
          continue;
        }
        const sourceMetadata = typeof sanitizedAudit.metadata === 'string' ? sanitizedAudit.metadata : null;
        const provenance = {
          importKey,
          backupId,
          sourceUserId: auditSourceUserId ?? null,
          sourceActorId: auditSourceUserId ?? null,
          sourceTenantId: sourceUserId ?? null,
          targetTenantId: userId,
          targetUserId: userId,
          sourceAuditId,
          sourceEntityType,
          sourceEntityId,
          entityMapping: mapped.state,
          ...(mapped.state === 'unresolved' ? { unresolvedReference: true } : {}),
        };
        const metadata = JSON.stringify({
          ...(parseObject(sourceMetadata) ?? (sourceMetadata ? { sourceMetadata } : {})),
          backupImport: provenance,
        });
        await tx.auditLog.create({ data: {
          userId,
          action: asRequiredString(sanitizedAudit.action, `auditLogs[${index}].action`, 64),
          entityType: sourceEntityType,
          entityId: mapped.entityId,
          entityName: asOptionalString(sanitizedAudit.entityName, `auditLogs[${index}].entityName`, 1_000),
          oldValues: asOptionalString(sanitizedAudit.oldValues, `auditLogs[${index}].oldValues`, 2_000_000),
          newValues: asOptionalString(sanitizedAudit.newValues, `auditLogs[${index}].newValues`, 2_000_000),
          changedFields: asOptionalString(sanitizedAudit.changedFields, `auditLogs[${index}].changedFields`, 100_000),
          ipAddress: asOptionalString(sanitizedAudit.ipAddress, `auditLogs[${index}].ipAddress`, 255),
          userAgent: asOptionalString(sanitizedAudit.userAgent, `auditLogs[${index}].userAgent`, 500),
          sessionId: asOptionalString(sanitizedAudit.sessionId, `auditLogs[${index}].sessionId`, 255),
          metadata,
          createdAt: asDate(sanitizedAudit.createdAt, `auditLogs[${index}].createdAt`, new Date())!,
        } });
        existingAuditImportRows.set(importKey, { id: -1, entityId: mapped.entityId, metadata });
        result.auditLogs.imported += 1;
      }

      await createFinancialAuditLog({
        userId,
        action: 'RESTORE',
        entityType: 'Backup',
        entityId: backupId,
        entityName: 'Backup-Restore',
        metadata: {
          actorId: userId,
          tenantId: userId,
          operation: overwrite ? 'backup.restore.overwrite' : 'backup.restore.merge',
          originalReference: manifest
            ? `backup:${backupId}:source-user:${manifest.sourceUserId}`
            : 'legacy-v2',
          reason: manifest
            ? `Version ${manifest.version} wiederhergestellt; Auditsegment angehängt und Nummernzähler per Maximum zusammengeführt.`
            : 'Legacy-Backup 2.0 wiederhergestellt; Vollständigkeit und historische High-Water-Marks sind nicht nachgewiesen.',
        },
      }, tx);
    }, { maxWait: 15_000, timeout: 120_000 });

    for (const storedName of stagedFiles) {
      if (!usedFiles.has(storedName)) {
        try { await removeUnreferencedStage(storedName); } catch { /* leave safe orphan on an uncertain reference check */ }
        result.files.imported = Math.max(0, result.files.imported - 1);
        result.files.skipped += 1;
      }
    }
    return result;
  } catch (error) {
    for (const storedName of stagedFiles) {
      try { await removeUnreferencedStage(storedName); } catch { /* rollback cleanup is best effort; never remove a referenced file */ }
    }
    throw error;
  }
}
