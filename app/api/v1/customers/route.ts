/**
 * API v1 - Customers Endpoint
 * 
 * GET    /api/v1/customers       - List all customers
 * GET    /api/v1/customers/:id   - Get single customer
 * POST   /api/v1/customers       - Create customer
 * PUT    /api/v1/customers/:id   - Update customer
 * DELETE /api/v1/customers/:id   - Delete customer
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

// GET /api/v1/customers
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const skip = (page - 1) * pageSize;
    const search = url.searchParams.get('search') || '';

    const where: any = { userId };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { contactPerson: { contains: search } },
        { city: { contains: search } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          contactPerson: true,
          email: true,
          phone: true,
          address: true,
          zipCode: true,
          city: true,
          taxNumber: true,
          createdAt: true,
        },
      }),
      prisma.customer.count({ where }),
    ]);

    const response = apiSuccess(customers, {
      page,
      pageSize,
      total,
      hasMore: skip + customers.length < total,
    });

    // Add CORS headers
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// POST /api/v1/customers
export async function POST(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const { name, contactPerson, email, phone, address, zipCode, city, taxNumber } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return apiError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError('Invalid email format', 400, 'VALIDATION_ERROR');
    }

    const customer = await prisma.customer.create({
      data: {
        name: name.trim(),
        contactPerson: contactPerson?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        zipCode: zipCode?.trim() || null,
        city: city?.trim() || null,
        taxNumber: taxNumber?.trim() || null,
        userId,
      },
    });

    const response = apiSuccess(customer);
    response.headers.set('Location', `/api/v1/customers/${customer.id}`);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }, { requiredScopes: ['write'] });
}

// PUT /api/v1/customers (with id in query)
export async function PUT(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Customer ID is required', 400, 'MISSING_ID');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const { name, contactPerson, email, phone, address, zipCode, city, taxNumber } = body;

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return apiError('Name cannot be empty', 400, 'VALIDATION_ERROR');
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError('Invalid email format', 400, 'VALIDATION_ERROR');
    }

    // Check if customer exists and belongs to user
    const existing = await prisma.customer.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Customer not found', 404, 'NOT_FOUND');
    }

    const customer = await prisma.customer.update({
      where: { id: parseInt(id) },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(contactPerson !== undefined && { contactPerson: contactPerson?.trim() || null }),
        ...(email !== undefined && { email: email?.trim() || null }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(zipCode !== undefined && { zipCode: zipCode?.trim() || null }),
        ...(city !== undefined && { city: city?.trim() || null }),
        ...(taxNumber !== undefined && { taxNumber: taxNumber?.trim() || null }),
      },
    });

    const response = apiSuccess(customer);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/customers?id=<id>
export async function DELETE(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Customer ID is required', 400, 'MISSING_ID');
    }

    // Check if customer exists and belongs to user
    const existing = await prisma.customer.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Customer not found', 404, 'NOT_FOUND');
    }

    await prisma.customer.delete({
      where: { id: parseInt(id) },
    });

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['delete'] });
}
