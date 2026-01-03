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
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';

export async function OPTIONS() {
  return handleCors();
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

    const {
      description,
      amount,
      date,
      category,
      taxRelevant,
      taxDeductiblePercentage,
      depreciationYears,
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

    const expense = await prisma.expense.create({
      data: {
        description: description.trim(),
        amount: parseFloat(amount),
        date: date ? new Date(date) : new Date(),
        category: category?.trim() || null,
        taxRelevant: taxRelevant !== undefined ? Boolean(taxRelevant) : true,
        taxDeductiblePercentage: taxDeductiblePercentage ? parseInt(taxDeductiblePercentage) : 100,
        depreciationYears: depreciationYears ? parseInt(depreciationYears) : null,
        userId,
      },
    });

    const response = apiSuccess(expense);
    response.headers.set('Location', `/api/v1/expenses/${expense.id}`);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
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

    const {
      description,
      amount,
      date,
      category,
      taxRelevant,
      taxDeductiblePercentage,
      depreciationYears,
    } = body;

    // Check if expense exists and belongs to user
    const existing = await prisma.expense.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Expense not found', 404, 'NOT_FOUND');
    }

    // Validation
    if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
      return apiError('Description cannot be empty', 400, 'VALIDATION_ERROR');
    }

    if (amount !== undefined && (isNaN(parseFloat(amount)) || parseFloat(amount) < 0)) {
      return apiError('Invalid amount', 400, 'VALIDATION_ERROR');
    }

    const expense = await prisma.expense.update({
      where: { id: parseInt(id) },
      data: {
        ...(description !== undefined && { description: description.trim() }),
        ...(amount !== undefined && { amount: parseFloat(amount) }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(category !== undefined && { category: category?.trim() || null }),
        ...(taxRelevant !== undefined && { taxRelevant: Boolean(taxRelevant) }),
        ...(taxDeductiblePercentage !== undefined && { taxDeductiblePercentage: parseInt(taxDeductiblePercentage) }),
        ...(depreciationYears !== undefined && { depreciationYears: depreciationYears ? parseInt(depreciationYears) : null }),
      },
    });

    const response = apiSuccess(expense);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
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

    // Check if expense exists and belongs to user
    const existing = await prisma.expense.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Expense not found', 404, 'NOT_FOUND');
    }

    await prisma.expense.delete({
      where: { id: parseInt(id) },
    });

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['delete'] });
}
