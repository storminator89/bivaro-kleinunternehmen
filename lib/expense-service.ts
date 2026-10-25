import type { Prisma } from '@prisma/client';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { inTransaction } from '@/lib/db-transaction';
import { assertExpenseNotSourceLinked } from '@/lib/source-linked-expense';
import { assertManualRecordNotFinalized } from '@/lib/manual-financial-record-evidence';

export class ExpenseMutationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'ExpenseMutationError'; }
}
type ExpenseValues = Pick<Prisma.ExpenseUncheckedCreateInput, 'description' | 'amount' | 'date' | 'category' | 'receiptUrl' | 'taxRelevant' | 'taxDeductiblePercentage' | 'receiptFileName' | 'storedReceiptFileName' | 'depreciationYears'>;
// Whitelist: clients can never supply identity, origin, lifecycle or source links.
function values(input: Partial<ExpenseValues>): Partial<ExpenseValues> {
  return Object.fromEntries(['description', 'amount', 'date', 'category', 'receiptUrl', 'taxRelevant', 'taxDeductiblePercentage', 'receiptFileName', 'storedReceiptFileName', 'depreciationYears']
    .filter(key => input[key as keyof ExpenseValues] !== undefined).map(key => [key, input[key as keyof ExpenseValues]]));
}
function metadata(userId: string, operation: string, id: number) {
  return { actorId: userId, tenantId: userId, operation, originalReference: `expense:${id}`, reason: operation === 'expense.create' ? 'Expense created' : operation === 'expense.update' ? 'Expense updated' : 'Expense deleted' };
}
export async function createManualExpense(userId: string, input: ExpenseValues) {
  // Generic capture retains the established route-specific sign/precision
  // contract. Nonnegative exact-cent validation belongs to #54 lifecycle only.
  if (!Number.isFinite(input.amount)) throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Ungültiger Betrag');
  return inTransaction(async tx => {
    const expense = await tx.expense.create({ data: { ...values(input), description: input.description, amount: input.amount, userId, manualRecordState: 'RECORDED', manualRecordOrigin: 'MANUAL' } });
    await createFinancialAuditLog({ userId, action: 'CREATE', entityType: 'Expense', entityId: expense.id, entityName: expense.description, newValues: { ...expense }, metadata: metadata(userId, 'expense.create', expense.id) }, tx);
    return expense;
  });
}
async function current(tx: Prisma.TransactionClient, userId: string, id: number) {
  const expense = await tx.expense.findFirst({ where: { id, userId }, include: { cashTransaction: true } });
  if (!expense) throw new ExpenseMutationError(404, 'NOT_FOUND', 'Ausgabe nicht gefunden');
  assertManualRecordNotFinalized(expense);
  await assertExpenseNotSourceLinked(tx, expense.id);
  if (expense.cashTransaction) throw new ExpenseMutationError(409, 'LINKED_BOOKING', 'Mit dem Kassenbuch verknüpfte Ausgaben müssen dort geändert werden');
  return expense;
}
export async function updateManualExpense(userId: string, id: number, input: Partial<ExpenseValues>) {
  return inTransaction(async tx => {
    const before = await current(tx, userId, id);
    const expense = await tx.expense.update({ where: { id, userId, manualRecordRevision: before.manualRecordRevision, manualRecordState: { not: 'FINALIZED' } }, data: { ...values(input), manualRecordRevision: { increment: 1 } } });
    await createFinancialAuditLog({ userId, action: 'UPDATE', entityType: 'Expense', entityId: id, entityName: expense.description, oldValues: { ...before }, newValues: { ...expense }, metadata: metadata(userId, 'expense.update', id) }, tx);
    return expense;
  });
}
export async function deleteManualExpense(userId: string, id: number) {
  return inTransaction(async tx => {
    const before = await current(tx, userId, id);
    await tx.expense.delete({ where: { id, userId, manualRecordState: { not: 'FINALIZED' } } });
    await createFinancialAuditLog({ userId, action: 'DELETE', entityType: 'Expense', entityId: id, entityName: before.description, oldValues: { ...before }, metadata: metadata(userId, 'expense.delete', id) }, tx);
  });
}
