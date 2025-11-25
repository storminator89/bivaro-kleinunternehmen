import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const userId = await requireUserId();
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstDayOfYear = new Date(today.getFullYear(), 0, 1);

    const revenueThisMonth = await prisma.income.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        userId,
        date: {
          gte: firstDayOfMonth,
        },
      },
    });

    const revenueThisYear = await prisma.income.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        userId,
        date: {
          gte: firstDayOfYear,
        },
        taxRelevant: true,
      },
    });

    const expensesThisMonth = await prisma.expense.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        userId,
        date: {
          gte: firstDayOfMonth,
        },
      },
    });

    const openInvoices = await prisma.invoice.aggregate({
      _sum: {
        totalAmount: true,
      },
      where: {
        userId,
        status: {
          not: 'PAID',
        },
      },
    });

    const totalRevenue = await prisma.income.aggregate({
      _sum: {
        amount: true,
      },
      where: { userId },
    });

    const totalExpenses = await prisma.expense.aggregate({
      _sum: {
        amount: true,
      },
      where: { userId },
    });

    const recentIncomes = await prisma.income.findMany({
      where: { userId },
      take: 5,
      orderBy: {
        date: 'desc',
      },
      include: {
        customer: true,
      }
    });

    const recentExpenses = await prisma.expense.findMany({
      where: { userId },
      take: 5,
      orderBy: {
        date: 'desc',
      },
    });

    const activities = [
      ...recentIncomes.map(item => ({ ...item, type: 'income' })),
      ...recentExpenses.map(item => ({ ...item, type: 'expense', amount: -item.amount })),
    ];

    const recentActivities = activities
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

    return NextResponse.json({
      revenueThisMonth: revenueThisMonth._sum.amount || 0,
      revenueThisYear: revenueThisYear._sum.amount || 0,
      expensesThisMonth: expensesThisMonth._sum.amount || 0,
      openInvoices: openInvoices._sum.totalAmount || 0,
      totalRevenue: totalRevenue._sum.amount || 0,
      totalExpenses: totalExpenses._sum.amount || 0,
      recentActivities,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw error;
  }
}
