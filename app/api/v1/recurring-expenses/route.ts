import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
/**
 * API v1 - Recurring Expenses Endpoint
 * 
 * GET    /api/v1/recurring-expenses       - List all recurring expenses
 * POST   /api/v1/recurring-expenses       - Create recurring expense
 * PUT    /api/v1/recurring-expenses?id=   - Update recurring expense
 * DELETE /api/v1/recurring-expenses?id=   - Delete recurring expense
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calculateNextExecution, firstExecution, validateRecurringValues } from '@/lib/recurring-schedule';
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

// Helper: Calculate next execution date
// GET /api/v1/recurring-expenses
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const skip = (page - 1) * pageSize;

    // Filters
    const isActive = url.searchParams.get('isActive');
    const interval = url.searchParams.get('interval');
    const category = url.searchParams.get('category');

    const where: Prisma.RecurringExpenseWhereInput = { userId };

    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;
    if (interval) where.interval = interval.toUpperCase();
    if (category) where.category = category;

    const [expenses, total] = await Promise.all([
      prisma.recurringExpense.findMany({
        where,
        orderBy: { nextExecution: 'asc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          description: true,
          amount: true,
          category: true,
          taxRelevant: true,
          taxDeductiblePercentage: true,
          interval: true,
          dayOfMonth: true,
          startDate: true,
          endDate: true,
          lastExecuted: true,
          nextExecution: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.recurringExpense.count({ where }),
    ]);

    const response = apiSuccess(expenses, {
      page,
      pageSize,
      total,
      hasMore: skip + expenses.length < total,
    });

    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// POST /api/v1/recurring-expenses
export async function POST(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const {
      description,
      amount,
      category,
      taxRelevant,
      taxDeductiblePercentage,
      interval,
      dayOfMonth,
      startDate,
      endDate,
    } = body;

    // Validation
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return apiError('Description is required', 400, 'VALIDATION_ERROR');
    }

    if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
      return apiError('Valid amount is required', 400, 'VALIDATION_ERROR');
    }

    if (parseFloat(amount) < 0) {
      return apiError('Amount cannot be negative', 400, 'VALIDATION_ERROR');
    }

    const validIntervals = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
    if (!interval || !validIntervals.includes(interval.toUpperCase())) {
      return apiError(`Interval must be one of: ${validIntervals.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const day = dayOfMonth ? parseInt(dayOfMonth) : 1;
    if (day < 1 || day > 31) {
      return apiError('Day of month must be between 1 and 31', 400, 'VALIDATION_ERROR');
    }

    const validationError = validateRecurringValues({ amount, interval, dayOfMonth: dayOfMonth ?? 1, taxDeductiblePercentage, startDate, endDate, taxRelevant });
    if (validationError) return apiError(validationError, 400, 'VALIDATION_ERROR');

    const start = startDate ? new Date(startDate) : new Date();
    const nextExecution = firstExecution(interval.toUpperCase(), day, start);

    const expense = await prisma.recurringExpense.create({
      data: {
        description: description.trim(),
        amount: parseFloat(amount),
        category: category?.trim() || null,
        taxRelevant: taxRelevant !== undefined ? Boolean(taxRelevant) : true,
        taxDeductiblePercentage: taxDeductiblePercentage == null ? 100 : Number(taxDeductiblePercentage),
        interval: interval.toUpperCase(),
        dayOfMonth: day,
        startDate: start,
        endDate: endDate ? new Date(endDate) : null,
        nextExecution,
        userId,
      },
    });
    await auditCreate(userId, 'RecurringExpense', expense);

    const response = apiSuccess(expense);
    response.headers.set('Location', `/api/v1/recurring-expenses?id=${expense.id}`);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }, { requiredScopes: ['write'] });
}

// PUT /api/v1/recurring-expenses?id=<id>
export async function PUT(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      return apiError('Recurring expense ID is required', 400, 'MISSING_ID');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const {
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

    // Check if expense exists and belongs to user
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Recurring expense not found', 404, 'NOT_FOUND');
    }

    // Validation
    if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
      return apiError('Description cannot be empty', 400, 'VALIDATION_ERROR');
    }

    if (amount !== undefined && (isNaN(parseFloat(amount)) || parseFloat(amount) < 0)) {
      return apiError('Invalid amount', 400, 'VALIDATION_ERROR');
    }

    const validIntervals = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
    if (interval !== undefined && (typeof interval !== 'string' || !validIntervals.includes(interval.toUpperCase()))) {
      return apiError(`Interval must be one of: ${validIntervals.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    if (dayOfMonth !== undefined) {
      const day = parseInt(dayOfMonth);
      if (day < 1 || day > 31) {
        return apiError('Day of month must be between 1 and 31', 400, 'VALIDATION_ERROR');
      }
    }

    const validationError = validateRecurringValues({ ...existing, ...body });
    if (validationError) return apiError(validationError, 400, 'VALIDATION_ERROR');

    // Recalculate next execution if interval or day changed
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

    const expense = await prisma.recurringExpense.update({
      where: { id: parseInt(id) },
      data: {
        ...(description !== undefined && { description: description.trim() }),
        ...(amount !== undefined && { amount: parseFloat(amount) }),
        ...(category !== undefined && { category: category?.trim() || null }),
        ...(taxRelevant !== undefined && { taxRelevant: Boolean(taxRelevant) }),
        ...(taxDeductiblePercentage !== undefined && { taxDeductiblePercentage: taxDeductiblePercentage == null ? 100 : Number(taxDeductiblePercentage) }),
        ...(interval !== undefined && { interval: interval.toUpperCase() }),
        ...(dayOfMonth !== undefined && { dayOfMonth: parseInt(dayOfMonth) }),
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        nextExecution,
      },
    });
    await auditUpdate(userId, 'RecurringExpense', existing.id, existing, expense);

    const response = apiSuccess(expense);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/recurring-expenses?id=<id>
export async function DELETE(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      return apiError('Recurring expense ID is required', 400, 'MISSING_ID');
    }

    // Check if expense exists and belongs to user
    const existing = await prisma.recurringExpense.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Recurring expense not found', 404, 'NOT_FOUND');
    }

    await prisma.recurringExpense.delete({
      where: { id: parseInt(id) },
    });
    await auditDelete(userId, 'RecurringExpense', existing);

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['delete'] });
}
