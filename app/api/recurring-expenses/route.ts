import { NextResponse } from 'next/server';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { calculateNextExecution, firstExecution, validateRecurringValues } from '@/lib/recurring-schedule';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

// Hilfsfunktion: Berechnet das nächste Ausführungsdatum
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
    
    if (typeof description !== 'string' || !description.trim() || !amount || !interval) {
      return NextResponse.json({ error: 'Beschreibung, Betrag und Intervall sind erforderlich' }, { status: 400 });
    }
    
    const validationError = validateRecurringValues({ amount, interval, dayOfMonth: dayOfMonth ?? 1, taxDeductiblePercentage, startDate, endDate, taxRelevant });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const start = startDate ? new Date(startDate) : new Date();
    const nextExecution = firstExecution(interval.toUpperCase(), Number(dayOfMonth), start);
    
    // NICHT zum nächsten Intervall springen - verpasste Ausführungen werden nachgeholt
    
    const recurringExpense = await prisma.recurringExpense.create({
      data: {
        description,
        amount: parseFloat(amount.toString()),
        category,
        taxRelevant,
        taxDeductiblePercentage: taxDeductiblePercentage == null ? 100 : Number(taxDeductiblePercentage),
        interval: interval.toUpperCase(),
        dayOfMonth: parseInt(dayOfMonth.toString()),
        startDate: start,
        endDate: endDate ? new Date(endDate) : null,
        nextExecution,
        userId,
      },
    });
    
    await auditCreate(userId, 'RecurringExpense', recurringExpense);
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
    
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }
    
    // Prüfen ob die wiederkehrende Ausgabe dem Benutzer gehört
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: Number(id), userId },
    });
    
    if (!existing) {
      return NextResponse.json({ error: 'Wiederkehrende Ausgabe nicht gefunden' }, { status: 404 });
    }
    
    if (description !== undefined && (typeof description !== 'string' || !description.trim())) {
      return NextResponse.json({ error: 'Ungültige Beschreibung' }, { status: 400 });
    }
    const validationError = validateRecurringValues({ ...existing, ...body });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    // Nächste Ausführung neu berechnen wenn Intervall oder Tag geändert wurde
    let nextExecution = existing.nextExecution;
    if ((interval !== undefined && interval.toUpperCase() !== existing.interval) ||
        (dayOfMonth !== undefined && Number(dayOfMonth) !== existing.dayOfMonth) || startDate !== undefined) {
      const nextInterval = interval?.toUpperCase() ?? existing.interval;
      const nextDay = dayOfMonth === undefined ? existing.dayOfMonth : Number(dayOfMonth);
      nextExecution = existing.lastExecuted
        ? calculateNextExecution(nextInterval, nextDay, existing.lastExecuted)
        : firstExecution(nextInterval, nextDay, startDate ? new Date(startDate) : existing.startDate);
      const earliest = firstExecution(nextInterval, nextDay, startDate ? new Date(startDate) : existing.startDate);
      if (nextExecution < earliest) nextExecution = earliest;
    }

    const updated = await prisma.recurringExpense.update({
      where: { id: Number(id) },
      data: {
        ...(description && { description }),
        ...(amount !== undefined && { amount: parseFloat(amount.toString()) }),
        ...(category !== undefined && { category }),
        ...(taxRelevant !== undefined && { taxRelevant }),
        ...(taxDeductiblePercentage !== undefined && { taxDeductiblePercentage: taxDeductiblePercentage == null ? 100 : Number(taxDeductiblePercentage) }),
        ...(interval && { interval: interval.toUpperCase() }),
        ...(dayOfMonth !== undefined && { dayOfMonth: parseInt(dayOfMonth.toString()) }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(isActive !== undefined && { isActive }),
        nextExecution,
      },
    });
    
    await auditUpdate(userId, 'RecurringExpense', existing.id, existing, updated);
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
    
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
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
    
    await auditDelete(userId, 'RecurringExpense', existing);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error deleting recurring expense:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen der wiederkehrenden Ausgabe' }, { status: 500 });
  }
}
