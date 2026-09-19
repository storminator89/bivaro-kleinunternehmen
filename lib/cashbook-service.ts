import { Prisma } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';

export class CashbookError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function cashAmount(value: unknown, positive = true): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e12 || (positive && amount <= 0)) {
    throw new CashbookError('Ungültiger Betrag');
  }
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  // Cashbook amounts are rounded to cents (the legacy storage is Float).
  // A positive sub-cent value must not
  // silently become a zero-value booking after rounding.
  if (positive && rounded <= 0) throw new CashbookError('Ungültiger Betrag');
  return rounded;
}

function idValue(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new CashbookError('Ungültige ID');
  return id;
}

function dateValue(value: unknown): Date {
  const date = value === undefined ? new Date() : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new CashbookError('Ungültiges Datum');
  return date;
}

function textValue(value: unknown, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > 4000 || (required && !value.trim())) throw new CashbookError('Ungültiger Text');
  return value.trim() || null;
}

function cents(value: number): number {
  const result = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isFinite(value) || !Number.isSafeInteger(result)) {
    throw new CashbookError('Kassenbetrag überschreitet den sicher berechenbaren Bereich', 409);
  }
  return result;
}

/** The UI sends date-only cashbook values, so compare the business date. */
function sameBusinessDate(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

/** Validate the complete chronology; update only the affected suffix. */
export async function recalculateCashBalances(tx: Prisma.TransactionClient, cashBookId: number, userId: string, from?: Date) {
  const book = await tx.cashBook.findFirst({ where: { id: cashBookId, userId } });
  if (!book) throw new CashbookError('Kassenbuch nicht gefunden', 404);
  let balanceCents = cents(book.initialBalance);
  if (book.initialBalance < 0) throw new CashbookError('Der Kassenanfangsbestand darf nicht negativ sein', 409);
  const entries = await tx.cashTransaction.findMany({
    where: { cashBookId, userId },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, date: true, type: true, amount: true, runningBalance: true },
  });
  const updates: Array<{ id: number; runningBalance: number }> = [];
  for (const entry of entries) {
    const amountCents = cents(entry.amount);
    if (!['EINNAHME', 'AUSGABE'].includes(entry.type) || amountCents <= 0) {
      throw new CashbookError('Das Kassenbuch enthält eine ungültige Buchung; bitte den Bestand prüfen', 409);
    }
    balanceCents += (entry.type === 'EINNAHME' ? 1 : -1) * amountCents;
    if (!Number.isSafeInteger(balanceCents)) throw new CashbookError('Kassensaldo überschreitet den sicher berechenbaren Bereich', 409);
    if (balanceCents < 0) {
      throw new CashbookError(`Die Buchung würde einen negativen Kassenbestand am ${entry.date.toISOString().slice(0, 10)} erzeugen. Bitte Betrag und Reihenfolge prüfen.`, 409);
    }
    if ((!from || entry.date >= from) && entry.runningBalance !== balanceCents / 100) {
      updates.push({ id: entry.id, runningBalance: balanceCents / 100 });
    }
  }
  // No balance write occurs until every intermediate balance is valid.
  for (const update of updates) {
    await tx.cashTransaction.update({ where: { id: update.id }, data: { runningBalance: update.runningBalance } });
  }
}

export async function createCashTransaction(userId: string, body: Record<string, unknown>) {
  const cashBookId = idValue(body.cashBookId);
  if (!['EINNAHME', 'AUSGABE'].includes(String(body.type))) throw new CashbookError('Ungültiger Buchungstyp');
  const amount = cashAmount(body.amount);
  const description = textValue(body.description, true)!;
  const date = dateValue(body.date);
  const incomeId = body.incomeId == null ? null : idValue(body.incomeId);
  const expenseId = body.expenseId == null ? null : idValue(body.expenseId);
  if ((incomeId && body.type !== 'EINNAHME') || (expenseId && body.type !== 'AUSGABE')) throw new CashbookError('Beleg passt nicht zum Buchungstyp');
  if (body.taxRelevant !== undefined && typeof body.taxRelevant !== 'boolean') throw new CashbookError('Ungültige Steuerrelevanz');
  const entry = await inTransaction(async tx => {
    if (!await tx.cashBook.findFirst({ where: { id: cashBookId, userId, isActive: true } })) throw new CashbookError('Kassenbuch nicht gefunden oder inaktiv', 404);
    if (incomeId) {
      const income = await tx.income.findFirst({ where: { id: incomeId, userId }, select: { amount: true, date: true, cashTransaction: { select: { id: true } } } });
      if (!income) throw new CashbookError('Einnahme nicht gefunden', 404);
      if (income.cashTransaction) throw new CashbookError('Einnahme ist bereits mit dem Kassenbuch verknüpft', 409);
      if (cents(income.amount) !== cents(amount) || !sameBusinessDate(income.date, date)) {
        throw new CashbookError('Betrag und Datum müssen mit der verknüpften Einnahme übereinstimmen', 409);
      }
    }
    if (expenseId) {
      const expense = await tx.expense.findFirst({ where: { id: expenseId, userId }, select: { amount: true, date: true, cashTransaction: { select: { id: true } } } });
      if (!expense) throw new CashbookError('Ausgabe nicht gefunden', 404);
      if (expense.cashTransaction) throw new CashbookError('Ausgabe ist bereits mit dem Kassenbuch verknüpft', 409);
      if (cents(expense.amount) !== cents(amount) || !sameBusinessDate(expense.date, date)) {
        throw new CashbookError('Betrag und Datum müssen mit der verknüpften Ausgabe übereinstimmen', 409);
      }
    }
    const created = await tx.cashTransaction.create({ data: {
      cashBookId, userId, type: String(body.type), amount, date, description, runningBalance: 0, incomeId, expenseId,
      category: textValue(body.category), receiptNumber: textValue(body.receiptNumber), notes: textValue(body.notes),
      taxRelevant: body.taxRelevant === undefined ? true : body.taxRelevant as boolean,
    } });
    await recalculateCashBalances(tx, cashBookId, userId, date);
    const persisted = await tx.cashTransaction.findUniqueOrThrow({ where: { id: created.id } });
    await createFinancialAuditLog({
      userId, action: 'CREATE', entityType: 'CashTransaction', entityId: persisted.id,
      entityName: persisted.description, newValues: { ...persisted },
      metadata: { actorId: userId, tenantId: userId, operation: 'cash.create', originalReference: `cashbook:${cashBookId}`, reason: 'cash transaction recorded' },
    }, tx);
    return persisted;
  });
  return entry;
}

export async function updateCashTransaction(userId: string, id: number, body: Record<string, unknown>) {
  idValue(id);
  const data: Prisma.CashTransactionUpdateInput = {};
  if (body.type !== undefined) {
    if (!['EINNAHME', 'AUSGABE'].includes(String(body.type))) throw new CashbookError('Ungültiger Buchungstyp');
    data.type = String(body.type);
  }
  if (body.date !== undefined) data.date = dateValue(body.date);
  if (body.amount !== undefined) data.amount = cashAmount(body.amount);
  if (body.description !== undefined) data.description = textValue(body.description, true)!;
  if (body.category !== undefined) data.category = textValue(body.category);
  if (body.receiptNumber !== undefined) data.receiptNumber = textValue(body.receiptNumber);
  if (body.notes !== undefined) data.notes = textValue(body.notes);
  if (body.taxRelevant !== undefined) {
    if (typeof body.taxRelevant !== 'boolean') throw new CashbookError('Ungültige Steuerrelevanz');
    data.taxRelevant = body.taxRelevant;
  }
  const result = await inTransaction(async tx => {
    const old = await tx.cashTransaction.findFirst({ where: { id, userId } });
    if (!old) throw new CashbookError('Buchung nicht gefunden', 404);
    if ((old.incomeId || old.expenseId) && (data.amount !== undefined || data.type !== undefined || data.date !== undefined)) {
      throw new CashbookError('Verknüpfte Buchungen müssen zusammen mit dem Beleg korrigiert werden', 409);
    }
    await tx.cashTransaction.update({ where: { id, userId }, data });
    const from = data.date instanceof Date && data.date < old.date ? data.date : old.date;
    await recalculateCashBalances(tx, old.cashBookId, userId, from);
    const entry = await tx.cashTransaction.findUniqueOrThrow({ where: { id } });
    await createFinancialAuditLog({
      userId, action: 'UPDATE', entityType: 'CashTransaction', entityId: id,
      entityName: entry.description, oldValues: { ...old }, newValues: { ...entry },
      metadata: { actorId: userId, tenantId: userId, operation: 'cash.update', originalReference: `cashbook:${old.cashBookId}:transaction:${id}`, reason: 'cash transaction corrected' },
    }, tx);
    return { old, entry };
  });
  return result.entry;
}

export async function deleteCashTransaction(userId: string, id: number) {
  idValue(id);
  await inTransaction(async tx => {
    const entry = await tx.cashTransaction.findFirst({ where: { id, userId } });
    if (!entry) throw new CashbookError('Buchung nicht gefunden', 404);
    await tx.cashTransaction.delete({ where: { id, userId } });
    await recalculateCashBalances(tx, entry.cashBookId, userId, entry.date);
    await createFinancialAuditLog({
      userId, action: 'DELETE', entityType: 'CashTransaction', entityId: id,
      entityName: entry.description, oldValues: { ...entry },
      metadata: { actorId: userId, tenantId: userId, operation: 'cash.delete', originalReference: `cashbook:${entry.cashBookId}:transaction:${id}`, reason: 'cash transaction deleted' },
    }, tx);
  });
  return { success: true };
}
