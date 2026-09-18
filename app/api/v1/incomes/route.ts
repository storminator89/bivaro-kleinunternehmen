import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
/**
 * API v1 - Incomes Endpoint
 * 
 * GET    /api/v1/incomes       - List all incomes
 * POST   /api/v1/incomes       - Create income
 * PUT    /api/v1/incomes?id=   - Update income
 * DELETE /api/v1/incomes?id=   - Delete income
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

class IncomeMutationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

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
  return parsePositiveId(value, 'customer ID');
}

function parseDate(value: unknown, fallbackNow = false): Date {
  if (value === undefined || value === null || value === '') {
    if (fallbackNow) return new Date();
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid date');
  }
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid date');
  return date;
}

function parseAmount(value: unknown, required = false): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Valid amount is required');
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Invalid amount');
  return amount;
}

function parseTaxRelevant(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'taxRelevant must be boolean');
  return value;
}

function mutationErrorResponse(error: unknown) {
  return error instanceof IncomeMutationError ? apiError(error.message, error.status, error.code) : null;
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
      const parsedDate = parseDate(date, true);
      const parsedCustomerId = parseOptionalCustomerId(customerId);
      const parsedTaxRelevant = taxRelevant === undefined ? true : parseTaxRelevant(taxRelevant);

      const income = await inTransaction(async tx => {
        if (parsedCustomerId !== null && !await tx.customer.findFirst({ where: { id: parsedCustomerId, userId }, select: { id: true } })) {
          throw new IncomeMutationError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
        }
        return tx.income.create({
          data: {
            description: description.trim(),
            amount: parsedAmount,
            date: parsedDate,
            customerId: parsedCustomerId,
            taxRelevant: parsedTaxRelevant,
            userId,
          },
          include: { customer: { select: { id: true, name: true } } },
        });
      });
      await auditCreate(userId, 'Income', income);

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
      const parsedDate = date === undefined ? undefined : parseDate(date);
      const hasCustomer = customerId !== undefined;
      const parsedCustomerId = hasCustomer ? parseOptionalCustomerId(customerId) : undefined;
      const parsedTaxRelevant = taxRelevant === undefined ? undefined : parseTaxRelevant(taxRelevant);

      const result = await inTransaction(async tx => {
        const existing = await tx.income.findFirst({ where: { id: parsedId, userId }, include: { cashTransaction: true } });
        if (!existing) throw new IncomeMutationError(404, 'NOT_FOUND', 'Income not found');
        if (existing.cashTransaction || existing.invoiceId !== null) {
          throw new IncomeMutationError(409, 'LINKED_BOOKING', 'Linked bookings must be changed through their invoice or cashbook');
        }
        if (parsedCustomerId !== undefined && parsedCustomerId !== null && !await tx.customer.findFirst({ where: { id: parsedCustomerId, userId }, select: { id: true } })) {
          throw new IncomeMutationError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
        }
        const income = await tx.income.update({
          where: { id: parsedId, AND: [{ userId }, { invoiceId: null }, { cashTransaction: { is: null } }] },
          data: {
            ...(description !== undefined && { description: description.trim() }),
            ...(parsedAmount !== undefined && { amount: parsedAmount }),
            ...(parsedDate !== undefined && { date: parsedDate }),
            ...(hasCustomer && { customerId: parsedCustomerId! }),
            ...(parsedTaxRelevant !== undefined && { taxRelevant: parsedTaxRelevant }),
          },
          include: { customer: { select: { id: true, name: true } } },
        });
        return { existing, income };
      });
      await auditUpdate(userId, 'Income', result.existing.id, result.existing, result.income);

      const response = apiSuccess(result.income);
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
      const existing = await inTransaction(async tx => {
        const current = await tx.income.findFirst({ where: { id: parsedId, userId }, include: { cashTransaction: true } });
        if (!current) throw new IncomeMutationError(404, 'NOT_FOUND', 'Income not found');
        if (current.cashTransaction || current.invoiceId !== null) {
          throw new IncomeMutationError(409, 'LINKED_BOOKING', 'Linked bookings must be changed through their invoice or cashbook');
        }
        await tx.income.delete({ where: { id: parsedId, AND: [{ userId }, { invoiceId: null }, { cashTransaction: { is: null } }] } });
        return current;
      });
      await auditDelete(userId, 'Income', existing);

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
