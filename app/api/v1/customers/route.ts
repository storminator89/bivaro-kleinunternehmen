import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
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

// GET /api/v1/customers
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const skip = (page - 1) * pageSize;
    const search = url.searchParams.get('search') || '';

    const where: Prisma.CustomerWhereInput = { userId };

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

    return response;
  }, { requiredScopes: ['read'] });
}

// POST /api/v1/customers
async function postHandler(request: NextRequest) {
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
    await auditCreate(userId, 'Customer', customer);

    const response = apiSuccess(customer);
    response.headers.set('Location', `/api/v1/customers/${customer.id}`);
    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }, { requiredScopes: ['write'] });
}

// PUT /api/v1/customers (with id in query)
async function putHandler(request: NextRequest) {
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
    await auditUpdate(userId, 'Customer', existing.id, existing, customer);

    const response = apiSuccess(customer);
    return response;
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/customers?id=<id>
async function deleteHandler(request: NextRequest) {
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

    const finalizedResponse = () => apiError('Kunden mit festgeschriebenem manuellem Finanznachweis müssen erhalten bleiben.', 409, 'FINALIZED_RECORD');
    const finalizedReference = () => prisma.income.findFirst({ where: { customerId: existing.id, manualRecordState: 'FINALIZED' }, select: { id: true } });
    if (await finalizedReference()) return finalizedResponse();
    try {
      await prisma.customer.delete({
        where: { id: existing.id, userId },
      });
    } catch (error) {
      // The SQL retention trigger is authoritative if finalization wins after
      // the read guard. Preserve a clear conflict response rather than 500.
      const retentionConflict = error instanceof Error && error.message.includes('Customer must be retained for finalized manual financial evidence');
      const foreignKeyConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
      // SQLite may expose the trigger failure only as a foreign-key error.
      // Recheck the immutable reference; unrelated FK errors keep their path.
      if ((retentionConflict || foreignKeyConflict) && await finalizedReference()) return finalizedResponse();
      throw error;
    }
    await auditDelete(userId, 'Customer', existing);

    const response = apiSuccess({ deleted: true, id: parseInt(id) });
    return response;
  }, { requiredScopes: ['delete'] });
}

export const POST = protectMutation(postHandler, { bearer: true, maxBodyBytes: MAX_API_JSON_BODY_BYTES });
export const PUT = protectMutation(putHandler, { bearer: true, maxBodyBytes: MAX_API_JSON_BODY_BYTES });
export const DELETE = protectMutation(deleteHandler, { bearer: true });
