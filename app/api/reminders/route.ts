import { NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

// Mahnungsstufen-Labels
const REMINDER_LEVELS = {
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
  4: 'Letzte Mahnung'
};

// GET: Alle offenen/überfälligen Rechnungen mit Mahnstatus abrufen
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const includeAll = url.searchParams.get('includeAll') === 'true';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Offene Rechnungen laden (nicht bezahlt)
    const whereClause: Prisma.InvoiceWhereInput = {
      userId,
      status: { not: 'PAID' },
    };

    // Nur überfällige Rechnungen laden, wenn nicht alle angefordert
    if (!includeAll) {
      whereClause.dueDate = { lt: today };
    }

    const invoices = await prisma.invoice.findMany({
      where: whereClause,
      include: {
        customer: true,
        income: {
          include: {
            customer: true
          }
        },
        reminders: {
          orderBy: { sentAt: 'desc' }
        }
      },
      orderBy: { dueDate: 'asc' }
    });

    // Rechnungen mit zusätzlichen Infos anreichern
    const enrichedInvoices = invoices.map(invoice => {
      const latestReminder = invoice.reminders[0];
      const currentLevel = latestReminder ? latestReminder.reminderLevel : 0;
      const nextLevel = Math.min(currentLevel + 1, 4);

      // Tage überfällig berechnen
      let daysOverdue = 0;
      if (invoice.dueDate) {
        const dueDate = new Date(invoice.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Gesamte Mahngebühren berechnen
      const totalFees = invoice.reminders.reduce((sum, r) => sum + (r.fee || 0), 0);

      // Kunde aus direkter Relation oder über Income holen
      const customer = invoice.customer || invoice.income?.customer || null;

      return {
        ...invoice,
        customer, // Kunde überschreiben mit dem gefundenen
        currentReminderLevel: currentLevel,
        nextReminderLevel: nextLevel,
        nextReminderLevelLabel: REMINDER_LEVELS[nextLevel as keyof typeof REMINDER_LEVELS] || 'Zahlungserinnerung',
        daysOverdue: Math.max(0, daysOverdue),
        totalFees,
        isOverdue: daysOverdue > 0
      };
    });

    // Statistiken berechnen
    const stats = {
      totalOverdue: enrichedInvoices.filter(i => i.isOverdue).length,
      totalAmount: enrichedInvoices.filter(i => i.isOverdue).reduce((sum, i) => sum + (i.totalAmount || 0), 0),
      totalFees: enrichedInvoices.reduce((sum, i) => sum + i.totalFees, 0),
      byLevel: {
        0: enrichedInvoices.filter(i => i.currentReminderLevel === 0 && i.isOverdue).length,
        1: enrichedInvoices.filter(i => i.currentReminderLevel === 1).length,
        2: enrichedInvoices.filter(i => i.currentReminderLevel === 2).length,
        3: enrichedInvoices.filter(i => i.currentReminderLevel === 3).length,
        4: enrichedInvoices.filter(i => i.currentReminderLevel === 4).length,
      }
    };

    return NextResponse.json({ invoices: enrichedInvoices, stats });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching reminders:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Mahnungen' }, { status: 500 });
  }
}

// POST: Neue Mahnung erstellen
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const { invoiceId, reminderLevel, fee, notes, dueDays } = await request.json();

    if (!invoiceId) {
      return NextResponse.json({ error: 'Rechnungs-ID ist erforderlich' }, { status: 400 });
    }

    // Prüfen, ob Rechnung existiert und dem User gehört
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      include: { reminders: { orderBy: { sentAt: 'desc' }, take: 1 } }
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
    }

    // Nächste Mahnstufe bestimmen
    const lastReminder = invoice.reminders[0];
    const nextLevel = reminderLevel || (lastReminder ? Math.min(lastReminder.reminderLevel + 1, 4) : 1);

    // Fälligkeitsdatum der Mahnung (Standard: 14 Tage)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (dueDays || 14));

    const reminder = await prisma.reminder.create({
      data: {
        invoiceId,
        reminderLevel: nextLevel,
        fee: fee || 0,
        notes: notes || null,
        dueDate,
        userId
      },
      include: {
        invoice: {
          include: { customer: true }
        }
      }
    });

    return NextResponse.json(reminder);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error creating reminder:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen der Mahnung' }, { status: 500 });
  }
}

// DELETE: Mahnung löschen
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }

    await prisma.reminder.delete({
      where: { id: Number(id), userId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Mahnung nicht gefunden' }, { status: 404 });
  }
}
