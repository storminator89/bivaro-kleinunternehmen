import { auditCreate, auditDelete } from '@/lib/audit-log';
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
  corsHeaders,
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
      status: { not: 'PAID' },
    };

    // Filter by specific invoice
    if (invoiceId) {
      whereClause.id = parseInt(invoiceId);
    }

    // Only overdue invoices unless all requested
    if (!includeAll && !invoiceId) {
      whereClause.dueDate = { lt: today };
    }

    const invoices = await prisma.invoice.findMany({
      where: whereClause,
      include: {
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
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Enrich invoices with additional info
    const enrichedInvoices = invoices.map(invoice => {
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
        currentReminderLevel: currentLevel,
        currentReminderLevelLabel: REMINDER_LEVELS[currentLevel] || 'None',
        nextReminderLevel: nextLevel,
        nextReminderLevelLabel: REMINDER_LEVELS[nextLevel] || 'Payment Reminder',
        daysOverdue: Math.max(0, daysOverdue),
        totalFees,
        isOverdue: daysOverdue > 0,
      };
    });

    // Calculate statistics
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
      },
    };

    const response = apiSuccess({
      invoices: enrichedInvoices,
      stats,
    });

    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// POST /api/v1/reminders
export async function POST(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const { invoiceId, reminderLevel, fee, notes, dueDays } = body;

    // Validation
    if (!invoiceId) {
      return apiError('Invoice ID is required', 400, 'VALIDATION_ERROR');
    }

    // Check if invoice exists and belongs to user
    const invoice = await prisma.invoice.findFirst({
      where: { id: parseInt(invoiceId), userId },
      include: {
        reminders: {
          orderBy: { sentAt: 'desc' },
          take: 1
        }
      },
    });

    if (!invoice) {
      return apiError('Invoice not found', 404, 'NOT_FOUND');
    }

    if (invoice.status === 'PAID') {
      return apiError('Cannot create reminder for paid invoice', 400, 'INVOICE_PAID');
    }

    // Determine next reminder level
    const lastReminder = invoice.reminders[0];
    const nextLevel = reminderLevel || (lastReminder ? Math.min(lastReminder.reminderLevel + 1, 4) : 1);

    if (nextLevel < 1 || nextLevel > 4) {
      return apiError('Reminder level must be between 1 and 4', 400, 'VALIDATION_ERROR');
    }

    // Calculate due date (default: 14 days)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (dueDays || 14));

    const reminder = await prisma.reminder.create({
      data: {
        invoiceId: parseInt(invoiceId),
        reminderLevel: nextLevel,
        fee: fee ? parseFloat(fee) : 0,
        notes: notes?.trim() || null,
        dueDate,
        userId,
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            customer: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    await auditCreate(userId, 'Reminder', reminder);

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
    });

    response.headers.set('Location', `/api/v1/reminders?invoiceId=${invoiceId}`);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/reminders?id=<id>
export async function DELETE(request: NextRequest) {
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

    await prisma.reminder.delete({
      where: { id: parseInt(id) },
    });
    await auditDelete(userId, 'Reminder', existing);

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['delete'] });
}
