/**
 * API v1 - Incomes Endpoint
 * 
 * GET    /api/v1/incomes       - List all incomes
 * POST   /api/v1/incomes       - Create income
 * PUT    /api/v1/incomes?id=   - Update income
 * DELETE /api/v1/incomes?id=   - Delete income
 */

import { NextRequest } from 'next/server';
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

    const where: any = { userId };

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

    const { description, amount, date, customerId, taxRelevant } = body;

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

    // Validate customer if provided
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: parseInt(customerId), userId },
      });
      if (!customer) {
        return apiError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
      }
    }

    const income = await prisma.income.create({
      data: {
        description: description.trim(),
        amount: parseFloat(amount),
        date: date ? new Date(date) : new Date(),
        customerId: customerId ? parseInt(customerId) : null,
        taxRelevant: taxRelevant !== undefined ? Boolean(taxRelevant) : true,
        userId,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const response = apiSuccess(income);
    response.headers.set('Location', `/api/v1/incomes/${income.id}`);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
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

    const { description, amount, date, customerId, taxRelevant } = body;

    // Check if income exists and belongs to user
    const existing = await prisma.income.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Income not found', 404, 'NOT_FOUND');
    }

    // Validation
    if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
      return apiError('Description cannot be empty', 400, 'VALIDATION_ERROR');
    }

    if (amount !== undefined && (isNaN(parseFloat(amount)) || parseFloat(amount) < 0)) {
      return apiError('Invalid amount', 400, 'VALIDATION_ERROR');
    }

    // Validate customer if provided
    if (customerId !== undefined && customerId !== null) {
      const customer = await prisma.customer.findFirst({
        where: { id: parseInt(customerId), userId },
      });
      if (!customer) {
        return apiError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
      }
    }

    const income = await prisma.income.update({
      where: { id: parseInt(id) },
      data: {
        ...(description !== undefined && { description: description.trim() }),
        ...(amount !== undefined && { amount: parseFloat(amount) }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(customerId !== undefined && { customerId: customerId ? parseInt(customerId) : null }),
        ...(taxRelevant !== undefined && { taxRelevant: Boolean(taxRelevant) }),
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const response = apiSuccess(income);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
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

    // Check if income exists and belongs to user
    const existing = await prisma.income.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Income not found', 404, 'NOT_FOUND');
    }

    await prisma.income.delete({
      where: { id: parseInt(id) },
    });

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['delete'] });
}
