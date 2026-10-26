import { reminderBalance, recordReminder, ReminderWorkbenchError } from '@/lib/reminder-workbench';
import { hasServiceBillingDraftMarker } from '@/lib/service-billing';
import { loadInvoicePaymentStates } from '@/lib/payment-journal/allocation-ledger';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

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

    // Nur offene Rechnungen, keine Angebote, Gutschriften oder stornierten Belege.
    const whereClause: Prisma.InvoiceWhereInput = {
      userId,
      type: 'INVOICE',
      status: { notIn: ['PAID', 'CANCELLED'] },
    };

    // Nur überfällige Rechnungen laden, wenn nicht alle angefordert
    if (!includeAll) {
      whereClause.dueDate = { lt: today };
    }

    const enrichedInvoices = await prisma.$transaction(async tx => {
    const invoices = await tx.invoice.findMany({
      where: whereClause,
      include: {
        customer: true,
        incomes: {
          include: {
            cashTransaction: true,
            customer: true
          }
        },
        reminders: {
          orderBy: { sentAt: 'desc' }
        }
      },
      take: 10_001,
      orderBy: { dueDate: 'asc' }
    });

    // Rechnungen mit zusätzlichen Infos anreichern
    // No-file planning records are not reminder candidates, including
    // damaged markers. The underlying invoice remains visible for review.
    if (invoices.length > 10_000) throw new ReminderWorkbenchError('Zu viele Rechnungen. Bitte die Auswahl eingrenzen.', 413, 'SOURCE_LIMIT');
    const states = await loadInvoicePaymentStates(tx, userId, invoices.filter(invoice => !hasServiceBillingDraftMarker(invoice.parsedData)).map(invoice => invoice.id), { onReview: 'omit' });
    return Promise.all(invoices.filter(invoice => !hasServiceBillingDraftMarker(invoice.parsedData)).map(async invoice => {
      let summary = null;
      const state = states.get(invoice.id);
      try { if (state) summary = state.summary; } catch { /* Explicit review, no guessed balance. */ }
      let balance = null;
      try { if (state) balance = reminderBalance(state.invoice, state); } catch { /* Fail closed for unexplained balances. */ }
      const canCreateReminder = balance !== null && balance.paidCents === '0';
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
      const customer = invoice.customer || (invoice.incomes.length === 1 ? invoice.incomes[0].customer : null);

      return {
        ...invoice,
        customer, // Kunde überschreiben mit dem gefundenen
        paymentSummary: summary,
        balanceVersion: balance?.balanceVersion ?? null,
        openAmount: summary ? Number(summary.openCents) / 100 : null,
        canCreateReminder,
        canPrepareBalanceReminder: balance !== null,
        paymentReviewRequired: balance === null,
        currentReminderLevel: currentLevel,
        nextReminderLevel: nextLevel,
        nextReminderLevelLabel: REMINDER_LEVELS[nextLevel as keyof typeof REMINDER_LEVELS] || 'Zahlungserinnerung',
        daysOverdue: Math.max(0, daysOverdue),
        totalFees,
        isOverdue: daysOverdue > 0
      };
    }));
    });

    // Statistiken berechnen
    const stats = {
      totalOverdue: enrichedInvoices.filter(i => i.isOverdue).length,
      totalAmount: enrichedInvoices.filter(i => i.isOverdue).reduce((sum, i) => sum + (i.openAmount ?? 0), 0),
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
    if (error instanceof ReminderWorkbenchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error('Error fetching reminders:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Mahnungen' }, { status: 500 });
  }
}

// POST: Mahnung intern erfassen (kein E-Mail-Versand)
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const { invoiceId, ...input } = await request.json();
    const reminder = await recordReminder(userId, Number(invoiceId), input);
    return NextResponse.json(reminder);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof ReminderWorkbenchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error('Error creating reminder:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen der Mahnung' }, { status: 500 });
  }
}

// DELETE: Mahnung löschen
async function deleteHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }

    const existing = await prisma.reminder.findFirst({ where: { id: Number(id), userId } });
    if (existing?.balanceSnapshot != null) return NextResponse.json({ error: 'Bestätigte Restbeträge bleiben als interne Historie erhalten.', code: 'IMMUTABLE_REMINDER' }, { status: 409 });
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

export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
export const DELETE = protectMutation(deleteHandler);
