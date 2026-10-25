import { reminderBalance, recordReminder, ReminderWorkbenchError } from '@/lib/reminder-workbench';
import { hasServiceBillingDraftMarker } from '@/lib/service-billing';
import { loadInvoicePaymentStates } from '@/lib/payment-journal/allocation-ledger';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { auditDelete } from '@/lib/audit-log';
/**
 * API v1 - Reminders Endpoint
 * 
 * GET    /api/v1/reminders       - List overdue invoices with reminder status
 * POST   /api/v1/reminders       - Create a reminder for an invoice
 * DELETE /api/v1/reminders?id=   - Delete a reminder
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
} from '@/lib/api-auth';

export async function OPTIONS(request: NextRequest) {
  return handleCors(request);
}

// Reminder level labels
const REMINDER_LEVELS: { [key: number]: string } = {
  1: 'Payment Reminder',
  2: '1st Dunning Notice',
  3: '2nd Dunning Notice',
  4: 'Final Dunning Notice'
};

// GET /api/v1/reminders
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const includeAll = url.searchParams.get('includeAll') === 'true';
    const invoiceId = url.searchParams.get('invoiceId');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build query
    const whereClause: Prisma.InvoiceWhereInput = {
      userId,
      type: 'INVOICE',
      status: { notIn: ['PAID', 'CANCELLED'] },
    };

    // Filter by specific invoice
    if (invoiceId) {
      whereClause.id = parseInt(invoiceId);
    }

    // Only overdue invoices unless all requested
    if (!includeAll && !invoiceId) {
      whereClause.dueDate = { lt: today };
    }

    const enrichedInvoices = await prisma.$transaction(async tx => {
    const invoices = await tx.invoice.findMany({
      where: whereClause,
      include: {
        incomes: { include: { cashTransaction: true } },
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        reminders: {
          orderBy: { sentAt: 'desc' },
          select: {
            id: true,
            reminderLevel: true,
            sentAt: true,
            dueDate: true,
            fee: true,
            notes: true,
            balanceSnapshot: true,
          },
        },
      },
      take: 10_001,
      orderBy: { dueDate: 'asc' },
    });

    // Enrich invoices with additional info
    // No-file planning records are not reminder candidates, including
    // damaged markers. The underlying invoice remains visible for review.
    if (invoices.length > 10_000) throw new ReminderWorkbenchError('Zu viele Rechnungen. Bitte die Auswahl eingrenzen.', 413, 'SOURCE_LIMIT');
    const states = await loadInvoicePaymentStates(tx, userId, invoices.filter(invoice => !hasServiceBillingDraftMarker(invoice.parsedData)).map(invoice => invoice.id), { onReview: 'omit' });
    return Promise.all(invoices.filter(invoice => !hasServiceBillingDraftMarker(invoice.parsedData)).map(async invoice => {
      let summary = null;
      const state = states.get(invoice.id);
      try { if (state) summary = state.summary; } catch { /* Explicit review, no guessed balance. */ }
      let balance = null;
      try { if (state) balance = reminderBalance(state.invoice, state); } catch { /* Fail closed. */ }
      const canCreateReminder = balance !== null && balance.paidCents === '0';
      const latestReminder = invoice.reminders[0];
      const currentLevel = latestReminder ? latestReminder.reminderLevel : 0;
      const nextLevel = Math.min(currentLevel + 1, 4);

      // Calculate days overdue
      let daysOverdue = 0;
      if (invoice.dueDate) {
        const dueDate = new Date(invoice.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Calculate total fees
      const totalFees = invoice.reminders.reduce((sum, r) => sum + (r.fee || 0), 0);

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        fileName: invoice.fileName,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        customer: invoice.customer,
        reminders: invoice.reminders,
        paymentSummary: summary,
        balanceVersion: balance?.balanceVersion ?? null,
        openAmount: summary ? Number(summary.openCents) / 100 : null,
        canCreateReminder,
        canPrepareBalanceReminder: balance !== null,
        paymentReviewRequired: balance === null,
        currentReminderLevel: currentLevel,
        currentReminderLevelLabel: REMINDER_LEVELS[currentLevel] || 'None',
        nextReminderLevel: nextLevel,
        nextReminderLevelLabel: REMINDER_LEVELS[nextLevel] || 'Payment Reminder',
        daysOverdue: Math.max(0, daysOverdue),
        totalFees,
        isOverdue: daysOverdue > 0,
      };
    }));
    });

    // Calculate statistics
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
      },
    };

    const response = apiSuccess({
      invoices: enrichedInvoices,
      stats,
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// POST /api/v1/reminders
async function postHandler(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const { invoiceId, ...input } = body;
    if (!Number.isSafeInteger(Number(invoiceId)) || Number(invoiceId) <= 0) return apiError('Invoice ID is required', 400, 'VALIDATION_ERROR');
    // Replay must precede eligibility: settlement cannot invalidate a successful command.
    const existing = await prisma.invoice.findFirst({ where: { id: Number(invoiceId), userId }, select: { status: true } });
    let reminder;
    try { reminder = await recordReminder(userId, Number(invoiceId), input); }
    catch (error) {
      if (error instanceof ReminderWorkbenchError) {
        if (existing?.status === 'PAID' && error.code === 'INVOICE_NOT_OPEN') return apiError('Cannot create reminder for paid invoice', 400, 'INVOICE_PAID');
        return apiError(error.message, error.status, error.code);
      }
      throw error;
    }

    const response = apiSuccess({
      id: reminder.id,
      invoiceId: reminder.invoiceId,
      reminderLevel: reminder.reminderLevel,
      reminderLevelLabel: REMINDER_LEVELS[reminder.reminderLevel],
      fee: reminder.fee,
      notes: reminder.notes,
      sentAt: reminder.sentAt,
      dueDate: reminder.dueDate,
      invoice: reminder.invoice,
      balanceSnapshot: reminder.balanceSnapshot,
      replayed: reminder.replayed,
    });

    response.headers.set('Location', `/api/v1/reminders?invoiceId=${invoiceId}`);
    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/reminders?id=<id>
async function deleteHandler(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Reminder ID is required', 400, 'MISSING_ID');
    }

    // Check if reminder exists and belongs to user
    const existing = await prisma.reminder.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Reminder not found', 404, 'NOT_FOUND');
    }

    if (existing.balanceSnapshot != null) return apiError('Confirmed balance reminders are immutable.', 409, 'IMMUTABLE_REMINDER');
    await prisma.reminder.delete({
      where: { id: parseInt(id) },
    });
    await auditDelete(userId, 'Reminder', existing);

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    return response;
  }, { requiredScopes: ['delete'] });
}

export const POST = protectMutation(postHandler, { bearer: true, maxBodyBytes: MAX_API_JSON_BODY_BYTES });
export const DELETE = protectMutation(deleteHandler, { bearer: true });
