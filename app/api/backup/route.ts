import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditBackup } from '@/lib/audit-log';

const prisma = new PrismaClient();

// GET: Export all user data as JSON
export async function GET() {
  try {
    const userId = await requireUserId();

    // Fetch all user data including new models
    const [
      user,
      expenses,
      incomes,
      invoices,
      customers,
      settings,
      templates,
      recurringExpenses,
      reminders,
      cashBooks,
      cashTransactions,
      documentations,
      apiKeys
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, createdAt: true }
      }),
      prisma.expense.findMany({ where: { userId } }),
      prisma.income.findMany({ where: { userId } }),
      prisma.invoice.findMany({ where: { userId } }),
      prisma.customer.findMany({ where: { userId } }),
      prisma.settings.findUnique({ where: { userId } }),
      prisma.invoiceTemplate.findMany({ where: { userId } }),
      prisma.recurringExpense.findMany({ where: { userId } }),
      prisma.reminder.findMany({ where: { userId } }),
      prisma.cashBook.findMany({ where: { userId } }),
      prisma.cashTransaction.findMany({ where: { userId } }),
      prisma.documentation.findMany({ where: { userId } }),
      prisma.apiKey.findMany({ where: { userId }, select: { id: true, name: true, keyPrefix: true, scopes: true, isActive: true, expiresAt: true, createdAt: true } }),
    ]);

    // Audit log
    await auditBackup(userId, 'BACKUP', {
      expensesCount: expenses.length,
      incomesCount: incomes.length,
      invoicesCount: invoices.length,
      customersCount: customers.length,
      recurringExpensesCount: recurringExpenses.length,
      remindersCount: reminders.length,
      cashBooksCount: cashBooks.length,
      cashTransactionsCount: cashTransactions.length,
      documentationsCount: documentations.length,
    });

    const backup = {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      user: {
        email: user?.email,
        name: user?.name,
      },
      data: {
        expenses: expenses.map(e => ({
          ...e,
          userId: undefined, // Remove userId from export
        })),
        incomes: incomes.map(i => ({
          ...i,
          userId: undefined,
        })),
        invoices: invoices.map(inv => ({
          ...inv,
          userId: undefined,
        })),
        customers: customers.map(c => ({
          ...c,
          userId: undefined,
        })),
        settings: settings ? {
          ...settings,
          id: undefined,
          userId: undefined,
        } : null,
        templates: templates.map(t => ({
          ...t,
          userId: undefined,
        })),
        recurringExpenses: recurringExpenses.map(r => ({
          ...r,
          userId: undefined,
        })),
        reminders: reminders.map(r => ({
          ...r,
          userId: undefined,
        })),
        cashBooks: cashBooks.map(cb => ({
          ...cb,
          userId: undefined,
        })),
        cashTransactions: cashTransactions.map(ct => ({
          ...ct,
          userId: undefined,
        })),
        documentations: documentations.map(d => ({
          ...d,
          userId: undefined,
        })),
        apiKeys: apiKeys.map(ak => ({
          ...ak,
          // Note: keyHash is excluded for security - API keys need to be recreated after restore
        })),
      },
      stats: {
        expenses: expenses.length,
        incomes: incomes.length,
        invoices: invoices.length,
        customers: customers.length,
        templates: templates.length,
        recurringExpenses: recurringExpenses.length,
        reminders: reminders.length,
        cashBooks: cashBooks.length,
        cashTransactions: cashTransactions.length,
        documentations: documentations.length,
        apiKeys: apiKeys.length,
      }
    };

    // Return as downloadable JSON
    const jsonString = JSON.stringify(backup, null, 2);
    const filename = `bivaro-backup-${new Date().toISOString().split('T')[0]}.json`;

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Backup error:', error);
    return NextResponse.json({ error: 'Backup fehlgeschlagen' }, { status: 500 });
  }
}
