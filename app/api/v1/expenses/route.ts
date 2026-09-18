import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
/**
 * API v1 - Expenses Endpoint
 * 
 * GET    /api/v1/expenses       - List all expenses
 * POST   /api/v1/expenses       - Create expense
 * PUT    /api/v1/expenses?id=   - Update expense
 * DELETE /api/v1/expenses?id=   - Delete expense
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';

class ExpenseMutationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function parsePositiveId(value: unknown, label: string): number {
  const text = String(value ?? '');
  const id = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(id)) {
    throw new ExpenseMutationError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return id;
}

function parseDate(value: unknown, fallbackNow = false): Date {
  if (value === undefined || value === null || value === '') {
    if (fallbackNow) return new Date();
    throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid date');
  }
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid date');
  return date;
}

function parseAmount(value: unknown, required = false): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Valid amount is required');
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  return amount;
}

function parseTaxRelevant(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'taxRelevant must be boolean');
  return value;
}

function parsePercentage(value: unknown, defaultValue: number | null | undefined): number | null | undefined {
  if (value === undefined) return defaultValue;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid deductible percentage');
  }
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid deductible percentage');
  }
  return percentage;
}

function parseDepreciationYears(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const years = Number(value);
  if (!Number.isSafeInteger(years) || years <= 0) {
    throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Invalid depreciation period');
  }
  return years;
}

function parseCategory(value: unknown, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Category is invalid');
    return null;
  }
  if (typeof value !== 'string') throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Category is invalid');
  const category = value.trim();
  if (required && !category) throw new ExpenseMutationError(400, 'VALIDATION_ERROR', 'Category is invalid');
  return category || null;
}

function mutationErrorResponse(error: unknown) {
  return error instanceof ExpenseMutationError ? apiError(error.message, error.status, error.code) : null;
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request);
}

// GET /api/v1/expenses
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const skip = (page - 1) * pageSize;

    // Filters
    const search = url.searchParams.get('search') || '';
    const category = url.searchParams.get('category') || '';
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const taxRelevant = url.searchParams.get('taxRelevant');

    const where: Prisma.ExpenseWhereInput = { userId };

    if (category) {
      where.category = category;
    }

    if (taxRelevant === 'true') where.taxRelevant = true;
    if (taxRelevant === 'false') where.taxRelevant = false;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    if (search) {
      where.OR = [
        { description: { contains: search } },
        { category: { contains: search } },
      ];
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          description: true,
          amount: true,
          date: true,
          category: true,
          taxRelevant: true,
          taxDeductiblePercentage: true,
          depreciationYears: true,
          receiptFileName: true,
        },
      }),
      prisma.expense.count({ where }),
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

// POST /api/v1/expenses
export async function POST(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    try {
      const {
        description,
        amount,
        date,
        category,
        taxRelevant,
        taxDeductiblePercentage,
        depreciationYears,
      } = body;
      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return apiError('Description is required', 400, 'VALIDATION_ERROR');
      }
      const parsedAmount = parseAmount(amount, true)!;
      const parsedDate = parseDate(date, true);
      const parsedCategory = parseCategory(category);
      const parsedTaxRelevant = taxRelevant === undefined ? true : parseTaxRelevant(taxRelevant);
      const parsedDeductible = parsePercentage(taxDeductiblePercentage, 100);
      const parsedDepreciation = parseDepreciationYears(depreciationYears);
      const expense = await inTransaction(async tx => tx.expense.create({
        data: {
          description: description.trim(),
          amount: parsedAmount,
          date: parsedDate,
          category: parsedCategory,
          taxRelevant: parsedTaxRelevant,
          taxDeductiblePercentage: parsedDeductible,
          depreciationYears: parsedDepreciation,
          userId,
        },
      }));
      await auditCreate(userId, 'Expense', expense);

      const response = apiSuccess(expense);
      response.headers.set('Location', `/api/v1/expenses/${expense.id}`);
      Object.entries(corsHeaders()).forEach(([key, value]) => response.headers.set(key, value));
      return new Response(response.body, { status: 201, headers: response.headers });
    } catch (error) {
      const response = mutationErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }, { requiredScopes: ['write'] });
}

// PUT /api/v1/expenses?id=<id>
export async function PUT(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Expense ID is required', 400, 'MISSING_ID');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    try {
      const parsedId = parsePositiveId(id, 'expense ID');
      const {
        description,
        amount,
        date,
        category,
        taxRelevant,
        taxDeductiblePercentage,
        depreciationYears,
      } = body;
      if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
        return apiError('Description cannot be empty', 400, 'VALIDATION_ERROR');
      }
      const parsedAmount = parseAmount(amount);
      const parsedDate = date === undefined ? undefined : parseDate(date);
      const parsedCategory = category === undefined ? undefined : parseCategory(category);
      const parsedTaxRelevant = taxRelevant === undefined ? undefined : parseTaxRelevant(taxRelevant);
      const parsedDeductible = parsePercentage(taxDeductiblePercentage, 100);
      const parsedDepreciation = depreciationYears === undefined ? undefined : parseDepreciationYears(depreciationYears);

      const result = await inTransaction(async tx => {
        const existing = await tx.expense.findFirst({ where: { id: parsedId, userId }, include: { cashTransaction: true } });
        if (!existing) throw new ExpenseMutationError(404, 'NOT_FOUND', 'Expense not found');
        if (existing.cashTransaction) {
          throw new ExpenseMutationError(409, 'LINKED_BOOKING', 'Linked bookings must be changed through their invoice or cashbook');
        }
        const expense = await tx.expense.update({
          where: { id: parsedId, AND: [{ userId }, { cashTransaction: { is: null } }] },
          data: {
            ...(description !== undefined && { description: description.trim() }),
            ...(parsedAmount !== undefined && { amount: parsedAmount }),
            ...(parsedDate !== undefined && { date: parsedDate }),
            ...(parsedCategory !== undefined && { category: parsedCategory }),
            ...(parsedTaxRelevant !== undefined && { taxRelevant: parsedTaxRelevant }),
            ...(taxDeductiblePercentage !== undefined && { taxDeductiblePercentage: parsedDeductible }),
            ...(depreciationYears !== undefined && { depreciationYears: parsedDepreciation }),
          },
        });
        return { existing, expense };
      });
      await auditUpdate(userId, 'Expense', result.existing.id, result.existing, result.expense);

      const response = apiSuccess(result.expense);
      Object.entries(corsHeaders()).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    } catch (error) {
      const response = mutationErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/expenses?id=<id>
export async function DELETE(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Expense ID is required', 400, 'MISSING_ID');
    }

    try {
      const parsedId = parsePositiveId(id, 'expense ID');
      const existing = await inTransaction(async tx => {
        const current = await tx.expense.findFirst({ where: { id: parsedId, userId }, include: { cashTransaction: true } });
        if (!current) throw new ExpenseMutationError(404, 'NOT_FOUND', 'Expense not found');
        if (current.cashTransaction) {
          throw new ExpenseMutationError(409, 'LINKED_BOOKING', 'Linked bookings must be changed through their invoice or cashbook');
        }
        await tx.expense.delete({ where: { id: parsedId, AND: [{ userId }, { cashTransaction: { is: null } }] } });
        return current;
      });
      await auditDelete(userId, 'Expense', existing);

      const response = apiSuccess({ deleted: true, id: parsedId });
      Object.entries(corsHeaders()).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    } catch (error) {
      const response = mutationErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }, { requiredScopes: ['delete'] });
}
