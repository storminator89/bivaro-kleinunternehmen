import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

// Hilfsfunktion: Berechnet das nächste Ausführungsdatum
function calculateNextExecution(interval: string, dayOfMonth: number, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate);
  next.setHours(0, 0, 0, 0);

  switch (interval) {
    case 'MONTHLY':
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
    case 'QUARTERLY':
      next.setMonth(next.getMonth() + 3);
      next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
    case 'YEARLY':
      next.setFullYear(next.getFullYear() + 1);
      next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
    default:
      next.setMonth(next.getMonth() + 1);
  }

  return next;
}

// POST: Fällige wiederkehrende Ausgaben ausführen
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const { id } = body; // Optional: Nur eine bestimmte wiederkehrende Ausgabe ausführen

    const now = new Date();
    now.setHours(23, 59, 59, 999); // Ende des heutigen Tages

    // Fällige wiederkehrende Ausgaben finden
    const whereClause: Prisma.RecurringExpenseWhereInput = {
      userId,
      isActive: true,
      nextExecution: { lte: now },
    };

    // Wenn eine ID übergeben wurde, nur diese ausführen
    if (id) {
      whereClause.id = Number(id);
    }

    const dueRecurring = await prisma.recurringExpense.findMany({
      where: whereClause,
    });

    const createdExpenses = [];
    const updatedRecurring = [];

    for (const recurring of dueRecurring) {
      // Prüfen ob Enddatum überschritten ist
      if (recurring.endDate && recurring.endDate < now) {
        // Deaktivieren wenn Enddatum überschritten
        await prisma.recurringExpense.update({
          where: { id: recurring.id },
          data: { isActive: false },
        });
        continue;
      }

      // ALLE verpassten Ausführungen nachholen (nicht nur eine)
      let currentExecution = new Date(recurring.nextExecution);
      let lastExecutedDate = recurring.lastExecuted ? new Date(recurring.lastExecuted) : null;

      while (currentExecution <= now) {
        // Prüfen ob Enddatum erreicht
        if (recurring.endDate && currentExecution > recurring.endDate) {
          break;
        }

        // Neue Ausgabe erstellen für diesen Zeitpunkt
        const expense = await prisma.expense.create({
          data: {
            description: recurring.description,
            amount: recurring.amount,
            category: recurring.category,
            taxRelevant: recurring.taxRelevant,
            taxDeductiblePercentage: recurring.taxDeductiblePercentage,
            date: currentExecution,
            userId,
          },
        });

        createdExpenses.push(expense);
        lastExecutedDate = new Date(currentExecution);

        // Nächste Ausführung berechnen
        currentExecution = calculateNextExecution(
          recurring.interval,
          recurring.dayOfMonth,
          currentExecution
        );
      }

      // Wiederkehrende Ausgabe aktualisieren mit der nächsten zukünftigen Ausführung
      const updated = await prisma.recurringExpense.update({
        where: { id: recurring.id },
        data: {
          lastExecuted: lastExecutedDate,
          nextExecution: currentExecution,
          // Deaktivieren wenn Enddatum erreicht
          isActive: recurring.endDate ? currentExecution <= recurring.endDate : true,
        },
      });

      updatedRecurring.push(updated);
    }

    return NextResponse.json({
      success: true,
      created: createdExpenses.length,
      expenses: createdExpenses,
      updated: updatedRecurring,
    });
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

      while (currentExecution <= now) {
        if (recurring.endDate && currentExecution > recurring.endDate) {
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
