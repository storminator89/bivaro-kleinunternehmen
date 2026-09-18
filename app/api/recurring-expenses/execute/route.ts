import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executeRecurringExpenses } from '@/lib/recurring-expenses-service';
import { calculateNextExecution, endOfDay } from '@/lib/recurring-schedule';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

// POST: Fällige wiederkehrende Ausgaben ausführen
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const id = body.id === undefined ? undefined : Number(body.id);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) {
      return NextResponse.json({ error: 'Ungültige ID' }, { status: 400 });
    }
    return NextResponse.json(await executeRecurringExpenses(userId, id));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error executing recurring expenses:', error);
    return NextResponse.json({ error: 'Fehler beim Ausführen der wiederkehrenden Ausgaben' }, { status: 500 });
  }
}

// GET: Fällige wiederkehrende Ausgaben abrufen (Preview)
export async function GET() {
  try {
    const userId = await requireUserId();

    const now = new Date();
    now.setHours(23, 59, 59, 999);

    const dueRecurring = await prisma.recurringExpense.findMany({
      where: {
        userId,
        isActive: true,
        nextExecution: { lte: now },
      },
      orderBy: { nextExecution: 'asc' },
    });

    // Berechne wie viele Ausgaben tatsächlich erstellt werden würden
    let totalDueExpenses = 0;
    const itemsWithCount = dueRecurring.map(recurring => {
      let count = 0;
      let currentExecution = new Date(recurring.nextExecution);

      while (currentExecution <= now && count < 1200) {
        if (recurring.endDate && currentExecution > endOfDay(recurring.endDate)) {
          break;
        }
        count++;
        currentExecution = calculateNextExecution(
          recurring.interval,
          recurring.dayOfMonth,
          currentExecution
        );
      }

      totalDueExpenses += count;
      return { ...recurring, dueCount: count };
    });

    return NextResponse.json({
      count: totalDueExpenses,
      recurringCount: dueRecurring.length,
      items: itemsWithCount,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching due recurring expenses:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der fälligen wiederkehrenden Ausgaben' }, { status: 500 });
  }
}
