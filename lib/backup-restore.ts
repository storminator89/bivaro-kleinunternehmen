import { validationReportsFromBackup, restoreValidationReports } from '@/lib/purchase-documents/validation-backup';
import { validatePaymentAdjustmentBackup, paymentAdjustmentValues, sameAdjustmentEvidence } from '@/lib/payment-adjustment-backup';
import { validateReminderBackupFields, restoredReminderKey } from '@/lib/reminder-backup';
import { isUnrenderedServiceBillingDraft } from '@/lib/service-billing';
import { sameServiceBillingInvoice, validateServiceBillingBackup } from '@/lib/service-billing-backup';
import { annualContextAppendAfter, readAnnualContextRevision, validateAnnualContextHistory } from '@/lib/annual-business-context';
import { CUSTOMER_FIELD_LIMITS, customerBusinessIdentity } from '@/lib/customer-field-contract';
import { readServiceArticle, serviceArticleNameKey } from '@/lib/service-articles';
import { serviceCaptureFingerprint } from '@/lib/service-capture';
import { QUOTE_WORKFLOW_SCHEMAS } from '@/lib/backup-manifest';
import { parseQuoteWorkflowUpdate } from '@/lib/quote-workflow';
import { formatMoneyEUR, parseMoneyEUR } from '@/lib/money';
import { EMPTY_FISCAL_PROFILE, validateFiscalProfileInput } from '@/lib/fiscal-profile';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { readFile } from 'fs/promises';
import { isPhotoMedia, type ManualPhotoSnapshot } from '@/lib/purchase-documents/manual-photo-contract';
import { stableManualPhotoSnapshot, validateManualPhotoSnapshot } from '@/lib/purchase-documents/manual-photo-review';
import { validateAiExtractionState, validateAiDraftProvenance } from '@/lib/purchase-documents/ai-validation';
import { restoredAiExtractionState, validateAiApprovedSnapshot } from '@/lib/purchase-documents/ai-provenance';
import { parsePurchaseReviewDraft } from '@/lib/purchase-documents/review-draft';
import { originalByteLimit, purchaseOriginalName, detectPurchaseContainer, readPurchaseOriginal } from '@/lib/purchase-documents/original';
import { getBackupFileVersion } from '@/lib/backup-snapshot';
import { ProcessingCapacityError, withProcessingSlot } from '@/lib/processing-limit';
import { CashbookError, recalculateCashBalances } from '@/lib/cashbook-service';
import { documentNumberPrefix, maximumDocumentSequence, type DocumentType } from '@/lib/invoice-numbers';
import { validateRecurringValues } from '@/lib/recurring-schedule';
import {
  CURRENT_BACKUP_VERSION,
  CURRENT_SCHEMA_VERSION,
  backupSchemaSupportsReminderBalance,
  backupSchemaSupportsPurchaseValidation,
  backupSchemaSupportsServiceBilling,
  backupSchemaSupportsProjectServiceTimes,
  validateProjectServiceBackupFields,
  FULL_PAYMENT_JOURNAL_SCHEMA_VERSION,
  LEGACY_BACKUP_VERSION,
  manifestWarning,
  hashBytes,
  hashJson,
  redactAuditLog,
  validateBackupManifest,
  validatePurchaseDocumentBackupFields,
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
  serviceArticles: { imported: number; skipped: number };
  serviceProjects: { imported: number; skipped: number };
  billingNotes: { imported: number; skipped: number };
  expenses: { imported: number; skipped: number };
  incomes: { imported: number; skipped: number };
  paymentJournalEvents: { imported: number; skipped: number };
  paymentAdjustments: { imported: number; skipped: number };
  paymentOperations: { imported: number; skipped: number };
  annualBusinessContextRevisions: { imported: number; skipped: number };
  invoices: { imported: number; skipped: number };
  purchaseDocuments: { imported: number; skipped: number };
  templates: { imported: number; skipped: number };
  files: { imported: number; skipped: number };
  settings: { imported: boolean };
  recurringExpenses: { imported: number; skipped: number };
  serviceBillingPlans: { imported: number; skipped: number };
  serviceBillingPeriods: { imported: number; skipped: number };
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
  'customers', 'suppliers', 'serviceArticles', 'expenses', 'incomes', 'paymentJournalEvents', 'paymentAdjustments', 'paymentOperations', 'invoices', 'purchaseDocuments', 'templates',
  'serviceProjects', 'billingNotes', 'recurringExpenses', 'reminders', 'cashBooks', 'cashTransactions',
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
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
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

  for (const [index, project] of asArray(data, 'serviceProjects').entries()) {
    check(project.customerId, 'customers', `serviceProjects[${index}].customerId`);
  }
  for (const [index, note] of asArray(data, 'billingNotes').entries()) {
    check(note.projectId, 'serviceProjects', `billingNotes[${index}].projectId`);
    if (note.projectId != null) {
      const project = asArray(data, 'serviceProjects').find(candidate => candidate.id === note.projectId);
      if (project?.customerId !== note.customerId) throw new BackupValidationError(`billingNotes[${index}].projectId muss zur angegebenen Kunden-ID gehören`);
    }
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
  const journalInvoiceIds = new Set(asArray(data, 'paymentJournalEvents').map((event) => asOptionalInt(event.invoiceId, 'payment.invoiceId')));
  const incomeByInvoice = new Map<number, number>();
  for (const [index, income] of incomes.entries()) {
    const invoiceId = asOptionalInt(income.invoiceId, `incomes[${index}].invoiceId`);
    if (invoiceId === null || journalInvoiceIds.has(invoiceId)) continue;
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

function groupByInvoice<T>(rows: readonly T[], invoiceId: (row: T) => number | null): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const id = invoiceId(row);
    if (id === null) continue;
    const group = grouped.get(id) ?? [];
    group.push(row);
    grouped.set(id, group);
  }
  return grouped;
}

function validatePaymentJournalBackup(data: JsonRecord, version: string, schemaVersion?: string): void {
  const events = asArray(data, 'paymentJournalEvents');
  if (version === LEGACY_BACKUP_VERSION && events.length) {
    throw new BackupValidationError('Legacy-Backups ohne Manifest dürfen keine Zahlungsereignisse enthalten');
  }
  const sourceUserId = isRecord(data.user) ? data.user.id : undefined;
  const invoices = new Map(asArray(data, 'invoices').map((row) => [asOptionalInt(row.id, 'invoice.id'), row]));
  const incomes = new Map(asArray(data, 'incomes').map((row) => [asOptionalInt(row.id, 'income.id'), row]));
  const incomesByInvoice = groupByInvoice([...incomes.values()], (row) => asOptionalInt(row.invoiceId, 'income.invoiceId'));
  const eventsByInvoice = groupByInvoice(events, (row) => asOptionalInt(row.invoiceId, 'payment.invoiceId'));
  const incomeIds = new Set<number>();
  const keys = new Set<string>();
  for (const [index, event] of events.entries()) {
    const label = `paymentJournalEvents[${index}]`;
    const values = paymentEventValues(event, label);
    const invoiceId = asOptionalInt(event.invoiceId, `${label}.invoiceId`);
    const incomeId = asOptionalInt(event.incomeId, `${label}.incomeId`);
    const invoice = invoiceId === null ? undefined : invoices.get(invoiceId);
    const income = incomeId === null ? undefined : incomes.get(incomeId);
    if (!invoice || invoiceId === null || keys.has(values.idempotencyKey)) {
      throw new BackupValidationError(`${label}: Rechnungsbezug oder Idempotenzschlüssel fehlt oder ist doppelt`);
    }
    keys.add(values.idempotencyKey);
    if (invoice.type !== 'INVOICE' || !['SENT', 'PAID', 'CANCELLED'].includes(String(invoice.status))) {
      throw new BackupValidationError(`${label}: Zahlungsereignis erfordert eine versandte, bezahlte oder stornierte Rechnung`);
    }
    for (const row of [event, invoice, income]) {
      if (row?.userId !== undefined && row.userId !== sourceUserId) {
        throw new BackupValidationError(`${label}: Zahlungsbezug gehört nicht zum Quellmandanten`);
      }
    }
    try {
      if (income && parseMoneyEUR(asOptionalFinite(income.amount, 'income.amount') ?? NaN).toString() !== values.amountCents) throw new Error('amount');
    } catch { throw new BackupValidationError(`${label}: Zahlungsbetrag stimmt nicht mit Rechnung/Einnahme überein`); }
    const parsed = isRecord(invoice.parsedData) ? invoice.parsedData : {};
    if (parsed.currency !== undefined && parsed.currency !== null && parsed.currency !== 'EUR') {
      throw new BackupValidationError(`${label}: Fremdwährungszahlungen werden nicht unterstützt`);
    }
    if (incomeId !== null && (!income || incomeIds.has(incomeId) || asOptionalInt(income.invoiceId, 'income.invoiceId') !== invoiceId
      || asOptionalInt(income.customerId, 'income.customerId') !== asOptionalInt(invoice.customerId, 'invoice.customerId'))) {
      throw new BackupValidationError(`${label}: Einnahmebezug fehlt, ist doppelt oder gehört zu einer anderen Rechnung/einem anderen Kunden`);
    }
    if (incomeId !== null) incomeIds.add(incomeId);
    if ((values.dateCertainty === 'ACTUAL' && !income)
      || (['UNKNOWN', 'LEGACY_INVOICE'].includes(values.dateCertainty) && income)
      || (values.dateCertainty === 'LEGACY_INCOME' && !income)) {
      throw new BackupValidationError(`${label}: Einnahme und historischer Datumsnachweis widersprechen sich`);
    }
    if (income && asDate(income.date, 'income.date')?.getTime() !== values.paidAt?.getTime()) {
      throw new BackupValidationError(`${label}: Zahlungsdatum stimmt nicht mit der verknüpften Einnahme überein`);
    }
    if (values.dateCertainty === 'LEGACY_INVOICE'
      && asDate(invoice.paidAt, 'invoice.paidAt')?.getTime() !== values.paidAt?.getTime()) {
      throw new BackupValidationError(`${label}: Zahlungsdatum stimmt nicht mit dem Rechnungsnachweis überein`);
    }
  }
  for (const [invoiceId, allocations] of eventsByInvoice) {
    const invoice = invoices.get(invoiceId)!;
    if (schemaVersion === FULL_PAYMENT_JOURNAL_SCHEMA_VERSION && allocations.length !== 1) {
      throw new BackupValidationError('Das Vollzahlungs-Backup-Schema unterstützt keine mehreren Zahlungsereignisse je Rechnung');
    }
    let total: bigint;
    try { total = parseMoneyEUR(asOptionalFinite(invoice.totalAmount, 'invoice.totalAmount') ?? NaN); }
    catch { throw new BackupValidationError('Zahlungsbetrag erfordert einen exakten Rechnungsbetrag'); }
    const invoiceAdjustments = asArray(data, 'paymentAdjustments').filter(row => row.invoiceId === invoiceId);
    const corrected = invoiceAdjustments.filter(row => row.kind === 'PAYMENT_CORRECTION').reduce((sum, row) => sum + BigInt(String(row.amountCents)), BigInt(0));
    const paid = allocations.reduce((sum, event) => sum + BigInt(String(event.amountCents)), BigInt(0)) - corrected;
    const historical = allocations.some((event) => event.dateCertainty !== 'ACTUAL');
    if (schemaVersion === FULL_PAYMENT_JOURNAL_SCHEMA_VERSION && paid !== total) {
      throw new BackupValidationError('Das Vollzahlungs-Backup-Schema erfordert den vollständigen Zahlungsbetrag');
    }
    if (allocations.some((event) => event.dateCertainty === 'UNKNOWN') && asDate(invoice.paidAt, 'invoice.paidAt') !== null) {
      throw new BackupValidationError('Unbekannter historischer Zahlungsnachweis darf kein Rechnungszahlungsdatum vortäuschen');
    }
    if (total <= BigInt(0) || paid > total || (historical && (allocations.length !== 1 || paid !== total))) {
      throw new BackupValidationError('Zahlungsbetrag überschreitet die Rechnung oder vermischt historische Vollzahlung mit Teilzahlungen');
    }
    if ((incomesByInvoice.get(invoiceId) ?? []).some((income) => !incomeIds.has(asOptionalInt(income.id, 'income.id')!))) {
      throw new BackupValidationError('Vorhandene Rechnungseinnahme muss mit genau einem Zahlungsereignis verknüpft sein');
    }
    if ((invoice.status === 'PAID' && paid !== total) || (invoice.status === 'SENT' && paid === total)) {
      throw new BackupValidationError('Rechnungsstatus stimmt nicht mit dem gesamten Zahlungsbetrag überein');
    }
    if (!historical) {
      if (invoice.issuanceState !== 'ISSUED') throw new BackupValidationError('Tatsächliche Zahlungen erfordern eine ausgestellte Rechnung');
      const residual = allocations.filter(root => BigInt(String(root.amountCents)) > invoiceAdjustments.filter(row => row.originalPaymentId === root.id && row.kind === 'PAYMENT_CORRECTION').reduce((sum, row) => sum + BigInt(String(row.amountCents)), BigInt(0)));
      const expectedPaidAt = paid === total
        ? residual.reduce((latest, event) => Math.max(latest, asDate(event.paidAt, 'payment.paidAt')!.getTime()), -Infinity) : null;
      if (invoice.status !== 'CANCELLED' && (asDate(invoice.paidAt, 'invoice.paidAt')?.getTime() ?? null) !== expectedPaidAt) {
        throw new BackupValidationError('Rechnungszahlungsdatum stimmt nicht mit dem letzten tatsächlichen Zahlungsnachweis überein');
      }
    }
  }
}

/** Event identity is the tenant-scoped idempotency key, never invoice/amount/date. */
function samePaymentEvidence(target: JsonRecord, source: JsonRecord): boolean {
  const left = paymentEventValues(target, 'targetPayment');
  const right = paymentEventValues(source, 'sourcePayment');
  return left.idempotencyKey === right.idempotencyKey && left.amountCents === right.amountCents
    && left.currency === right.currency && left.source === right.source
    && left.dateCertainty === right.dateCertainty && left.reference === right.reference
    && left.paidAt?.getTime() === right.paidAt?.getTime()
    && left.createdAt.getTime() === right.createdAt.getTime()
    && (target.incomeId == null) === (source.incomeId == null);
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
    try { validatePurchaseDocumentBackupFields(document, label, manifest?.schemaVersion); }
    catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : `${label}: Nicht unterstützte Eingangsbelegdaten`); }
    if (document.userId !== undefined && document.userId !== sourceUserId) throw new BackupValidationError(`${label}.userId gehört nicht zum Quellmandanten`);
    try {
      const aiState = document.aiExtraction == null ? null : validateAiExtractionState(document.aiExtraction, String(document.originalSha256));
      if (document.aiDraftProvenance != null) validateAiDraftProvenance(document.aiDraftProvenance, aiState, String(document.originalSha256));
      validateAiApprovedSnapshot(document.aiApprovedSnapshot, { aiExtraction: document.aiExtraction, aiDraftProvenance: document.aiDraftProvenance, originalSha256: String(document.originalSha256), reviewDraft: document.reviewDraft, reviewStatus: document.reviewStatus });
    } catch { throw new BackupValidationError(`${label}: KI-Herkunft ist ungültig oder ungebunden`); }
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
    if (!['application/pdf', 'application/xml', 'image/jpeg', 'image/png'].includes(media)) throw new BackupValidationError(`${label}.mediaType ist ungültig`);
    if (!(document.storedFileName as string).endsWith(purchaseOriginalName(media).slice('original'.length))) throw new BackupValidationError(`${label}.storedFileName entspricht nicht dem Medientyp`);
    const bytes = asOptionalInt(document.originalByteCount, `${label}.originalByteCount`);
    if (typeof document.originalByteCount !== 'number' || bytes === null || bytes <= 0 || bytes > originalByteLimit(media)) {
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
    const draftDate = sourceDate(document.reviewDraftSavedAt, `${label}.reviewDraftSavedAt`);
    if ((document.reviewDraft != null) !== (draftDate !== null)) throw new BackupValidationError(`${label}: Prüfentwurf und Speicherzeitpunkt müssen zusammen vorliegen`);
    if (document.reviewDraft != null) {
      try { const draft = parsePurchaseReviewDraft(document.reviewDraft); if (hashJson(draft) !== hashJson(document.reviewDraft)) throw new Error(); }
      catch { throw new BackupValidationError(`${label}.reviewDraft ist ungültig`); }
    }
    if (media.startsWith('image/') && (document.parseStatus === 'PARSED' || (document.parseStatus === 'FAILED' && parseErrorCode !== 'PHOTO_MANUAL_REVIEW'))) throw new BackupValidationError(`${label}: Fotos dürfen keine vorgetäuschte Extraktion enthalten`);
    const supplierId = asOptionalInt(document.supplierId, `${label}.supplierId`);
    const snapshot = document.selectedSupplierSnapshot == null ? null : asRecord(document.selectedSupplierSnapshot, `${label}.selectedSupplierSnapshot`);
    if ((supplierId === null) !== (snapshot === null) || (supplierId !== null && (!suppliers.has(supplierId) || typeof document.supplierId !== 'number'))) throw new BackupValidationError(`${label}.supplierId enthält keine eindeutige Lieferantenzuordnung`);
    if (snapshot) {
      validateSupplierContact(snapshot, `${label}.selectedSupplierSnapshot`);
      if (snapshot.id !== supplierId || Object.keys(snapshot).some((key) => !['id', 'revision', ...Object.keys(SUPPLIER_CONTACT_LIMITS)].includes(key))) throw new BackupValidationError(`${label}.selectedSupplierSnapshot entspricht nicht der Lieferantenzuordnung`);
    }
    if (document.reviewedSourceSnapshot != null && (!isPhotoMedia(media) || document.reviewStatus !== 'BOOKED')) throw new BackupValidationError(`${label}: Manueller Foto-Snapshot darf nur bei freigegebenen Fotos vorliegen`);
    const expenseId = asOptionalInt(document.expenseId, `${label}.expenseId`);
    const approvedAt = sourceDate(document.approvedAt, `${label}.approvedAt`);
    const approvalRequestId = asOptionalString(document.approvalRequestId, `${label}.approvalRequestId`, 36);
    const approvalFingerprint = asOptionalString(document.approvalFingerprint, `${label}.approvalFingerprint`, 64);
    const dismissedAt = sourceDate(document.dismissedAt, `${label}.dismissedAt`);
    const dismissalReason = asOptionalString(document.dismissalReason, `${label}.dismissalReason`, 2_000);
    if (document.reviewStatus === 'BOOKED') {
      if (supplierId === null || !snapshot) throw new BackupValidationError(`${label}: Gebuchte Eingangsbelege benötigen einen ausdrücklich ausgewählten Lieferanten und historischen Snapshot; alte Buchungen ohne Lieferantenzuordnung können nicht automatisch ergänzt werden`);
      if (expenseId === null || !approvedAt || !approvalRequestId || !UUID_PATTERN.test(approvalRequestId) || !approvalFingerprint || !SHA256_PATTERN.test(approvalFingerprint) || (!isPhotoMedia(media) && document.parseStatus !== 'PARSED') || dismissedAt || dismissalReason) throw new BackupValidationError(`${label} enthält einen inkonsistenten Buchungszustand`);
      const expense = expenses.get(expenseId);
      if (!expense || expenseIds.has(expenseId) || expense.storedReceiptFileName !== document.storedFileName || (expense.userId !== undefined && expense.userId !== sourceUserId)) throw new BackupValidationError(`${label}.expenseId enthält keinen eindeutigen Originalbezug`);
      if (isPhotoMedia(media)) {
        try { validateManualPhotoSnapshot(document.reviewedSourceSnapshot, {
          userId: sourceUserId as string, uploadRequestId: requestId, originalSha256: hash, originalByteCount: bytes!, mediaType: media, revision: revision!,
          reviewDraft: document.reviewDraft, reviewDraftSavedAt: draftDate, reviewedSourceSnapshot: document.reviewedSourceSnapshot,
        }, { amount: expense.amount as number, date: sourceDate(expense.date, 'manualExpense.date', true)!, description: expense.description as string }); }
        catch { throw new BackupValidationError(`${label}: Manuelle Foto-Freigabe stimmt nicht mit Eigentümer, Original, Entwurfsstand oder Ausgabe überein`); }
      }
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
  if (data.emailOutbox !== undefined || data.emailOutboxAttempts !== undefined) throw new BackupValidationError('Versandaufträge und Versuchshistorie dürfen nicht importiert oder reaktiviert werden.');
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

  try { validateProjectServiceBackupFields(data, manifest?.schemaVersion); }
  catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Projekt- und Zeitdaten ungültig'); }
  const arrays = Object.fromEntries(ARRAY_KEYS.map((key) => [key, asArray(data, key)]));
  if (version === LEGACY_BACKUP_VERSION && arrays.serviceArticles.length > 0) throw new BackupValidationError('Legacy-Backups dürfen keine ungebundenen Artikel enthalten');
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
  validateDateFields(arrays.serviceArticles, 'serviceArticles', ['createdAt']);
  const articleKeys = new Set<string>();
  arrays.serviceArticles.forEach((article, index) => {
    const value = readServiceArticle(article);
    if (!value || article.nameKey !== serviceArticleNameKey(value.name)) throw new BackupValidationError(`serviceArticles[${index}] enthält ungültige Artikel- oder Preisangaben`);
    if (articleKeys.has(String(article.nameKey))) throw new BackupValidationError('Artikelbezeichnungen müssen im Backup eindeutig sein');
    articleKeys.add(String(article.nameKey));
  });
  validateDateFields(arrays.templates, 'templates', ['createdAt', 'updatedAt']);
  validateDateFields(arrays.recurringExpenses, 'recurringExpenses', ['startDate', 'endDate', 'lastExecuted', 'nextExecution', 'createdAt', 'updatedAt']);
  validateDateFields(arrays.reminders, 'reminders', ['sentAt', 'dueDate', 'createdAt']);
  arrays.reminders.forEach((reminder, index) => {
    try { validateReminderBackupFields(reminder, version !== LEGACY_BACKUP_VERSION && backupSchemaSupportsReminderBalance(manifest?.schemaVersion), `reminders[${index}]`); }
    catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Mahnungsdaten sind ungültig.'); }
  });
  validateDateFields(arrays.cashBooks, 'cashBooks', ['createdAt', 'updatedAt']);
  validateDateFields(arrays.cashTransactions, 'cashTransactions', ['date', 'createdAt', 'updatedAt']);
  validateDateFields(arrays.documentations, 'documentations', ['createdAt', 'updatedAt']);
  validateDateFields(arrays.billingNotes, 'billingNotes', ['serviceDate', 'createdAt', 'updatedAt']);

  arrays.customers.forEach((customer, index) => {
    asRequiredString(customer.name, `customers[${index}].name`, CUSTOMER_FIELD_LIMITS.name);
    for (const [field, limit] of Object.entries(CUSTOMER_FIELD_LIMITS)) {
      if (field !== 'name') asOptionalString(customer[field], `customers[${index}].${field}`, limit);
    }
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
    if (version === LEGACY_BACKUP_VERSION && (invoice.quoteFollowUpOn != null || invoice.quoteResponseNote != null)) throw new BackupValidationError('Altes Backupformat darf keine ungebundenen Angebots-Wiedervorlagen enthalten');
    try {
      const workflow = parseQuoteWorkflowUpdate({ quoteFollowUpOn: invoice.quoteFollowUpOn ?? null, quoteResponseNote: invoice.quoteResponseNote ?? null });
      if (workflow.quoteFollowUpOn !== (invoice.quoteFollowUpOn ?? null) || workflow.quoteResponseNote !== (invoice.quoteResponseNote ?? null)) throw new Error('Nicht kanonische Angebotsdaten');
    } catch { throw new BackupValidationError('Angebots-Wiedervorlage oder Rückmeldungsnotiz ist ungültig'); }
    if (invoice.type !== 'QUOTE' && (invoice.quoteFollowUpOn != null || invoice.quoteResponseNote != null)) throw new BackupValidationError('Angebots-Wiedervorlagen sind ausschließlich an Angebote gebunden');
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

  try { validateAnnualContextHistory(data.annualBusinessContextRevisions); } catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Jahreskontexthistorie ist ungültig'); }
  if (version === LEGACY_BACKUP_VERSION && Array.isArray(data.annualBusinessContextRevisions) && data.annualBusinessContextRevisions.length > 0) throw new BackupValidationError('Legacy-Backups dürfen keine Jahreskontexthistorie enthalten');
  if (data.settings !== undefined && data.settings !== null) fiscalProfileForRestore(asRecord(data.settings, 'settings'));
  try { validateServiceBillingBackup(data, manifest?.sourceUserId ?? (isRecord(data.user) ? String(data.user.id) : undefined), backupSchemaSupportsServiceBilling(manifest?.schemaVersion)); }
  catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Serviceplan-Backup ist ungültig'); }
  validateBackupReferences(data, sets);
  validateSuppliers(data, manifest);
  validatePurchaseDocuments(data, manifest, root.type === 'full');
  try { validationReportsFromBackup(data, version !== LEGACY_BACKUP_VERSION && backupSchemaSupportsPurchaseValidation(manifest?.schemaVersion)); }
  catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Technische Prüfberichtshistorie ist ungültig'); }
  validatePaymentJournalBackup(data, version, manifest?.schemaVersion);
  try { validatePaymentAdjustmentBackup(data, manifest?.schemaVersion); } catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Zahlungsberichtigungsgraph ungültig'); }
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
    serviceArticles: { imported: 0, skipped: 0 },
    serviceProjects: { imported: 0, skipped: 0 },
    billingNotes: { imported: 0, skipped: 0 },
    expenses: { imported: 0, skipped: 0 },
    incomes: { imported: 0, skipped: 0 },
    paymentJournalEvents: { imported: 0, skipped: 0 },
    paymentAdjustments: { imported: 0, skipped: 0 },
    paymentOperations: { imported: 0, skipped: 0 },
    annualBusinessContextRevisions: { imported: 0, skipped: 0 },
    invoices: { imported: 0, skipped: 0 },
    purchaseDocuments: { imported: 0, skipped: 0 },
    templates: { imported: 0, skipped: 0 },
    files: { imported: 0, skipped: 0 },
    settings: { imported: false },
    recurringExpenses: { imported: 0, skipped: 0 },
    serviceBillingPlans: { imported: 0, skipped: 0 },
    serviceBillingPeriods: { imported: 0, skipped: 0 },
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
  serviceArticles: Map<number, number>;
  serviceProjects: Map<number, number>;
  billingNotes: Map<number, number>;
  expenses: Map<number, number>;
  incomes: Map<number, number>;
  paymentJournalEvents: Map<number, number>;
  invoices: Map<number, number>;
  purchaseDocuments: Map<number, number>;
  recurringExpenses: Map<number, number>;
  serviceBillingPlans: Map<string, string>;
  serviceBillingPeriods: Map<string, string>;
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
  if (entityType === 'ServiceBillingPlan' || entityType === 'ServiceBillingPeriod') {
    const map = entityType === 'ServiceBillingPlan' ? maps.serviceBillingPlans : maps.serviceBillingPeriods;
    const mapped = map.get(sourceEntityId);
    return { entityId: mapped ?? null, state: mapped === undefined ? 'unresolved' : 'mapped', sourceEntityId };
  }
  const mapByType: Record<string, Map<number, number> | undefined> = {
    Customer: maps.customers,
    Supplier: maps.suppliers,
    ServiceArticle: maps.serviceArticles,
    ServiceProject: maps.serviceProjects,
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

function serviceProjectImportKey(sourceUserId: string, sourceProjectId: number): string {
  return JSON.stringify(['service-project', sourceUserId, sourceProjectId]);
}

async function validateProjectTimeOverwrite(tx: Prisma.TransactionClient, userId: string, schemaVersion?: string): Promise<void> {
  if (await tx.billingNote.count({ where: { userId, invoiceId: { not: null }, OR: [{ projectId: { not: null } }, { durationMinutes: { not: null } }] } }) > 0) {
    throw new BackupValidationError('Abgerechnete Projekt- oder Zeitnotizen dürfen nicht überschrieben oder wieder geöffnet werden. Bitte Zusammenführen oder ein leeres Ziel verwenden.');
  }
  if (await tx.billingNote.count({ where: { userId, captureKey: { not: null } } }) > 0) {
    throw new BackupValidationError('Dauerhafte Leistungs-Erfassungsnachweise dürfen nicht überschrieben oder gelöscht werden. Bitte Zusammenführen oder ein leeres Ziel verwenden.');
  }
  if (!backupSchemaSupportsProjectServiceTimes(schemaVersion) && (await tx.serviceProject.count({ where: { userId } }) > 0
    || await tx.billingNote.count({ where: { userId, OR: [{ projectId: { not: null } }, { durationMinutes: { not: null } }] } }) > 0)) {
    throw new BackupValidationError('Dieses ältere Backup enthält keine vollständigen Projekt- und Zeitdaten. Bitte Zusammenführen oder ein leeres Ziel verwenden.');
  }
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
  // A validated no-file service seed is recreated as a NEW planning artifact,
  // not imported issuance evidence. Validation binds its stable receipt, exact
  // native amounts and absence of payments; marker guards still forbid issue/send.
  if (candidate === 'UNISSUED' && isUnrenderedServiceBillingDraft(invoice) && invoice.paidAt == null
    && (sourceId === null || !paidInvoiceIds.has(sourceId))) return 'UNISSUED';
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
  // Preserve target-owned duplicate-risk evidence, but never reattach it to a
  // replacement row whose numeric ID happens to match the former original.
  await tx.emailOutboxAttempt.updateMany({ where: { outbox: { userId }, state: 'PROCESSING' },
    data: { state: 'UNKNOWN', errorCode: 'RESTORE_INTERRUPTED', finishedAt: new Date(), uncertaintyRecordedAt: new Date() } });
  await tx.emailOutbox.updateMany({ where: { userId, state: 'PROCESSING' },
    data: { state: 'UNKNOWN', errorCode: 'RESTORE_INTERRUPTED', processingExpiresAt: null } });
  await tx.emailOutbox.updateMany({ where: { userId, state: { in: ['PREPARED', 'FAILED'] } },
    data: { state: 'CANCELLED', errorCode: 'ORIGINAL_REPLACED', processingExpiresAt: null } });
  await tx.emailOutbox.updateMany({ where: { userId }, data: { invoiceId: null } });
  await tx.serviceBillingPeriod.deleteMany({ where: { userId } });
  await tx.serviceBillingPlan.deleteMany({ where: { userId } });
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
  await tx.serviceArticle.deleteMany({ where: { userId } });
  await tx.dataImportBatch.deleteMany({ where: { userId } });
  await tx.billingNote.deleteMany({ where: { userId } });
  await tx.serviceProject.deleteMany({ where: { userId } });
  await tx.invoice.deleteMany({ where: { userId } });
  await tx.customer.deleteMany({ where: { userId } });
  await tx.settings.deleteMany({ where: { userId } });
  // AuditLog and PurchaseValidationReport are intentionally preserved as immutable history.
}

function purchaseOriginalIdentity(record: JsonRecord): string {
  return hashJson(Object.fromEntries(['id', 'userId', 'storedFileName', 'originalSha256', 'originalByteCount', 'mediaType'].map((field) => [field, record[field]])));
}

function purchaseSourceFingerprint(record: JsonRecord, supplierMap?: Map<number, number>): string {
  const dateFields = ['uploadedAt', 'invoiceDate', 'approvedAt', 'dismissedAt', 'reviewDraftSavedAt'];
  const fields = ['originalFileName', 'originalSha256', 'originalByteCount', 'mediaType', 'uploadRequestId', 'parsedData', 'parseStatus', 'parserVersion', 'parseErrorCode', 'supplierName', 'invoiceNumber', 'currency', 'totalAmount', 'reviewStatus', 'revision', 'approvalRequestId', 'approvalFingerprint', 'dismissalReason', 'reviewDraft', 'aiDraftProvenance', 'aiApprovedSnapshot'];
  return hashJson({
    ...Object.fromEntries(fields.map((field) => [field, record[field] ?? null])),
    ...Object.fromEntries(dateFields.map((field) => [field, sourceDate(record[field], field)?.toISOString() ?? null])),
    aiExtraction: restoredAiExtractionState(record.aiExtraction, String(record.originalSha256)),
    linked: record.expenseId !== null && record.expenseId !== undefined,
    supplierId: supplierMap ? relationMapValue(supplierMap, record.supplierId, 'purchaseDocument.supplierId') : record.supplierId ?? null,
    selectedSupplierSnapshot: remapSupplierSnapshot(record.selectedSupplierSnapshot, supplierMap),
    reviewedSourceSnapshot: record.reviewedSourceSnapshot == null ? null : stableManualPhotoSnapshot(record.reviewedSourceSnapshot as ManualPhotoSnapshot),
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

/** Preflight before staging files, then repeat inside the authoritative write
 * transaction. Never collapse different source IDs onto one name-only match. */
async function planCustomerMerge(client: Pick<Prisma.TransactionClient, 'customer' | 'invoice'>, userId: string, customers: JsonRecord[], invoices: JsonRecord[]): Promise<Map<number, number>> {
  const matches = new Map<number, number>();
  if (!customers.length && !invoices.length) return matches;
  const targets = await client.customer.findMany({ where: { userId }, select: { id: true, name: true, email: true, address: true, zipCode: true, city: true } });
  const byIdentity = new Map<string, number[]>();
  for (const target of targets) {
    const key = customerBusinessIdentity(target);
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), target.id]);
  }
  const sourceCounts = new Map<string, number>();
  for (const source of customers) {
    const key = customerBusinessIdentity(source);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  for (const source of customers) {
    const key = customerBusinessIdentity(source);
    const ids = byIdentity.get(key) ?? [];
    if (ids.length > 1 || (ids.length > 0 && sourceCounts.get(key)! > 1)) throw new BackupValidationError('Mehrdeutige Kundenidentität: Mehrere Kunden dürfen beim Zusammenführen nicht auf einen Datensatz abgebildet werden. Bitte ein leeres Wiederherstellungsziel verwenden oder die Kunden getrennt prüfen.');
    if (ids.length === 1) matches.set(asOptionalInt(source.id, 'customer.id')!, ids[0]);
  }
  const invoiceNumbers = invoices.map(invoice => asOptionalString(invoice.invoiceNumber, 'invoice.invoiceNumber', 255)).filter((value): value is string => Boolean(value));
  if (invoiceNumbers.length) {
    const existing = await client.invoice.findMany({ where: { userId, invoiceNumber: { in: invoiceNumbers } }, select: { invoiceNumber: true, customerId: true } });
    const byNumber = new Map(existing.map(invoice => [invoice.invoiceNumber, invoice]));
    for (const source of invoices) {
      const target = byNumber.get(String(source.invoiceNumber));
      if (!target) continue;
      const sourceCustomerId = asOptionalInt(source.customerId, 'invoice.customerId');
      const mapped = sourceCustomerId === null ? null : matches.get(sourceCustomerId);
      if (mapped !== target.customerId) throw new BackupValidationError('Die Zielrechnung verweist auf einen anderen oder nicht eindeutig zugeordneten Kunden; Zusammenführen wurde ohne Änderungen abgebrochen.');
    }
  }
  return matches;
}

export async function restoreBackupData(options: RestoreOptions): Promise<RestoreResult> {
  const { userId, overwrite, resolveFile } = options;
  const { data, manifest, warnings: validationWarnings } = validateBackupForRestore(options.backup);
  const result = resultTemplate(overwrite);
  result.warnings.push(...validationWarnings);
  const documents = asArray(data, 'purchaseDocuments');
  const validationReports = validationReportsFromBackup(data, backupSchemaSupportsPurchaseValidation(manifest?.schemaVersion));
  if (validationReports.length) result.warnings.push('Technische Eingangsprüfberichte werden ausschließlich als historische Nachweise übernommen. Keine erneute Prüfung und keine aktuelle Freigabe.');
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
    if (kind === 'purchase-document' && /\.(jpg|png)$/.test(originalName) && bytes) {
      try { await withProcessingSlot(userId, () => detectPurchaseContainer({ name: originalName, type: originalName.endsWith('.jpg') ? 'image/jpeg' : 'image/png', size: bytes!.byteLength }, Buffer.from(bytes!))); }
      catch (error) {
        if (error instanceof ProcessingCapacityError) throw error;
        throw new BackupValidationError('Foto-Original ist beschädigt oder überschreitet die zulässigen Bildgrenzen');
      }
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
    const serviceArticles = asArray(data, 'serviceArticles');
    const expenses = asArray(data, 'expenses');
    const incomes = asArray(data, 'incomes');
    const paymentJournalEvents = asArray(data, 'paymentJournalEvents');
    const paymentAdjustments = asArray(data, 'paymentAdjustments');
    const paymentOperations = asArray(data, 'paymentOperations');
    const invoices = asArray(data, 'invoices');
    const templates = asArray(data, 'templates');
    const recurringExpenses = asArray(data, 'recurringExpenses');
    const serviceBillingPlans = asArray(data, 'serviceBillingPlans');
    const serviceBillingPeriods = asArray(data, 'serviceBillingPeriods');
    const reminders = asArray(data, 'reminders');
    const serviceProjects = asArray(data, 'serviceProjects');
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

    // Reject known immutable-target conflicts before resolving or staging any
    // files. Repeat these checks inside the write transaction to cover races.
    if (overwrite) await validateProjectTimeOverwrite(prisma, userId, manifest?.schemaVersion);
    if (overwrite && await prisma.reminder.count({ where: { userId, balanceSnapshot: { not: Prisma.DbNull } } }) > 0) throw new BackupValidationError('Überschreiben würde bestätigte Mahn-Restbeträge löschen. Bitte Zusammenführen oder ein leeres Ziel verwenden.');
    if (overwrite && await prisma.serviceBillingPlan.count({ where: { userId } }) > 0) throw new BackupValidationError('Wiederkehrende Servicepläne und bestätigte Periodenidentitäten dürfen nicht überschrieben werden. Bitte Zusammenführen oder ein leeres Wiederherstellungsziel verwenden.');
    if (overwrite && await prisma.purchaseDocument.count({ where: { userId, reviewedSourceSnapshot: { not: Prisma.DbNull } } }) > 0) throw new BackupValidationError('Unveränderliche manuelle Foto-Freigaben dürfen nicht überschrieben werden; in ein leeres Ziel wiederherstellen oder konfliktfrei zusammenführen.');
    if (overwrite && (await prisma.paymentJournalEvent.count({ where: { userId } }) > 0 || await prisma.paymentAdjustment.count({ where: { userId } }) > 0 || await prisma.paymentOperation.count({ where: { userId } }) > 0)) throw new BackupValidationError('Überschreiben würde unveränderliche Zahlungsereignisse, Berichtigungen oder Finanzaktionsnachweise löschen. Bitte ein leeres Ziel verwenden.');
    const sourceContext = validateAnnualContextHistory(data.annualBusinessContextRevisions);
    const targetContext = (await prisma.annualBusinessContextRevision.findMany({ where: { userId }, orderBy: { revision: 'asc' } })).map(readAnnualContextRevision);
    try { annualContextAppendAfter(targetContext, sourceContext); }
    catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Jahreskontext-Konflikt'); }
    if (!overwrite) await planCustomerMerge(prisma, userId, customers, invoices);

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
      if (isUnrenderedServiceBillingDraft(invoice)) continue;
      const sourceName = validateStoredName(invoice.storedFileName, 'invoice.storedFileName')
        ?? `invoice-${String(invoice.id)}`;
      await stageFile('invoice', sourceName, asRequiredString(invoice.fileName, 'invoice.fileName', 255));
    }
    for (const document of documents) {
      const sourceName = document.storedFileName as string;
      const targetName = await stageFile('purchase-document', sourceName, purchaseOriginalName(document.mediaType as string), {
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
      const existingCustomerMatches = overwrite ? new Map<number, number>() : await planCustomerMerge(tx, userId, customers, invoices);
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

      if (overwrite) await validateProjectTimeOverwrite(tx, userId, manifest?.schemaVersion);
      if (overwrite && await tx.reminder.count({ where: { userId, balanceSnapshot: { not: Prisma.DbNull } } }) > 0) throw new BackupValidationError('Überschreiben würde bestätigte Mahn-Restbeträge löschen. Bitte Zusammenführen oder ein leeres Ziel verwenden.');
      if (overwrite && await tx.serviceBillingPlan.count({ where: { userId } }) > 0) throw new BackupValidationError('Wiederkehrende Servicepläne und bestätigte Periodenidentitäten dürfen nicht überschrieben werden. Bitte Zusammenführen oder ein leeres Wiederherstellungsziel verwenden.');
      if (overwrite && await tx.purchaseDocument.count({ where: { userId, reviewedSourceSnapshot: { not: Prisma.DbNull } } }) > 0) throw new BackupValidationError('Unveränderliche manuelle Foto-Freigaben dürfen nicht überschrieben werden; in ein leeres Ziel wiederherstellen oder konfliktfrei zusammenführen.');
      if (overwrite && (await tx.paymentJournalEvent.count({ where: { userId } }) > 0 || await tx.paymentAdjustment.count({ where: { userId } }) > 0 || await tx.paymentOperation.count({ where: { userId } }) > 0)) {
        throw new BackupValidationError('Überschreiben würde unveränderliche Zahlungsereignisse löschen. Bitte Zusammenführen oder ein leeres Wiederherstellungsziel verwenden.');
      }
      // Context history is immutable even in overwrite mode. Validate the exact
      // shared prefix before mutating anything; legacy absence never means delete.
      const incomingContext = validateAnnualContextHistory(data.annualBusinessContextRevisions);
      const existingContext = (await tx.annualBusinessContextRevision.findMany({ where: { userId }, orderBy: { revision: 'asc' } })).map(readAnnualContextRevision);
      let appendContext: typeof incomingContext;
      try { appendContext = annualContextAppendAfter(existingContext, incomingContext); }
      catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Jahreskontext-Konflikt'); }
      if (existingContext.length > incomingContext.length) result.warnings.push('Bestehende neuere Jahreskontexthistorie wurde bewahrt; das Backup ersetzt oder bestätigt keine fehlenden Angaben.');
      if (overwrite) {
        const activeWorkflow = await tx.invoice.count({ where: { userId, type: 'QUOTE', OR: [{ quoteFollowUpOn: { not: null } }, { quoteResponseNote: { not: null } }] } });
        if (activeWorkflow > 0 && (!manifest || !QUOTE_WORKFLOW_SCHEMAS.includes(manifest.schemaVersion))) throw new BackupValidationError('Dieses ältere Backup enthält keine vollständigen Angebots-Wiedervorlagen. Überschreiben würde interne Aufgaben oder Notizen löschen; bitte ein aktuelles Backup verwenden oder getrennt wiederherstellen.');
        await deleteUserData(tx, userId);
      }
      result.annualBusinessContextRevisions.skipped = incomingContext.length - appendContext.length;
      result.annualBusinessContextRevisions.imported = appendContext.length;
      for (const context of appendContext) {
        const { version: _version, provenance: _provenance, ...record } = context;
        void _version; void _provenance;
        await tx.annualBusinessContextRevision.create({ data: { userId, ...record, declaredAt: new Date(record.declaredAt) } });
      }
      const existingAdjustments = await tx.paymentAdjustment.findMany({ where: { userId } });
      const existingOperations = await tx.paymentOperation.findMany({ where: { userId } });
      const existingPaymentEvents = await tx.paymentJournalEvent.findMany({ where: { userId } });
      for (const root of paymentJournalEvents) if (existingOperations.some(operation => operation.idempotencyKey === root.idempotencyKey && operation.kind !== 'PAYMENT_RECEIVED')) throw new BackupValidationError('Finanzaktionsschlüssel kollidiert mit einer anderen Zahlungsaktion.');
      for (const adjustment of paymentAdjustments) if (existingPaymentEvents.some(root => root.idempotencyKey === adjustment.idempotencyKey)) throw new BackupValidationError('Berichtigungsschlüssel kollidiert mit Originalzahlung.');
      const existingPaymentByKey = new Map(existingPaymentEvents.map((event) => [event.idempotencyKey, event]));
      const existingPaymentById = new Map(existingPaymentEvents.map((event) => [event.id, event]));
      const existingPaymentSourceIdentities = new Map<string, number>();
      const existingAdjustmentSourceIdentities = new Map<string, number>();
      const existingPaymentsByInvoice = groupByInvoice(existingPaymentEvents, (event) => event.invoiceId);
      const sourcePaymentsByInvoice = groupByInvoice(paymentJournalEvents, (event) => asOptionalInt(event.invoiceId, 'payment.invoiceId'));
      const sourcePaymentByIncome = new Map(paymentJournalEvents.filter((event) => event.incomeId != null)
        .map((event) => [asOptionalInt(event.incomeId, 'payment.incomeId')!, event]));
      const replayIncomeBySource = new Map<number, number>();
      const projectionUpdates = new Map<number, { status: string; paidAt: Date | null; cancellationReason: string | null }>();

      const customerMap = new Map<number, number>();
      const supplierMap = new Map<number, number>();
      const invoiceMap = new Map<number, number>();
      const purchaseDocumentMap = new Map<number, number>();
      const cashBookMap = new Map<number, number>();
      const recurringMap = new Map<number, number>();
      const serviceBillingPlanMap = new Map<string, string>();
      const serviceBillingPeriodMap = new Map<string, string>();
      const expenseMap = new Map<number, number>();
      const incomeMap = new Map<number, number>();
      const skippedSourceExpenses = new Set<number>();
      const paymentJournalMap = new Map<number, number>();
      const templateMap = new Map<number, number>();
      const reminderMap = new Map<number, number>();
      const serviceProjectMap = new Map<number, number>();
      const billingNoteMap = new Map<number, number>();
      const cashTransactionMap = new Map<number, number>();
      const documentationMap = new Map<number, number>();
      const settingsMap = new Map<number, number>();
      const createdInvoiceIds = new Set<number>();
      const mappedJournalInvoices = new Set<number>();
      const existingAuditImportRows = new Map<string, { id: number; entityId: string | null; metadata: string | null }>();
      const existingSupplierImports = new Map<string, { entityId: string | null }>();
      const existingProjectImports = new Map<string, { entityId: string | null }>();
      const existingBillingNoteImports = new Map<string, { id: number; entityId: string | null; metadata: string | null }>();
      const existingAuditRows = await tx.auditLog.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: { id: true, action: true, entityType: true, entityId: true, metadata: true, newValues: true } });
      for (const row of existingAuditRows) {
        const metadata = parseObject(row.metadata);
        const paymentValues = parseObject(row.newValues);
        if (row.action === 'RESTORE' && metadata?.operation === 'payment-journal.restore'
          && metadata.tenantId === userId && metadata.backupImport === undefined
          && typeof paymentValues?.sourceUserId === 'string'
          && Number.isSafeInteger(paymentValues.sourceEventId) && Number.isSafeInteger(paymentValues.paymentJournalEventId)) {
          const sourceIdentity = JSON.stringify([paymentValues.sourceUserId, paymentValues.sourceEventId]);
          const prior = existingPaymentSourceIdentities.get(sourceIdentity);
          if (prior !== undefined && prior !== paymentValues.paymentJournalEventId) {
            throw new BackupValidationError('Mehrdeutige persistierte Zahlungs-Quellidentität im Ziel');
          }
          existingPaymentSourceIdentities.set(sourceIdentity, paymentValues.paymentJournalEventId as number);
        }
        if (row.action === 'RESTORE' && metadata?.operation === 'payment-adjustment.restore'
          && metadata.tenantId === userId && metadata.backupImport === undefined && typeof paymentValues?.sourceUserId === 'string'
          && Number.isSafeInteger(paymentValues.sourceAdjustmentId) && Number.isSafeInteger(paymentValues.paymentAdjustmentId)) {
          const identity = JSON.stringify([paymentValues.sourceUserId, paymentValues.sourceAdjustmentId]);
          const prior = existingAdjustmentSourceIdentities.get(identity);
          if (prior !== undefined && prior !== paymentValues.paymentAdjustmentId) throw new BackupValidationError('Mehrdeutige persistierte Berichtigungs-Quellidentität.');
          existingAdjustmentSourceIdentities.set(identity, paymentValues.paymentAdjustmentId as number);
        }
        const key = metadata?.backupImport && typeof metadata.backupImport === 'object'
          ? (metadata.backupImport as Record<string, unknown>).importKey
          : null;
        if (typeof key === 'string') existingAuditImportRows.set(key, row);
        const provenance = metadata?.backupImport;
        if (row.action === 'RESTORE' && row.entityType === 'Supplier' && isRecord(provenance)
          && provenance.sourceEntityType === 'Supplier' && provenance.targetTenantId === userId
          && typeof provenance.importKey === 'string') existingSupplierImports.set(provenance.importKey, row);
        if (row.action === 'RESTORE' && row.entityType === 'ServiceProject' && isRecord(provenance)
          && provenance.sourceEntityType === 'ServiceProject' && provenance.targetTenantId === userId
          && typeof provenance.importKey === 'string') {
          const prior = existingProjectImports.get(provenance.importKey);
          if (prior && prior.entityId !== row.entityId) throw new BackupValidationError('Mehrdeutige persistierte Projekt-Quellidentität im Ziel');
          existingProjectImports.set(provenance.importKey, row);
        }
        if (row.action === 'RESTORE' && row.entityType === 'BillingNote' && isRecord(provenance)
          && provenance.sourceEntityType === 'BillingNote' && provenance.targetTenantId === userId
          && typeof provenance.importKey === 'string') {
          const prior = existingBillingNoteImports.get(provenance.importKey);
          if (prior && prior.entityId !== row.entityId) throw new BackupValidationError('Mehrdeutige persistierte Leistungsnotiz-Quellidentität im Ziel');
          existingBillingNoteImports.set(provenance.importKey, row);
        }
      }

      for (const adjustment of paymentAdjustments) {
        const sourceId = asOptionalInt(adjustment.id, 'adjustment.id')!;
        const mapped = existingAdjustmentSourceIdentities.get(JSON.stringify([sourceUserId, sourceId]))
          ?? (sourceUserId === userId && existingAdjustments.some(row => row.id === sourceId) ? sourceId : undefined);
        if (mapped !== undefined) {
          const target = existingAdjustments.find(row => row.id === mapped);
          if (!target || target.idempotencyKey !== adjustment.idempotencyKey || !sameAdjustmentEvidence(target as unknown as JsonRecord, adjustment)) throw new BackupValidationError('Berichtigungs-Quellidentität wurde für einen anderen unveränderlichen Nachweis wiederverwendet.');
        }
      }

      // Existing cash-book and template name behavior is unchanged. Customer
      // matching above uses the shared complete business identity instead.
      const existingCashBooksByName = new Map<string, number>();
      const existingTemplatesByName = new Map<string, number>();
      if (!overwrite) {
        const [existingCashBooks, existingTemplates] = await Promise.all([
          tx.cashBook.findMany({ where: { userId }, select: { id: true, name: true } }),
          tx.invoiceTemplate.findMany({ where: { userId }, select: { id: true, name: true } }),
        ]);
        for (const existing of existingCashBooks) existingCashBooksByName.set(existing.name, existing.id);
        for (const existing of existingTemplates) existingTemplatesByName.set(existing.name, existing.id);
      }

      const serviceArticleMap = new Map<number, number>();
      for (const source of serviceArticles) {
        const article = readServiceArticle(source)!;
        const nameKey = serviceArticleNameKey(article.name);
        const existing = await tx.serviceArticle.findUnique({ where: { userId_nameKey: { userId, nameKey } } });
        if (existing) {
          // A name collision with different prices is ambiguous, never silently merged.
          if (['name', 'description', 'unit', 'unitPriceCents', 'sourcePriceCents', 'sourcePriceBasis', 'taxRate'].some(key => existing[key as keyof typeof existing] !== source[key])) throw new BackupValidationError('Ein vorhandener Artikel hat abweichende Daten; Zusammenführen wurde ohne Änderungen abgebrochen.');
          serviceArticleMap.set(article.id, existing.id);
          result.serviceArticles.skipped += 1;
        } else {
          const created = await tx.serviceArticle.create({ data: { userId, nameKey, name: article.name, description: article.description, unit: article.unit, unitPriceCents: article.unitPriceCents, sourcePriceCents: article.sourcePriceCents, sourcePriceBasis: article.sourcePriceBasis, taxRate: article.taxRate, createdAt: asDate(source.createdAt, 'serviceArticle.createdAt', new Date())! } });
          serviceArticleMap.set(article.id, created.id);
          result.serviceArticles.imported += 1;
        }
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
        const name = asRequiredString(customer.name, 'customer.name', CUSTOMER_FIELD_LIMITS.name);
        const existingId = existingCustomerMatches.get(sourceId);
        if (existingId) {
          customerMap.set(sourceId, existingId);
          result.customers.skipped += 1;
        } else {
          const created = await tx.customer.create({ data: {
            name,
            contactPerson: asOptionalString(customer.contactPerson, 'customer.contactPerson', CUSTOMER_FIELD_LIMITS.contactPerson),
            email: asOptionalString(customer.email, 'customer.email', CUSTOMER_FIELD_LIMITS.email),
            phone: asOptionalString(customer.phone, 'customer.phone', CUSTOMER_FIELD_LIMITS.phone),
            address: asOptionalString(customer.address, 'customer.address', CUSTOMER_FIELD_LIMITS.address),
            zipCode: asOptionalString(customer.zipCode, 'customer.zipCode', CUSTOMER_FIELD_LIMITS.zipCode),
            city: asOptionalString(customer.city, 'customer.city', CUSTOMER_FIELD_LIMITS.city),
            taxNumber: asOptionalString(customer.taxNumber, 'customer.taxNumber', CUSTOMER_FIELD_LIMITS.taxNumber),
            internalNote: asOptionalString(customer.internalNote, 'customer.internalNote', 5_000),
            noteVisibility: asOptionalString(customer.noteVisibility, 'customer.noteVisibility', 16) ?? 'BOTH',
            createdAt: asDate(customer.createdAt, 'customer.createdAt', new Date())!,
            userId,
          } });
          customerMap.set(sourceId, created.id);
          result.customers.imported += 1;
        }
      }

      // Project identity is the source tenant + row ID, never the editable name.
      // A merge retains target name/archive history, but never moves a project.
      for (const project of serviceProjects) {
        const sourceId = Number(project.id);
        if (!sourceUserId) throw new BackupValidationError('Projekte benötigen eine eindeutige Backup-Quellidentität');
        const customerId = relationMapValue(customerMap, project.customerId, 'serviceProject.customerId')!;
        const importKey = serviceProjectImportKey(sourceUserId, sourceId);
        const prior = overwrite ? undefined : existingProjectImports.get(importKey);
        const targetId = prior?.entityId ? asOptionalInt(prior.entityId, 'serviceProject.targetId') : !overwrite && sourceUserId === userId ? sourceId : null;
        const existing = targetId === null ? null : await tx.serviceProject.findFirst({ where: { id: targetId, userId } });
        if (prior && !existing) throw new BackupValidationError('Persistierte Projekt-Quellidentität verweist auf ein fehlendes Zielprojekt');
        if (existing) {
          if (existing.customerId !== customerId || existing.createdAt.toISOString() !== asDate(project.createdAt, 'serviceProject.createdAt')!.toISOString()) throw new BackupValidationError('Projekt-Quellidentität widerspricht der unveränderlichen Kunden- oder Entstehungshistorie');
          serviceProjectMap.set(sourceId, existing.id);
          result.serviceProjects.skipped += 1;
          continue;
        }
        const created = await tx.serviceProject.create({ data: {
          userId, customerId, name: String(project.name), archivedAt: asDate(project.archivedAt, 'serviceProject.archivedAt'),
          createdAt: asDate(project.createdAt, 'serviceProject.createdAt')!, updatedAt: asDate(project.updatedAt, 'serviceProject.updatedAt')!,
        } });
        serviceProjectMap.set(sourceId, created.id);
        result.serviceProjects.imported += 1;
        const metadata = JSON.stringify({ backupImport: { importKey, backupId, sourceUserId, sourceEntityType: 'ServiceProject', sourceEntityId: String(sourceId), targetTenantId: userId, entityMapping: 'mapped' } });
        await tx.auditLog.create({ data: { userId, action: 'RESTORE', entityType: 'ServiceProject', entityId: String(created.id), entityName: created.name, metadata } });
        existingProjectImports.set(importKey, { entityId: String(created.id) });
      }

      // Portable plan keys are scoped to the target owner; internal row IDs are
      // deliberately remapped so source and restored tenants can coexist.
      for (const plan of serviceBillingPlans) {
        const sourceId = String(plan.id);
        const stableKey = String(plan.stableKey);
        const customerId = relationMapValue(customerMap, plan.customerId, 'serviceBillingPlan.customerId')!;
        const existing = await tx.serviceBillingPlan.findUnique({ where: { userId_stableKey: { userId, stableKey } } });
        if (existing) {
          if (await tx.serviceBillingPeriod.count({ where: { userId, planId: existing.id } }) !== Number(plan.nextPeriod)) throw new BackupValidationError('Der Zielserviceplan enthält unvollständige Periodenidentitäten; bitte getrennt prüfen.');
          const fields = ['stableKey', 'name', 'cadence', 'anchorDate', 'taxMode', 'items', 'nextPeriod', 'status', 'revision'] as const;
          if (existing.customerId !== customerId || fields.some(field => hashJson(existing[field]) !== hashJson(plan[field]))
            || existing.createdAt.toISOString() !== asDate(plan.createdAt, 'serviceBillingPlan.createdAt')!.toISOString()
            || existing.updatedAt.toISOString() !== asDate(plan.updatedAt, 'serviceBillingPlan.updatedAt')!.toISOString()) {
            throw new BackupValidationError('Abweichender Serviceplan mit gleicher stabiler Identität. Zusammenführen würde Planstand oder Periodenentscheidungen verlieren; bitte getrennt prüfen.');
          }
          serviceBillingPlanMap.set(sourceId, existing.id);
          result.serviceBillingPlans.skipped += 1;
        } else {
          const created = await tx.serviceBillingPlan.create({ data: {
            userId, stableKey, customerId, name: String(plan.name), cadence: String(plan.cadence),
            anchorDate: String(plan.anchorDate), taxMode: String(plan.taxMode), items: asJson(plan.items, 'serviceBillingPlan.items'),
            nextPeriod: Number(plan.nextPeriod), status: String(plan.status), revision: Number(plan.revision),
            createdAt: asDate(plan.createdAt, 'serviceBillingPlan.createdAt')!, updatedAt: asDate(plan.updatedAt, 'serviceBillingPlan.updatedAt')!,
          } });
          serviceBillingPlanMap.set(sourceId, created.id);
          result.serviceBillingPlans.imported += 1;
        }
      }
      const recurringSourceInvoiceIds = new Set(serviceBillingPeriods.filter(period => period.invoiceId != null).map(period => Number(period.invoiceId)));
      const recurringInvoiceIdentity = new Map<number, number>();
      const existingServicePeriods = new Map<string, { id: string; invoiceId: number | null }>();
      for (const period of serviceBillingPeriods) {
        const planId = serviceBillingPlanMap.get(String(period.planId))!;
        const existing = await tx.serviceBillingPeriod.findUnique({ where: { planId_periodIndex: { planId, periodIndex: Number(period.periodIndex) } } });
        if (!existing) continue;
        if (existing.userId !== userId || existing.action !== period.action || existing.periodStart !== period.periodStart || existing.periodEnd !== period.periodEnd
          || existing.createdAt.toISOString() !== asDate(period.createdAt, 'serviceBillingPeriod.createdAt')!.toISOString()
          || (existing.invoiceId === null) !== (period.invoiceId == null)) {
          throw new BackupValidationError('Abweichende Service-Periodenidentität. Eine bestätigte oder gelöschte Entwurfsperiode darf nicht erneut erzeugt werden.');
        }
        existingServicePeriods.set(String(period.id), existing);
        if (existing.invoiceId !== null) recurringInvoiceIdentity.set(Number(period.invoiceId), existing.invoiceId);
      }

      const sourceCustomersById = new Map(customers.map((customer) => [asOptionalInt(customer.id, 'customer.id'), customer]));
      for (const invoice of invoices) {
        const sourceId = asOptionalInt(invoice.id, 'invoice.id')!;
        const invoiceNumber = asOptionalString(invoice.invoiceNumber, 'invoice.invoiceNumber', 255);
        const sourcePayments = sourcePaymentsByInvoice.get(sourceId) ?? [];
        const identityMatches = sourcePayments.flatMap((event) => {
          const existing = existingPaymentByKey.get(String(event.idempotencyKey));
          const priorId = existingPaymentSourceIdentities.get(JSON.stringify([sourceUserId, event.id]));
          const prior = priorId === undefined ? undefined : existingPaymentById.get(priorId);
          if (priorId !== undefined && (!prior || prior.idempotencyKey !== event.idempotencyKey
            || (existing && existing.id !== prior.id))) {
            throw new BackupValidationError('Kollision: ursprüngliche Zahlungs-Quellidentität wurde mit anderem Idempotenzschlüssel wiederverwendet');
          }
          return existing ? [existing] : [];
        });
        if (new Set(identityMatches.map((event) => event.invoiceId)).size > 1) {
          throw new BackupValidationError('Kollision: Zahlungsidentitäten verweisen auf verschiedene Zielrechnungen');
        }
        const recurringInvoiceId = recurringInvoiceIdentity.get(sourceId);
        if (recurringInvoiceId !== undefined && identityMatches[0] && recurringInvoiceId !== identityMatches[0].invoiceId) throw new BackupValidationError('Service- und Zahlungsidentitäten verweisen auf unterschiedliche Rechnungen.');
        const existing = identityMatches[0]
          ? await tx.invoice.findFirst({ where: { id: identityMatches[0].invoiceId, userId } })
          : recurringInvoiceId !== undefined ? await tx.invoice.findFirst({ where: { id: recurringInvoiceId, userId } })
            : invoiceNumber ? await tx.invoice.findFirst({ where: { userId, invoiceNumber } }) : null;
        if ((recurringInvoiceId !== undefined && !existing) || (recurringSourceInvoiceIds.has(sourceId) && existing && !sameServiceBillingInvoice(existing as unknown as JsonRecord, invoice, relationMapValue(customerMap, invoice.customerId, 'invoice.customerId')))) {
          throw new BackupValidationError('Der Service-Periodenentwurf wurde im Ziel oder im Backup verändert. Zusammenführen wird ohne Ersatz oder Duplikat abgebrochen.');
        }
        // Numeric IDs, filenames and equal amounts do not establish document
        // identity across restores. Keep accepted legacy no-write protection;
        // partial histories additionally require a verified event identity.
        if (!sourcePayments.length && !invoiceNumber?.trim() && recurringInvoiceId === undefined && existingPaymentEvents.length) {
          throw new BackupValidationError('Zusammenführen ohne eindeutige Rechnungsidentität ist bei vorhandenen unveränderlichen Zahlungsereignissen nicht möglich. Bitte den Altbeleg getrennt prüfen oder ein leeres Wiederherstellungsziel verwenden.');
        }
        if (sourcePayments.length && !invoiceNumber?.trim() && existingPaymentEvents.length && !identityMatches.length) {
          throw new BackupValidationError('Zahlungshistorie ohne eindeutige Rechnungsidentität kann nicht mit einem journalisierten Ziel zusammengeführt werden.');
        }
        if (existing) {
          if (existing.customerId !== relationMapValue(customerMap, invoice.customerId, 'invoice.customerId')) throw new BackupValidationError('Die Zielrechnung verweist auf einen anderen Kunden; Zusammenführen wurde ohne Änderungen abgebrochen.');
          if (existing.type === 'QUOTE' || invoice.type === 'QUOTE') {
            if (existing.type !== invoice.type || (existing.quoteFollowUpOn ?? null) !== (invoice.quoteFollowUpOn ?? null)
              || (existing.quoteResponseNote ?? null) !== (invoice.quoteResponseNote ?? null)) {
              throw new BackupValidationError('Gleiche Angebotsnummer mit abweichender Wiedervorlage oder Rückmeldungsnotiz. Zusammenführen würde Aufgaben oder Notizen verlieren; bitte getrennt prüfen.');
            }
          }
          const targetPayments = existingPaymentsByInvoice.get(existing.id) ?? [];
          if (sourcePayments.length || targetPayments.length) {
            if (mappedJournalInvoices.has(existing.id)) throw new BackupValidationError('Mehrere Quellrechnungen dürfen nicht auf dieselbe Zahlungsrechnung abgebildet werden');
            mappedJournalInvoices.add(existing.id);
          }
          if (!sourcePayments.length && targetPayments.length) {
            throw new BackupValidationError('Altes Backup ohne Zahlungsidentitäten kann nicht mit einer Rechnung mit unveränderlichen Zahlungsereignissen zusammengeführt werden. Bitte getrennt prüfen.');
          }
          if (sourcePayments.length) {
            if (existing.type !== invoice.type || existing.invoiceNumber !== invoiceNumber
              || existing.totalAmount !== asOptionalFinite(invoice.totalAmount, 'invoice.totalAmount')
              || existing.customerId !== relationMapValue(customerMap, invoice.customerId, 'invoice.customerId')
              || hashJson(existing.parsedData ?? {}) !== hashJson(invoice.parsedData ?? {})) {
              throw new BackupValidationError('Die Zielrechnung weicht vom unveränderlichen Zahlungsnachweis ab (Kunde, Dokument oder Betrag).');
            }
            if (existing.customerId !== null) {
              const sourceCustomer = sourceCustomersById.get(asOptionalInt(invoice.customerId, 'invoice.customerId'))!;
              const targetCustomer = await tx.customer.findFirst({ where: { id: existing.customerId, userId } });
              const identityFields = ['name', 'contactPerson', 'email', 'phone', 'address', 'zipCode', 'city', 'taxNumber'] as const;
              if (!targetCustomer || identityFields.some((field) => (sourceCustomer[field] ?? null) !== (targetCustomer[field] ?? null))) {
                throw new BackupValidationError('Die Zielrechnung verweist auf abweichende Kundenstammdaten; bitte getrennt prüfen.');
              }
            }
            const targetIncomes = await tx.income.findMany({ where: { userId, invoiceId: existing.id } });
            if (targetPayments.length) {
              validatePaymentJournalBackup({ user: { id: userId }, invoices: [existing], incomes: targetIncomes, paymentJournalEvents: targetPayments, paymentAdjustments: existingAdjustments.filter(row => row.invoiceId === existing.id) }, CURRENT_BACKUP_VERSION);
            } else if (targetIncomes.length || existing.status === 'PAID' || existing.paidAt !== null
              || !['DRAFT', 'SENT'].includes(existing.status)) {
              throw new BackupValidationError('Zielrechnung enthält ungeklärte historische Einnahmen oder einen inkompatiblen Finanzstatus.');
            }
            const sourceKeys = new Set(sourcePayments.map((event) => String(event.idempotencyKey)));
            const targetKeys = new Set(targetPayments.map((event) => event.idempotencyKey));
            const sourceSubset = [...sourceKeys].every((key) => targetKeys.has(key));
            const targetSubset = [...targetKeys].every((key) => sourceKeys.has(key));
            const union = new Map(targetPayments.map((event) => [event.idempotencyKey, event.amountCents]));
            for (const event of sourcePayments) {
              const targetEvent = existingPaymentByKey.get(String(event.idempotencyKey));
              if (targetEvent) {
                if (targetEvent.invoiceId !== existing.id || !samePaymentEvidence(targetEvent as unknown as JsonRecord, event)) {
                  throw new BackupValidationError('Kollision mit abweichendem unveränderlichem Zahlungsereignis');
                }
                if (event.incomeId != null && targetEvent.incomeId !== null) {
                  replayIncomeBySource.set(asOptionalInt(event.incomeId, 'payment.incomeId')!, targetEvent.incomeId);
                }
              }
              union.set(String(event.idempotencyKey), String(event.amountCents));
            }
            const sourceAdjustments = paymentAdjustments.filter(row => row.invoiceId === sourceId);
            const targetAdjustments = existingAdjustments.filter(row => row.invoiceId === existing.id);
            const sourceAdjustmentKeys = new Set(sourceAdjustments.map(row => String(row.idempotencyKey)));
            const targetAdjustmentKeys = new Set(targetAdjustments.map(row => row.idempotencyKey));
            const sourceHistorySubset = sourceSubset && [...sourceAdjustmentKeys].every(key => targetAdjustmentKeys.has(key));
            const targetHistorySubset = targetSubset && [...targetAdjustmentKeys].every(key => sourceAdjustmentKeys.has(key));
            for (const adjustment of sourceAdjustments) {
              const target = targetAdjustments.find(row => row.idempotencyKey === adjustment.idempotencyKey);
              if (target && !sameAdjustmentEvidence(target as unknown as JsonRecord, adjustment)) throw new BackupValidationError('Abweichende unveränderliche Berichtigungshistorie.');
            }
            if (!sourceHistorySubset && !targetHistorySubset) throw new BackupValidationError('Unvereinbare Zahlungshistorien oder divergierende Berichtigungshistorien benötigen ein getrenntes Ziel.');
            const unionAdjustments = new Map(targetAdjustments.map(row => [row.idempotencyKey, row as unknown as JsonRecord]));
            for (const row of sourceAdjustments) unionAdjustments.set(String(row.idempotencyKey), row);
            const unionCorrected = [...unionAdjustments.values()].filter(row => row.kind === 'PAYMENT_CORRECTION').reduce((sum, row) => sum + BigInt(String(row.amountCents)), BigInt(0));
            const unionPaid = [...union.values()].reduce((sum, amount) => sum + BigInt(amount), BigInt(0)) - unionCorrected;
            if (unionPaid < BigInt(0) || unionPaid > parseMoneyEUR(existing.totalAmount!)) throw new BackupValidationError('Gemeinsamer berichtigter Zahlungsbetrag ist inkonsistent.');
            if (targetHistorySubset && !sourceHistorySubset && existing.status !== 'CANCELLED') {
              projectionUpdates.set(existing.id, { status: String(invoice.status), paidAt: asDate(invoice.paidAt, 'invoice.paidAt'), cancellationReason: asOptionalString(invoice.cancellationReason, 'invoice.cancellationReason', 1_000) });
            }
            if ((existing.status === 'CANCELLED' && !sourceSubset)
              || (invoice.status === 'CANCELLED' && !targetSubset)) {
              throw new BackupValidationError('Zahlungshistorie widerspricht dem stornierten Finanzstatus.');
            }
            if (targetSubset && existing.status !== 'CANCELLED'
              && (sourceKeys.size > targetKeys.size || invoice.status === 'CANCELLED')) {
              projectionUpdates.set(existing.id, {
                status: String(invoice.status), paidAt: asDate(invoice.paidAt, 'invoice.paidAt'),
                cancellationReason: asOptionalString(invoice.cancellationReason, 'invoice.cancellationReason', 1_000),
              });
            }
          }
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
          storedFileName: isUnrenderedServiceBillingDraft(invoice) ? '' : fileMap.get(`invoice:${sourceName}`)!,
          invoiceNumber,
          uploadedAt: asDate(invoice.uploadedAt, 'invoice.uploadedAt', new Date())!,
          invoiceDate: asDate(invoice.invoiceDate, 'invoice.invoiceDate'),
          dueDate: asDate(invoice.dueDate, 'invoice.dueDate'),
          validUntil: asDate(invoice.validUntil, 'invoice.validUntil'),
          quoteFollowUpOn: asOptionalString(invoice.quoteFollowUpOn, 'invoice.quoteFollowUpOn', 10),
          quoteResponseNote: asOptionalString(invoice.quoteResponseNote, 'invoice.quoteResponseNote', 2000),
          parsedData: asJson(invoice.parsedData, 'invoice.parsedData'),
          totalAmount: asOptionalFinite(invoice.totalAmount, 'invoice.totalAmount'),
          status: asOptionalString(invoice.status, 'invoice.status', 32) ?? 'DRAFT',
          issuanceState: restoredIssuanceState(invoice, manifest?.version ?? LEGACY_BACKUP_VERSION, paidInvoiceIds),
          paidAt: asDate(invoice.paidAt, 'invoice.paidAt'),
          cancellationReason: asOptionalString(invoice.cancellationReason, 'invoice.cancellationReason', 1_000),
          customerId: relationMapValue(customerMap, invoice.customerId, 'invoice.customerId'),
          userId,
        } });
        if (!isUnrenderedServiceBillingDraft(invoice)) usedFiles.add(fileMap.get(`invoice:${sourceName}`)!);
        invoiceMap.set(sourceId, created.id);
        if (sourcePayments.length) mappedJournalInvoices.add(created.id);
        createdInvoiceIds.add(sourceId);
        result.invoices.imported += 1;
      }

      for (const period of serviceBillingPeriods) {
        const planId = serviceBillingPlanMap.get(String(period.planId))!;
        const invoiceId = relationMapValue(invoiceMap, period.invoiceId, 'serviceBillingPeriod.invoiceId');
        const existing = existingServicePeriods.get(String(period.id));
        if (existing) {
          if (existing.invoiceId !== invoiceId) throw new BackupValidationError('Serviceperiode verweist auf einen anderen Zielentwurf. Wiederherstellen wurde abgebrochen.');
          serviceBillingPeriodMap.set(String(period.id), existing.id);
          result.serviceBillingPeriods.skipped += 1;
          continue;
        }
        const created = await tx.serviceBillingPeriod.create({ data: {
          userId, planId, periodIndex: Number(period.periodIndex), periodStart: String(period.periodStart), periodEnd: String(period.periodEnd),
          action: String(period.action), invoiceId, createdAt: asDate(period.createdAt, 'serviceBillingPeriod.createdAt')!,
        } });
        serviceBillingPeriodMap.set(String(period.id), created.id);
        result.serviceBillingPeriods.imported += 1;
      }

      for (const note of billingNotes) {
        const sourceId = asOptionalInt(note.id, 'billingNote.id')!;
        const importKey = billingNoteImportKey(sourceUserId, sourceId);
        const customerId = relationMapValue(customerMap, note.customerId, 'billingNote.customerId');
        if (!customerId) throw new BackupValidationError('billingNote.customerId fehlt');
        const projectId = relationMapValue(serviceProjectMap, note.projectId, 'billingNote.projectId');
        const durationMinutes = note.durationMinutes == null ? null : Number(note.durationMinutes);
        const command = {
          customerId, projectId, durationMinutes,
          serviceDate: asBusinessDate(note.serviceDate, 'billingNote.serviceDate'),
          description: asRequiredString(note.description, 'billingNote.description', 500),
          quantity: asBillingQuantity(note.quantity, 'billingNote.quantity'),
          unit: asOptionalString(note.unit, 'billingNote.unit', 100) ?? 'Stunde',
        };
        const captureKey = note.captureKey == null ? null : String(note.captureKey);
        // Source hashes were checked before writes. Only numeric relationships
        // change on restore; preserve the receipt key and command fields exactly.
        const captureFingerprint = captureKey === null ? null : serviceCaptureFingerprint(command);
        const deletedAt = asDate(note.deletedAt, 'billingNote.deletedAt');
        const existingImported = overwrite ? undefined : existingBillingNoteImports.get(importKey);
        const existingId = existingImported?.entityId
          ? asOptionalInt(existingImported.entityId, `billingNotes[${sourceId}].targetId`)
          : !overwrite && sourceUserId === userId ? sourceId : null;
        const existingIdentityNote = existingId === null ? null : await tx.billingNote.findFirst({ where: { id: existingId, userId } });
        if (existingImported && !existingIdentityNote) throw new BackupValidationError('Persistierte Leistungsnotiz-Quellidentität verweist auf eine fehlende Zielnotiz');
        const existingReceiptNote = captureKey === null ? null : await tx.billingNote.findUnique({ where: { userId_captureKey: { userId, captureKey } } });
        if (existingIdentityNote && existingReceiptNote && existingIdentityNote.id !== existingReceiptNote.id) {
          throw new BackupValidationError('Erfassungsnachweis-Kollision: Quellidentität und Erfassungsschlüssel verweisen auf unterschiedliche Leistungsnotizen');
        }
        const existingNote = existingIdentityNote ?? existingReceiptNote;
        const invoiceId = relationMapValue(invoiceMap, note.invoiceId, 'billingNote.invoiceId');
        if (invoiceId !== null) {
          const targetInvoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId, type: 'INVOICE' }, select: { customerId: true } });
          if (!targetInvoice || targetInvoice.customerId !== customerId) {
            throw new BackupValidationError('billingNote.invoiceId muss zur angegebenen Kunden-ID gehören');
          }
        }
        if (existingNote) {
          if (existingNote.customerId !== customerId || existingNote.projectId !== projectId || existingNote.durationMinutes !== durationMinutes
            || existingNote.quantity !== command.quantity || existingNote.unit !== command.unit
            || existingNote.description !== command.description || existingNote.serviceDate.toISOString() !== command.serviceDate.toISOString()
            || (existingIdentityNote && existingNote.createdAt.toISOString() !== asDate(note.createdAt, 'billingNote.createdAt', existingNote.createdAt)!.toISOString())) {
            throw new BackupValidationError('Leistungsnotiz-Quellidentität widerspricht der unveränderlichen Kunden-, Projekt- oder Leistungshistorie');
          }
          if (existingNote.captureKey !== captureKey || existingNote.captureFingerprint !== captureFingerprint
            || (captureKey !== null && serviceCaptureFingerprint(existingNote) !== captureFingerprint)) {
            throw new BackupValidationError('Erfassungsnachweis-Kollision: Schlüssel, Fingerabdruck und tatsächliche Ziel-Leistungsdaten stimmen nicht überein');
          }
          if (deletedAt !== null && existingNote.deletedAt === null) {
            throw new BackupValidationError('Gelöschter Quell-Erfassungsnachweis kollidiert mit einer aktiven Zielnotiz. Zielentscheidung separat prüfen; Zusammenführen verändert oder öffnet keine Erfassungsnachweise.');
          }
          if (invoiceId !== null && existingNote.invoiceId !== invoiceId) {
            // Importing a source invoice while leaving its matching receipt open
            // would make the same activity billable again. Never silently link,
            // orphan or replace either branch of this lifecycle conflict.
            throw new BackupValidationError('Rechnungszuordnung der Quelle widerspricht dem Ziel-Erfassungsnachweis. Zusammenführen wurde vollständig abgebrochen; keine Leistung wird erneut geöffnet oder automatisch zugeordnet.');
          }
          // An older open source preserves a later target claim/tombstone;
          // a source claim is accepted only for the same mapped target invoice.
          billingNoteMap.set(sourceId, existingNote.id);
          result.billingNotes.skipped += 1;
          continue;
        }
        const created = await tx.billingNote.create({ data: {
          ...command, captureKey, captureFingerprint, deletedAt, invoiceId,
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
          reviewedSourceSnapshot: document.reviewedSourceSnapshot == null ? Prisma.DbNull : asJson({ ...asRecord(document.reviewedSourceSnapshot, 'reviewedSourceSnapshot'), ownerId: userId }, 'reviewedSourceSnapshot'),
          aiExtraction: document.aiExtraction == null ? Prisma.DbNull : asJson(restoredAiExtractionState(document.aiExtraction, String(document.originalSha256)), 'purchaseDocument.aiExtraction'),
          aiDraftProvenance: document.aiDraftProvenance == null ? Prisma.DbNull : asJson(document.aiDraftProvenance, 'purchaseDocument.aiDraftProvenance'),
          aiApprovedSnapshot: document.aiApprovedSnapshot == null ? Prisma.DbNull : asJson(document.aiApprovedSnapshot, 'purchaseDocument.aiApprovedSnapshot'),
          reviewDraft: document.reviewDraft == null ? Prisma.DbNull : asJson(document.reviewDraft, 'purchaseDocument.reviewDraft'),
          reviewDraftSearch: document.reviewDraft == null ? null : [parsePurchaseReviewDraft(document.reviewDraft).supplierName, parsePurchaseReviewDraft(document.reviewDraft).invoiceNumber].filter(Boolean).join(' · '),
          reviewDraftSavedAt: sourceDate(document.reviewDraftSavedAt, 'purchaseDocument.reviewDraftSavedAt'),
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

      try { await restoreValidationReports(tx, userId, validationReports); }
      catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Prüfberichtskonflikt'); }

      for (const income of incomes) {
        const sourceId = asOptionalInt(income.id, 'income.id')!;
        const description = asRequiredString(income.description, 'income.description', 255);
        const amount = asOptionalFinite(income.amount, 'income.amount') ?? 0;
        const date = asDate(income.date, 'income.date', RESTORE_DEFAULT_DATE)!;
        const customerId = relationMapValue(customerMap, income.customerId, 'income.customerId');
        const invoiceId = relationMapValue(invoiceMap, income.invoiceId, 'income.invoiceId');
        const taxRelevant = asOptionalBoolean(income.taxRelevant, 'income.taxRelevant') ?? true;
        const sourcePayment = sourcePaymentByIncome.get(sourceId);
        const replayIncomeId = replayIncomeBySource.get(sourceId);
        // Journal allocations only reuse the verified event's own Income. Two
        // intentional equal-looking allocations must remain distinct rows.
        let existing = replayIncomeId === undefined ? null : await tx.income.findFirst({ where: { id: replayIncomeId, userId, invoiceId } });
        if (replayIncomeId !== undefined && !existing) throw new BackupValidationError('Verifizierte Zahlungseinnahme fehlt im Ziel');
        if (!sourcePayment && invoiceId !== null) {
          if ((existingPaymentsByInvoice.get(invoiceId) ?? []).length) {
            throw new BackupValidationError('Alte Einnahme ohne Zahlungsidentität widerspricht dem unveränderlichen Zahlungsereignis.');
          }
          const candidates = await tx.income.findMany({ where: { userId, invoiceId } });
          if (candidates.length > 1) throw new BackupValidationError('Mehrdeutige historische Rechnungseinnahmen im Ziel');
          existing = candidates[0] ?? null;
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

      for (const operation of paymentOperations) {
        const existing = existingOperations.find(row => row.idempotencyKey === operation.idempotencyKey);
        if (existing) {
          if (existing.kind !== operation.kind || existing.createdAt.getTime() !== asDate(operation.createdAt, 'operation.createdAt')!.getTime()) throw new BackupValidationError('Abweichender Finanzaktionsbeleg.');
          result.paymentOperations.skipped++;
        } else {
          await tx.paymentOperation.create({ data: { userId, idempotencyKey: String(operation.idempotencyKey), kind: String(operation.kind), createdAt: asDate(operation.createdAt, 'operation.createdAt')! } });
          result.paymentOperations.imported++;
        }
      }

      for (const [index, event] of paymentJournalEvents.entries()) {
        const label = `paymentJournalEvents[${index}]`;
        const values = paymentEventValues(event, label);
        const invoiceId = relationMapValue(invoiceMap, event.invoiceId, `${label}.invoiceId`)!;
        const incomeId = relationMapValue(incomeMap, event.incomeId, `${label}.incomeId`);
        const targetIncome = incomeId === null ? null : await tx.income.findFirst({ where: { id: incomeId, userId, invoiceId } });
        if (incomeId !== null && !targetIncome) {
          throw new BackupValidationError(`${label}: vorhandene Zieleinnahme stimmt nicht mit dem Zahlungsbezug überein`);
        }
        const existing = existingPaymentByKey.get(values.idempotencyKey);
        if (existing) {
          if (existing.invoiceId !== invoiceId || existing.incomeId !== incomeId
            || existing.idempotencyKey !== values.idempotencyKey || existing.amountCents !== values.amountCents
            || existing.currency !== values.currency || existing.source !== values.source
            || existing.dateCertainty !== values.dateCertainty || existing.reference !== values.reference
            || existing.paidAt?.getTime() !== values.paidAt?.getTime()
            || existing.createdAt.getTime() !== values.createdAt.getTime()) {
            throw new BackupValidationError(`${label}: Kollision mit abweichendem unveränderlichem Zahlungsereignis`);
          }
          const sourceId = asOptionalInt(event.id, `${label}.id`)!;
          const identity = JSON.stringify([sourceUserId, sourceId]);
          if (sourceUserId && !existingPaymentSourceIdentities.has(identity) && !(sourceUserId === userId && sourceId === existing.id)) {
            await createFinancialAuditLog({ userId, action: 'RESTORE', entityType: 'Invoice', entityId: invoiceId,
              newValues: { paymentJournalEventId: existing.id, amountCents: existing.amountCents, paidAt: existing.paidAt, dateCertainty: existing.dateCertainty, incomeId: existing.incomeId, sourceEventId: sourceId, sourceUserId },
              metadata: { actorId: userId, tenantId: userId, operation: 'payment-journal.restore', identityOnly: true,
                originalReference: `source:${sourceUserId}:payment:${sourceId}`, reason: 'Zusätzliche verifizierte Quellidentität eines unveränderten Originalzahlungsnachweises; keine neue Geldbewegung.' },
            }, tx);
            existingPaymentSourceIdentities.set(identity, existing.id);
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
            dateCertainty: created.dateCertainty, incomeId: created.incomeId, sourceEventId: event.id, sourceUserId },
          metadata: { actorId: userId, tenantId: userId, operation: 'payment-journal.restore',
            originalReference: `backup:${backupId}:payment:${String(event.id)}`,
            reason: 'Unveränderliches Zahlungsereignis mit ursprünglichem Datumsnachweis wiederhergestellt.' },
        }, tx);
      }

      // Verified lifecycle advancement belongs before refund insertion: the DB
      // ownership trigger checks the already-cancelled original, in this same transaction.
      for (const [invoiceId, projection] of projectionUpdates) {
        await tx.invoice.update({ where: { id: invoiceId, userId }, data: projection });
      }

      for (const adjustment of paymentAdjustments) {
        const invoiceId = relationMapValue(invoiceMap, adjustment.invoiceId, 'adjustment.invoiceId')!;
        const originalPaymentId = relationMapValue(paymentJournalMap, adjustment.originalPaymentId, 'adjustment.originalPaymentId')!;
        const cancellationInvoiceId = relationMapValue(invoiceMap, adjustment.cancellationInvoiceId, 'adjustment.cancellationInvoiceId');
        const existing = existingAdjustments.find(row => row.idempotencyKey === adjustment.idempotencyKey);
        if (existing) {
          if (existing.invoiceId !== invoiceId || existing.originalPaymentId !== originalPaymentId || existing.cancellationInvoiceId !== cancellationInvoiceId || !sameAdjustmentEvidence(existing as unknown as JsonRecord, adjustment)) throw new BackupValidationError('Kollision mit abweichender Zahlungsberichtigung.');
          const sourceId = asOptionalInt(adjustment.id, 'adjustment.id')!;
          const identity = JSON.stringify([sourceUserId, sourceId]);
          if (sourceUserId && !existingAdjustmentSourceIdentities.has(identity) && !(sourceUserId === userId && sourceId === existing.id)) {
            await createFinancialAuditLog({ userId, action: 'RESTORE', entityType: 'Invoice', entityId: invoiceId,
              newValues: { paymentAdjustmentId: existing.id, originalPaymentId, kind: existing.kind, amountCents: existing.amountCents, sourceAdjustmentId: sourceId, sourceUserId, fiscalMappingStatus: 'UNREVIEWED' },
              metadata: { actorId: userId, tenantId: userId, operation: 'payment-adjustment.restore', identityOnly: true,
                originalReference: `source:${sourceUserId}:adjustment:${sourceId}`, reason: 'Zusätzliche verifizierte Quellidentität einer unveränderten Zahlungsberichtigung; keine neue Geldbewegung.' },
            }, tx);
            existingAdjustmentSourceIdentities.set(identity, existing.id);
          }
          result.paymentAdjustments.skipped++; continue;
        }
        const created = await tx.paymentAdjustment.create({ data: { ...paymentAdjustmentValues(adjustment), userId, invoiceId, originalPaymentId, cancellationInvoiceId } });
        result.paymentAdjustments.imported++;
        await createFinancialAuditLog({ userId, action: 'RESTORE', entityType: 'Invoice', entityId: invoiceId,
          newValues: { paymentAdjustmentId: created.id, originalPaymentId, kind: created.kind, amountCents: created.amountCents, actionDate: created.actionDate, accountingEffectiveOn: created.accountingEffectiveOn, sourceAdjustmentId: adjustment.id, sourceUserId, fiscalMappingStatus: 'UNREVIEWED' },
          metadata: { actorId: userId, tenantId: userId, operation: 'payment-adjustment.restore', originalReference: `backup:${backupId}:adjustment:${String(adjustment.id)}`, reason: 'Unveränderliche originalverknüpfte Zahlungsberichtigung wiederhergestellt.' },
        }, tx);
      }

      // A final union check covers every mapped invoice, including newly
      // created documents. No restore writer can commit a hidden orphan or
      // aggregate overpayment even if source-to-target mappings overlap.
      const journalInvoiceIds = [...new Set([...sourcePaymentsByInvoice.keys()].map((id) => invoiceMap.get(id)!))];
      if (journalInvoiceIds.length) {
        const [targetInvoices, targetIncomes, targetEvents] = await Promise.all([
          tx.invoice.findMany({ where: { userId, id: { in: journalInvoiceIds } } }),
          tx.income.findMany({ where: { userId, invoiceId: { in: journalInvoiceIds } } }),
          tx.paymentJournalEvent.findMany({ where: { userId, invoiceId: { in: journalInvoiceIds } } }),
        ]);
        const targetAdjustments = await tx.paymentAdjustment.findMany({ where: { userId, invoiceId: { in: journalInvoiceIds } } });
        validatePaymentJournalBackup({ user: { id: userId }, invoices: targetInvoices, incomes: targetIncomes, paymentJournalEvents: targetEvents, paymentAdjustments: targetAdjustments }, CURRENT_BACKUP_VERSION);

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

      // Resolve both original command keys and imported portable identities without
      // rewriting immutable rows. Own backups and A→B→A exports are the same history.
      const existingConfirmedReminders = await tx.reminder.findMany({ where: { userId, balanceSnapshot: { not: Prisma.DbNull } } });
      const existingReminderByIdentity = new Map<string, (typeof existingConfirmedReminders)[number]>();
      for (const existing of existingConfirmedReminders) {
        let identity: string;
        try { identity = restoredReminderKey(existing.idempotencyKey, userId, existing.id); }
        catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Bestehende Mahnherkunft ist ungültig.'); }
        if (existingReminderByIdentity.has(identity)) throw new BackupValidationError('Bestehende bestätigte Mahnungen enthalten mehrdeutige Quellidentitäten. Bitte die unveränderliche Historie separat prüfen.');
        existingReminderByIdentity.set(identity, existing);
      }
      for (const reminder of reminders) {
        const sourceId = asOptionalInt(reminder.id, 'reminder.id');
        const invoiceId = relationMapValue(invoiceMap, reminder.invoiceId, 'reminder.invoiceId');
        if (!invoiceId) throw new BackupValidationError('reminder.invoiceId fehlt');
        const sourceKey = asOptionalString(reminder.idempotencyKey, 'reminder.idempotencyKey', 128);
        let idempotencyKey: string | null = null;
        if (reminder.balanceSnapshot != null) {
          if (sourceId === null || !sourceUserId?.trim()) throw new BackupValidationError('Bestätigte Mahnung benötigt stabile Quellherkunft.');
          try { idempotencyKey = restoredReminderKey(sourceKey, sourceUserId, sourceId); }
          catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Ungültige Mahnherkunft.'); }
        }
        const snapshot = reminder.balanceSnapshot == null ? Prisma.DbNull : asJson(reminder.balanceSnapshot, 'reminder.balanceSnapshot');
        const prior = idempotencyKey ? existingReminderByIdentity.get(idempotencyKey) : null;
        if (prior) {
          if (prior.invoiceId !== invoiceId || hashJson(prior.balanceSnapshot) !== hashJson(reminder.balanceSnapshot)
            || prior.reminderLevel !== (asOptionalInt(reminder.reminderLevel, 'reminder.reminderLevel') ?? 1)
            || prior.fee !== (asOptionalFinite(reminder.fee, 'reminder.fee') ?? 0)
            || prior.notes !== asOptionalString(reminder.notes, 'reminder.notes', 5_000)
            || prior.dueDate.toISOString() !== asDate(reminder.dueDate, 'reminder.dueDate')?.toISOString()
            || prior.createdAt.toISOString() !== asDate(reminder.createdAt, 'reminder.createdAt')?.toISOString()
            || prior.sentAt.toISOString() !== asDate(reminder.sentAt, 'reminder.sentAt')?.toISOString()) throw new BackupValidationError('Wiederhergestellte Mahnidentität widerspricht bestehender Restbetragsbestätigung.');
          if (sourceId !== null) reminderMap.set(sourceId, prior.id);
          result.reminders.skipped += 1;
          continue;
        }
        const created = await tx.reminder.create({ data: {
          invoiceId,
          idempotencyKey,
          balanceSnapshot: snapshot,
          reminderLevel: asOptionalInt(reminder.reminderLevel, 'reminder.reminderLevel') ?? 1,
          sentAt: asDate(reminder.sentAt, 'reminder.sentAt', new Date())!,
          dueDate: asDate(reminder.dueDate, 'reminder.dueDate', new Date())!,
          fee: asOptionalFinite(reminder.fee, 'reminder.fee') ?? 0,
          notes: asOptionalString(reminder.notes, 'reminder.notes', 5_000),
          createdAt: asDate(reminder.createdAt, 'reminder.createdAt', new Date())!,
          userId,
        } });
        if (sourceId !== null) reminderMap.set(sourceId, created.id);
        if (idempotencyKey) existingReminderByIdentity.set(idempotencyKey, created);
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
        const values = {
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
        };
        // A journal-linked Income is a verified one-to-one financial identity,
        // not an amount/date duplicate heuristic. Preserve it on ancestor/replay.
        if (values.incomeId !== null && await tx.paymentJournalEvent.findFirst({ where: { userId, incomeId: values.incomeId }, select: { id: true } })) {
          const existing = await tx.cashTransaction.findUnique({ where: { incomeId: values.incomeId } });
          if (existing) {
            const equal = existing.userId === userId && existing.cashBookId === values.cashBookId && existing.expenseId === values.expenseId
              && existing.type === values.type && existing.description === values.description && existing.amount === values.amount
              && existing.date.getTime() === values.date.getTime() && existing.createdAt.getTime() === values.createdAt.getTime()
              && existing.category === values.category && existing.receiptNumber === values.receiptNumber && existing.taxRelevant === values.taxRelevant && existing.notes === values.notes;
            if (!equal) throw new BackupValidationError('Kassenbezug der unveränderlichen Originalzahlung widerspricht dem Ziel.');
            if (sourceId !== null) cashTransactionMap.set(sourceId, existing.id);
            result.cashTransactions.skipped++; continue;
          }
        }
        const created = await tx.cashTransaction.create({ data: values });
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
        serviceArticles: serviceArticleMap,
        serviceProjects: serviceProjectMap,
        billingNotes: billingNoteMap,
        expenses: expenseMap,
        incomes: incomeMap,
        paymentJournalEvents: paymentJournalMap,
        invoices: invoiceMap,
        purchaseDocuments: purchaseDocumentMap,
        recurringExpenses: recurringMap,
        serviceBillingPlans: serviceBillingPlanMap,
        serviceBillingPeriods: serviceBillingPeriodMap,
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

      // Authoritative union validation belongs after every financial import,
      // especially CashTransaction links that may target existing adjusted roots.
      const completeGraph = { user: { id: userId }, invoices: await tx.invoice.findMany({ where: { userId } }), incomes: await tx.income.findMany({ where: { userId } }),
          paymentJournalEvents: await tx.paymentJournalEvent.findMany({ where: { userId } }), paymentAdjustments: await tx.paymentAdjustment.findMany({ where: { userId } }),
          paymentOperations: await tx.paymentOperation.findMany({ where: { userId } }), auditLogs: await tx.auditLog.findMany({ where: { userId } }), cashTransactions: await tx.cashTransaction.findMany({ where: { userId } }) };
      try { validatePaymentAdjustmentBackup(completeGraph, CURRENT_SCHEMA_VERSION); } catch (error) { throw new BackupValidationError(error instanceof Error ? error.message : 'Zahlungsberichtigungsgraph ungültig'); }

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
