/**
 * API v1 - Incomes Endpoint
 * 
 * GET    /api/v1/incomes       - List all incomes
 * POST   /api/v1/incomes       - Create income
 * PUT    /api/v1/incomes?id=   - Update income
 * DELETE /api/v1/incomes?id=   - Delete income
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { BusinessDateError, parseBusinessDate } from '@/lib/business-date';
import {
  createManualIncome,
  deleteManualIncome,
  IncomeMutationError,
  updateManualIncome,
} from '@/lib/income-service';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';

function parsePositiveId(value: unknown, label: string): number {
  const text = String(value ?? '');
  const id = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(id)) {
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return id;
}

function parseOptionalCustomerId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid customer ID');
  }
  if (typeof value === 'string' && value.trim().length === 0) return null;
  return parsePositiveId(value, 'customer ID');
}

function parseAmount(value: unknown, required = false): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Valid amount is required');
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  if (typeof value === 'string' && value.trim().length === 0) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  return amount;
}

function parseRequiredBusinessDate(value: unknown): Date {
  try {
    return parseBusinessDate(value);
  } catch (error) {
    if (error instanceof BusinessDateError) {
      throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Business date must use a valid YYYY-MM-DD value', 'date');
    }
    throw error;
  }
}

function parseOptionalBusinessDate(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  return parseRequiredBusinessDate(value);
}

function parseTaxRelevant(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'taxRelevant must be boolean');
  return value;
}

function mutationErrorResponse(error: unknown) {
  if (!(error instanceof IncomeMutationError)) return null;
  if (!error.field) return apiError(error.message, error.status, error.code);
  return NextResponse.json({
    error: {
      message: error.message,
      code: error.code,
      field: error.field,
      timestamp: new Date().toISOString(),
    },
  }, { status: error.status });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request);
}

// GET /api/v1/incomes
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const skip = (page - 1) * pageSize;

    // Filters
    const search = url.searchParams.get('search') || '';
    const customerId = url.searchParams.get('customerId');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const where: Prisma.IncomeWhereInput = { userId };

    if (customerId) {
      where.customerId = parseInt(customerId);
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    if (search) {
      where.description = { contains: search };
    }

    const [incomes, total] = await Promise.all([
      prisma.income.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          description: true,
          amount: true,
          date: true,
          taxRelevant: true,
          customerId: true,
          invoiceId: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.income.count({ where }),
    ]);

    const response = apiSuccess(incomes, {
      page,
      pageSize,
      total,
      hasMore: skip + incomes.length < total,
    });

    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// POST /api/v1/incomes
export async function POST(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    try {
      const { description, amount, date, customerId, taxRelevant } = body;
      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return apiError('Description is required', 400, 'VALIDATION_ERROR');
      }
      const parsedAmount = parseAmount(amount, true)!;
      const parsedDate = parseRequiredBusinessDate(date);
      const parsedCustomerId = parseOptionalCustomerId(customerId);
      const parsedTaxRelevant = taxRelevant === undefined ? true : parseTaxRelevant(taxRelevant);

      const income = await createManualIncome(userId, {
        description: description.trim(),
        amount: parsedAmount,
        date: parsedDate,
        customerId: parsedCustomerId,
        taxRelevant: parsedTaxRelevant,
      });

      const response = apiSuccess(income);
      response.headers.set('Location', `/api/v1/incomes/${income.id}`);
      Object.entries(corsHeaders()).forEach(([key, value]) => response.headers.set(key, value));
      return new Response(response.body, { status: 201, headers: response.headers });
    } catch (error) {
      const response = mutationErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }, { requiredScopes: ['write'] });
}

// PUT /api/v1/incomes?id=<id>
export async function PUT(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Income ID is required', 400, 'MISSING_ID');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    try {
      const parsedId = parsePositiveId(id, 'income ID');
      const { description, amount, date, customerId, taxRelevant } = body;
      if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
        return apiError('Description cannot be empty', 400, 'VALIDATION_ERROR');
      }
      const parsedAmount = parseAmount(amount);
      const parsedDate = parseOptionalBusinessDate(date);
      const hasCustomer = customerId !== undefined;
      const parsedCustomerId = hasCustomer ? parseOptionalCustomerId(customerId) : undefined;
      const parsedTaxRelevant = taxRelevant === undefined ? undefined : parseTaxRelevant(taxRelevant);
      const income = await updateManualIncome(userId, parsedId, {
        ...(description !== undefined && { description: description.trim() }),
        ...(parsedAmount !== undefined && { amount: parsedAmount }),
        ...(parsedDate !== undefined && { date: parsedDate }),
        ...(hasCustomer && { customerId: parsedCustomerId! }),
        ...(parsedTaxRelevant !== undefined && { taxRelevant: parsedTaxRelevant }),
      });

      const response = apiSuccess(income);
      Object.entries(corsHeaders()).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    } catch (error) {
      const response = mutationErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/incomes?id=<id>
export async function DELETE(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Income ID is required', 400, 'MISSING_ID');
    }

    try {
      const parsedId = parsePositiveId(id, 'income ID');
      await deleteManualIncome(userId, parsedId);

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
