import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

// GET: Export all user data as JSON
export async function GET() {
  try {
    const userId = await requireUserId();

    // Fetch all user data
    const [user, expenses, incomes, invoices, customers, settings, templates] = await Promise.all([
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
    ]);

    const backup = {
      version: "1.0",
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
      },
      stats: {
        expenses: expenses.length,
        incomes: incomes.length,
        invoices: invoices.length,
        customers: customers.length,
        templates: templates.length,
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
