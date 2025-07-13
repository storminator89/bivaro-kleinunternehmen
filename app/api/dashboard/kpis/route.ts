import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const revenueThisMonth = await prisma.income.aggregate({
    _sum: {
      amount: true,
    },
    where: {
      date: {
        gte: firstDayOfMonth,
      },
    },
  });

  const expensesThisMonth = await prisma.expense.aggregate({
    _sum: {
      amount: true,
    },
    where: {
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
      status: {
        not: 'PAID',
      },
    },
  });

  const totalRevenue = await prisma.income.aggregate({
    _sum: {
      amount: true,
    },
  });

  const totalExpenses = await prisma.expense.aggregate({
    _sum: {
      amount: true,
    },
  });

  const recentIncomes = await prisma.income.findMany({
    take: 5,
    orderBy: {
      date: 'desc',
    },
    include: {
      customer: true,
    }
  });

  const recentExpenses = await prisma.expense.findMany({
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
    expensesThisMonth: expensesThisMonth._sum.amount || 0,
    openInvoices: openInvoices._sum.totalAmount || 0,
    totalRevenue: totalRevenue._sum.amount || 0,
    totalExpenses: totalExpenses._sum.amount || 0,
    recentActivities,
  });
}
