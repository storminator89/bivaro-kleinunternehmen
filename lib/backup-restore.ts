import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import { recalculateCashBalances } from '@/lib/cashbook-service';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import {
  deleteTenantFile,
  createTenantStoredName,
  isSafeLegacyFileName,
  isSafeStoredFileName,
  writeTenantFile,
} from '@/lib/upload-path';

type JsonRecord = Record<string, unknown>;
type FileKind = 'invoice' | 'receipt' | 'logo';

export type RestoreFileResolver = (
  kind: FileKind,
  sourceName: string,
) => Promise<Uint8Array | null>;

export class BackupValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

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
  expenses: { imported: number; skipped: number };
  incomes: { imported: number; skipped: number };
  invoices: { imported: number; skipped: number };
  templates: { imported: number; skipped: number };
  files: { imported: number; skipped: number };
  settings: { imported: boolean };
  recurringExpenses: { imported: number; skipped: number };
  reminders: { imported: number; skipped: number };
  cashBooks: { imported: number; skipped: number };
  cashTransactions: { imported: number; skipped: number };
  documentations: { imported: number; skipped: number };
  warnings: string[];
};

type ValidatedBackup = {
  version: string;
  data: JsonRecord;
};

const ARRAY_KEYS = [
  'customers', 'expenses', 'incomes', 'invoices', 'templates',
  'recurringExpenses', 'reminders', 'cashBooks', 'cashTransactions',
  'documentations', 'apiKeys',
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
      throw new BackupValidationError(`${key} enthält doppelte oder ungültige IDs`);
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
}

/** Validate shape, scalar values, IDs and all relations before any mutation. */
export function validateBackupForRestore(backup: unknown): ValidatedBackup {
  const root = asRecord(backup, 'Backup');
  const version = asRequiredString(root.version, 'Backup-Version', 32);
  if (version !== '2.0') throw new BackupValidationError(`Nicht unterstützte Backup-Version ${version}`);
  const data = asRecord(root.data, 'Backup-Daten');

  const arrays = Object.fromEntries(ARRAY_KEYS.map((key) => [key, asArray(data, key)]));
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

  arrays.invoices.forEach((invoice, index) => {
    asRequiredString(invoice.fileName, `invoices[${index}].fileName`, 255);
    validateStoredName(invoice.storedFileName, `invoices[${index}].storedFileName`);
    asOptionalString(invoice.invoiceNumber, `invoices[${index}].invoiceNumber`, 255);
    asOptionalFinite(invoice.totalAmount, `invoices[${index}].totalAmount`);
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

  if (data.settings !== undefined && data.settings !== null) asRecord(data.settings, 'settings');
  validateBackupReferences(data, sets);
  return { version, data };
}

function resultTemplate(overwrite: boolean): RestoreResult {
  return {
    overwriteMode: overwrite,
    deleted: overwrite ? 'Alle bestehenden Daten wurden gelöscht' : undefined,
    customers: { imported: 0, skipped: 0 },
    expenses: { imported: 0, skipped: 0 },
    incomes: { imported: 0, skipped: 0 },
    invoices: { imported: 0, skipped: 0 },
    templates: { imported: 0, skipped: 0 },
    files: { imported: 0, skipped: 0 },
    settings: { imported: false },
    recurringExpenses: { imported: 0, skipped: 0 },
    reminders: { imported: 0, skipped: 0 },
    cashBooks: { imported: 0, skipped: 0 },
    cashTransactions: { imported: 0, skipped: 0 },
    documentations: { imported: 0, skipped: 0 },
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

async function deleteUserData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.cashTransaction.deleteMany({ where: { userId } });
  await tx.reminder.deleteMany({ where: { userId } });
  await tx.invoice.updateMany({ where: { userId }, data: { originalInvoiceId: null, convertedFromQuoteId: null } });
  await tx.income.deleteMany({ where: { userId } });
  await tx.expense.deleteMany({ where: { userId } });
  await tx.cashBook.deleteMany({ where: { userId } });
  await tx.documentation.deleteMany({ where: { userId } });
  await tx.recurringExpense.deleteMany({ where: { userId } });
  await tx.apiLog.deleteMany({ where: { userId } });
  await tx.apiKey.deleteMany({ where: { userId } });
  await tx.invoiceTemplate.deleteMany({ where: { userId } });
  await tx.invoice.deleteMany({ where: { userId } });
  await tx.customer.deleteMany({ where: { userId } });
  await tx.settings.deleteMany({ where: { userId } });
  // AuditLog is intentionally preserved as an immutable restore trail.
}

export async function restoreBackupData(options: RestoreOptions): Promise<RestoreResult> {
  const { userId, overwrite, resolveFile } = options;
  const { data } = validateBackupForRestore(options.backup);
  const result = resultTemplate(overwrite);
  const stagedFiles = new Set<string>();
  const usedFiles = new Set<string>();
  const fileMap = new Map<string, string>();
  const missingFiles = new Set<string>();

  const stageFile = async (kind: FileKind, sourceName: string, originalName: string): Promise<string> => {
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

  try {
    const customers = asArray(data, 'customers');
    const expenses = asArray(data, 'expenses');
    const incomes = asArray(data, 'incomes');
    const invoices = asArray(data, 'invoices');
    const templates = asArray(data, 'templates');
    const recurringExpenses = asArray(data, 'recurringExpenses');
    const reminders = asArray(data, 'reminders');
    const cashBooks = asArray(data, 'cashBooks');
    const cashTransactions = asArray(data, 'cashTransactions');
    const documentations = asArray(data, 'documentations');
    const apiKeys = asArray(data, 'apiKeys');
    const settings = data.settings === null || data.settings === undefined ? null : asRecord(data.settings, 'settings');
    if (apiKeys.length > 0) {
      result.warnings.push(`${apiKeys.length} API-Schlüssel wurden nicht übernommen; aus Sicherheitsgründen müssen neue Schlüssel erstellt werden.`);
    }

    // Stage all referenced files before touching the database. JSON backups do
    // not contain bytes; those references stay opaque and are reported as
    // missing instead of creating a corrupt empty PDF/receipt.
    for (const invoice of invoices) {
      const sourceName = validateStoredName(invoice.storedFileName, 'invoice.storedFileName')
        ?? `invoice-${String(invoice.id)}`;
      await stageFile('invoice', sourceName, asRequiredString(invoice.fileName, 'invoice.fileName', 255));
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
      if (overwrite) await deleteUserData(tx, userId);

      const customerMap = new Map<number, number>();
      const invoiceMap = new Map<number, number>();
      const cashBookMap = new Map<number, number>();
      const recurringMap = new Map<number, number>();
      const expenseMap = new Map<number, number>();
      const incomeMap = new Map<number, number>();
      const createdInvoiceIds = new Set<number>();

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

      // Recurring expenses must precede expenses so execution keys survive.
      for (const recurring of recurringExpenses) {
        const sourceId = asOptionalInt(recurring.id, 'recurringExpense.id')!;
        const created = await tx.recurringExpense.create({ data: {
          description: asRequiredString(recurring.description, 'recurringExpense.description', 255),
          amount: asOptionalFinite(recurring.amount, 'recurringExpense.amount') ?? 0,
          category: asOptionalString(recurring.category, 'recurringExpense.category', 255),
          taxRelevant: asOptionalBoolean(recurring.taxRelevant, 'recurringExpense.taxRelevant') ?? true,
          taxDeductiblePercentage: asOptionalFinite(recurring.taxDeductiblePercentage, 'recurringExpense.taxDeductiblePercentage') ?? 100,
          interval: asRequiredString(recurring.interval, 'recurringExpense.interval', 32),
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
        const existing = invoiceNumber
          ? await tx.invoice.findFirst({ where: { userId, invoiceNumber } })
          : null;
        if (existing) {
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
        const created = await tx.expense.create({ data: {
          description: asRequiredString(expense.description, 'expense.description', 255),
          amount: asOptionalFinite(expense.amount, 'expense.amount') ?? 0,
          date: asDate(expense.date, 'expense.date', new Date())!,
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

      for (const income of incomes) {
        const sourceId = asOptionalInt(income.id, 'income.id')!;
        const created = await tx.income.create({ data: {
          description: asRequiredString(income.description, 'income.description', 255),
          amount: asOptionalFinite(income.amount, 'income.amount') ?? 0,
          date: asDate(income.date, 'income.date', new Date())!,
          customerId: relationMapValue(customerMap, income.customerId, 'income.customerId'),
          invoiceId: relationMapValue(invoiceMap, income.invoiceId, 'income.invoiceId'),
          taxRelevant: asOptionalBoolean(income.taxRelevant, 'income.taxRelevant') ?? true,
          userId,
        } });
        incomeMap.set(sourceId, created.id);
        result.incomes.imported += 1;
      }

      if (settings) {
        const mappedLogo = sourceLogo && !missingFiles.has(`logo:${sourceLogo}`)
          ? fileMap.get(`logo:${sourceLogo}`)
          : null;
        const settingData = {
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
        await tx.settings.upsert({ where: { userId }, update: settingData, create: { userId, ...settingData } });
        if (mappedLogo) usedFiles.add(mappedLogo);
        result.settings.imported = true;
      }

      for (const template of templates) {
        const name = asRequiredString(template.name, 'template.name', 255);
        const existingId = existingTemplatesByName.get(name);
        if (existingId) result.templates.skipped += 1;
        else {
          await tx.invoiceTemplate.create({ data: {
            name,
            data: asJson(template.data, 'template.data'),
            createdAt: asDate(template.createdAt, 'template.createdAt', new Date())!,
            updatedAt: asDate(template.updatedAt, 'template.updatedAt', new Date())!,
            userId,
          } });
          result.templates.imported += 1;
        }
      }

      for (const reminder of reminders) {
        const invoiceId = relationMapValue(invoiceMap, reminder.invoiceId, 'reminder.invoiceId');
        if (!invoiceId) throw new BackupValidationError('reminder.invoiceId fehlt');
        await tx.reminder.create({ data: {
          invoiceId,
          reminderLevel: asOptionalInt(reminder.reminderLevel, 'reminder.reminderLevel') ?? 1,
          sentAt: asDate(reminder.sentAt, 'reminder.sentAt', new Date())!,
          dueDate: asDate(reminder.dueDate, 'reminder.dueDate', new Date())!,
          fee: asOptionalFinite(reminder.fee, 'reminder.fee') ?? 0,
          notes: asOptionalString(reminder.notes, 'reminder.notes', 5_000),
          createdAt: asDate(reminder.createdAt, 'reminder.createdAt', new Date())!,
          userId,
        } });
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

      for (const transaction of cashTransactions) {
        const cashBookId = relationMapValue(cashBookMap, transaction.cashBookId, 'cashTransaction.cashBookId');
        if (!cashBookId) throw new BackupValidationError('cashTransaction.cashBookId fehlt');
        await tx.cashTransaction.create({ data: {
          date: asDate(transaction.date, 'cashTransaction.date', new Date())!,
          createdAt: asDate(transaction.createdAt, 'cashTransaction.createdAt', new Date())!,
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
        result.cashTransactions.imported += 1;
      }

      const importedCashBookIds = new Set(cashBookMap.values());
      for (const cashBookId of importedCashBookIds) {
        await recalculateCashBalances(tx, cashBookId, userId);
      }

      for (const doc of documentations) {
        await tx.documentation.create({ data: {
          version: asRequiredString(doc.version, 'documentation.version', 64),
          title: asOptionalString(doc.title, 'documentation.title', 255) ?? 'Verfahrensdokumentation',
          content: asRequiredString(doc.content, 'documentation.content', 2_000_000),
          createdAt: asDate(doc.createdAt, 'documentation.createdAt', new Date())!,
          updatedAt: asDate(doc.updatedAt, 'documentation.updatedAt', new Date())!,
          userId,
        } });
        result.documentations.imported += 1;
      }
    }, { maxWait: 15_000, timeout: 120_000 });

    for (const storedName of stagedFiles) {
      if (!usedFiles.has(storedName)) {
        try { await deleteTenantFile(userId, storedName); } catch { /* already absent */ }
        result.files.imported = Math.max(0, result.files.imported - 1);
        result.files.skipped += 1;
      }
    }
    return result;
  } catch (error) {
    for (const storedName of stagedFiles) {
      try { await deleteTenantFile(userId, storedName); } catch { /* rollback is best effort */ }
    }
    throw error;
  }
}
