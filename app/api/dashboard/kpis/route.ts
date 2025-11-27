import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const userId = await requireUserId();
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const firstDayOfYear = new Date(currentYear, 0, 1);
    const lastDayOfYear = new Date(currentYear, 11, 31, 23, 59, 59);
    
    // Vorjahr
    const firstDayOfLastYear = new Date(currentYear - 1, 0, 1);
    const lastDayOfLastYear = new Date(currentYear - 1, 11, 31, 23, 59, 59);
    // Gleicher Zeitraum im Vorjahr (bis zum aktuellen Tag)
    const sameDayLastYear = new Date(currentYear - 1, currentMonth, today.getDate(), 23, 59, 59);

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

    // Vorjahresvergleich - Gesamtes Vorjahr
    const revenueLastYearTotal = await prisma.income.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        date: { gte: firstDayOfLastYear, lte: lastDayOfLastYear },
        taxRelevant: true,
      },
    });

    const expensesLastYearTotal = await prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        date: { gte: firstDayOfLastYear, lte: lastDayOfLastYear },
      },
    });

    // Vorjahresvergleich - Gleicher Zeitraum (Jan bis heute)
    const revenueLastYearToDate = await prisma.income.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        date: { gte: firstDayOfLastYear, lte: sameDayLastYear },
        taxRelevant: true,
      },
    });

    const expensesLastYearToDate = await prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        date: { gte: firstDayOfLastYear, lte: sameDayLastYear },
      },
    });

    // Aktuelles Jahr bis heute
    const revenueThisYearToDate = await prisma.income.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        date: { gte: firstDayOfYear, lte: today },
        taxRelevant: true,
      },
    });

    const expensesThisYearToDate = await prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        date: { gte: firstDayOfYear, lte: today },
      },
    });

    // Monatliche Daten für Chart (aktuelles Jahr)
    const monthlyDataThisYear = await getMonthlyData(userId, currentYear);
    const monthlyDataLastYear = await getMonthlyData(userId, currentYear - 1);

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
      // Jahresvergleich
      yearComparison: {
        currentYear,
        lastYear: currentYear - 1,
        // Gesamtes Jahr
        revenueThisYearTotal: revenueThisYear._sum.amount || 0,
        revenueLastYearTotal: revenueLastYearTotal._sum.amount || 0,
        expensesThisYearTotal: expensesThisYearToDate._sum.amount || 0,
        expensesLastYearTotal: expensesLastYearTotal._sum.amount || 0,
        // Bis zum heutigen Tag (fairer Vergleich)
        revenueThisYearToDate: revenueThisYearToDate._sum.amount || 0,
        revenueLastYearToDate: revenueLastYearToDate._sum.amount || 0,
        expensesThisYearToDate: expensesThisYearToDate._sum.amount || 0,
        expensesLastYearToDate: expensesLastYearToDate._sum.amount || 0,
        // Monatliche Daten für Chart
        monthlyDataThisYear,
        monthlyDataLastYear,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw error;
  }
}

async function getMonthlyData(userId: string, year: number) {
  const months = [];
  
  for (let month = 0; month < 12; month++) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
    
    const [revenue, expenses] = await Promise.all([
      prisma.income.aggregate({
        _sum: { amount: true },
        where: {
          userId,
          date: { gte: startOfMonth, lte: endOfMonth },
          taxRelevant: true,
        },
      }),
      prisma.expense.aggregate({
        _sum: { amount: true },
        where: {
          userId,
          date: { gte: startOfMonth, lte: endOfMonth },
        },
      }),
    ]);
    
    months.push({
      month: month + 1,
      monthName: new Date(year, month, 1).toLocaleString('de-DE', { month: 'short' }),
      revenue: revenue._sum.amount || 0,
      expenses: expenses._sum.amount || 0,
      profit: (revenue._sum.amount || 0) - (expenses._sum.amount || 0),
    });
  }
  
  return months;
}
