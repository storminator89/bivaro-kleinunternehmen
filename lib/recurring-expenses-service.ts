import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { auditCreate } from '@/lib/audit-log';
import { calculateNextExecution, endOfDay } from '@/lib/recurring-schedule';

// Keep catch-up transactions bounded; additional calls resume from nextExecution.
export const MAX_CATCHUP_PER_REQUEST = 120;

export async function executeRecurringExpenses(userId: string, id?: number, at = new Date()) {
  const today = endOfDay(at);
  const due = await prisma.recurringExpense.findMany({
    where: { userId, isActive: true, nextExecution: { lte: today }, ...(id ? { id } : {}) },
    orderBy: [{ nextExecution: 'asc' }, { id: 'asc' }], take: MAX_CATCHUP_PER_REQUEST,
  });
  const createdExpenses = [];
  const updatedRecurring = [];
  let remainingBudget = MAX_CATCHUP_PER_REQUEST;
  for (const candidate of due) {
    if (!remainingBudget) break;
    const result = await inTransaction(async tx => {
      // Re-read inside the transaction: another request may already have caught up.
      const recurring = await tx.recurringExpense.findFirst({ where: { id: candidate.id, userId, isActive: true } });
      if (!recurring) return null;
      const cutoff = recurring.endDate && endOfDay(recurring.endDate) < today ? endOfDay(recurring.endDate) : today;
      let current = new Date(recurring.nextExecution);
      let lastExecuted = recurring.lastExecuted;
      let processed = 0;
      const expenses = [];
      while (current <= cutoff && processed < remainingBudget) {
        const key = { recurringExpenseId: recurring.id, scheduledDate: current };
        const existing = await tx.expense.findUnique({ where: { recurringExpenseId_scheduledDate: key } });
        if (!existing) expenses.push(await tx.expense.create({ data: {
          ...key, userId, description: recurring.description, amount: recurring.amount,
          date: current, category: recurring.category, taxRelevant: recurring.taxRelevant,
          taxDeductiblePercentage: recurring.taxDeductiblePercentage,
        } }));
        lastExecuted = current;
        current = calculateNextExecution(recurring.interval, recurring.dayOfMonth, current);
        processed++;
      }
      const updated = await tx.recurringExpense.update({ where: { id: recurring.id, userId }, data: {
        lastExecuted, nextExecution: current,
        isActive: recurring.endDate ? current <= endOfDay(recurring.endDate) : true,
      } });
      return { expenses, updated, processed };
    });
    if (result) {
      remainingBudget -= result.processed;
      createdExpenses.push(...result.expenses);
      updatedRecurring.push(result.updated);
    }
  }
  for (const expense of createdExpenses) await auditCreate(userId, 'Expense', expense, expense.description);
  const hasMore = await prisma.recurringExpense.count({ where: {
    userId, isActive: true, nextExecution: { lte: today }, ...(id ? { id } : {}),
  } }) > 0;
  return { success: true, created: createdExpenses.length, expenses: createdExpenses, updated: updatedRecurring, hasMore };
}
