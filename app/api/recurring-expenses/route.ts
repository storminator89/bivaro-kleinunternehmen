import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

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

// GET: Alle wiederkehrenden Ausgaben abrufen
export async function GET() {
  try {
    const userId = await requireUserId();
    
    const recurringExpenses = await prisma.recurringExpense.findMany({
      where: { userId },
      orderBy: { nextExecution: 'asc' },
    });
    
    return NextResponse.json(recurringExpenses);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching recurring expenses:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der wiederkehrenden Ausgaben' }, { status: 500 });
  }
}

// POST: Neue wiederkehrende Ausgabe erstellen
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    
    const {
      description,
      amount,
      category,
      taxRelevant = true,
      taxDeductiblePercentage = 100,
      interval,
      dayOfMonth = 1,
      startDate,
      endDate,
    } = body;
    
    if (!description || !amount || !interval) {
      return NextResponse.json({ error: 'Beschreibung, Betrag und Intervall sind erforderlich' }, { status: 400 });
    }
    
    const start = startDate ? new Date(startDate) : new Date();
    const nextExecution = new Date(start);
    nextExecution.setDate(Math.min(dayOfMonth, new Date(nextExecution.getFullYear(), nextExecution.getMonth() + 1, 0).getDate()));
    
    // NICHT zum nächsten Intervall springen - verpasste Ausführungen werden nachgeholt
    
    const recurringExpense = await prisma.recurringExpense.create({
      data: {
        description,
        amount: parseFloat(amount.toString()),
        category,
        taxRelevant,
        taxDeductiblePercentage: taxDeductiblePercentage ? parseFloat(taxDeductiblePercentage.toString()) : 100,
        interval,
        dayOfMonth: parseInt(dayOfMonth.toString()),
        startDate: start,
        endDate: endDate ? new Date(endDate) : null,
        nextExecution,
        userId,
      },
    });
    
    return NextResponse.json(recurringExpense);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error creating recurring expense:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen der wiederkehrenden Ausgabe' }, { status: 500 });
  }
}

// PUT: Wiederkehrende Ausgabe aktualisieren
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    
    const {
      id,
      description,
      amount,
      category,
      taxRelevant,
      taxDeductiblePercentage,
      interval,
      dayOfMonth,
      startDate,
      endDate,
      isActive,
    } = body;
    
    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }
    
    // Prüfen ob die wiederkehrende Ausgabe dem Benutzer gehört
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: Number(id), userId },
    });
    
    if (!existing) {
      return NextResponse.json({ error: 'Wiederkehrende Ausgabe nicht gefunden' }, { status: 404 });
    }
    
    // Nächste Ausführung neu berechnen wenn Intervall oder Tag geändert wurde
    let nextExecution = existing.nextExecution;
    if (interval !== existing.interval || dayOfMonth !== existing.dayOfMonth) {
      nextExecution = calculateNextExecution(
        interval || existing.interval,
        dayOfMonth || existing.dayOfMonth,
        existing.lastExecuted || new Date()
      );
    }
    
    const updated = await prisma.recurringExpense.update({
      where: { id: Number(id) },
      data: {
        ...(description && { description }),
        ...(amount !== undefined && { amount: parseFloat(amount.toString()) }),
        ...(category !== undefined && { category }),
        ...(taxRelevant !== undefined && { taxRelevant }),
        ...(taxDeductiblePercentage !== undefined && { taxDeductiblePercentage: parseFloat(taxDeductiblePercentage.toString()) }),
        ...(interval && { interval }),
        ...(dayOfMonth !== undefined && { dayOfMonth: parseInt(dayOfMonth.toString()) }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(isActive !== undefined && { isActive }),
        nextExecution,
      },
    });
    
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error updating recurring expense:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren der wiederkehrenden Ausgabe' }, { status: 500 });
  }
}

// DELETE: Wiederkehrende Ausgabe löschen
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }
    
    // Prüfen ob die wiederkehrende Ausgabe dem Benutzer gehört
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: Number(id), userId },
    });
    
    if (!existing) {
      return NextResponse.json({ error: 'Wiederkehrende Ausgabe nicht gefunden' }, { status: 404 });
    }
    
    await prisma.recurringExpense.delete({
      where: { id: Number(id) },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error deleting recurring expense:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen der wiederkehrenden Ausgabe' }, { status: 500 });
  }
}
