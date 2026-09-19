/**
 * API v1 - Invoices Endpoint
 * 
 * GET    /api/v1/invoices       - List all invoices
 * GET    /api/v1/invoices?id=   - Get single invoice
 * PUT    /api/v1/invoices?id=   - Update invoice status
 * DELETE /api/v1/invoices?id=   - Delete invoice
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { updateInvoiceStatus, deleteInvoice, InvoicePaymentError } from '@/lib/invoice-payments';
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

// GET /api/v1/invoices
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const skip = (page - 1) * pageSize;

    // Filters
    const status = url.searchParams.get('status');
    const customerId = url.searchParams.get('customerId');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const invoiceNumber = url.searchParams.get('invoiceNumber');

    const where: Prisma.InvoiceWhereInput = { userId };

    if (status) {
      where.status = status.toUpperCase();
    }

    if (customerId) {
      where.customerId = parseInt(customerId);
    }

    if (invoiceNumber) {
      where.invoiceNumber = { contains: invoiceNumber };
    }

    if (startDate || endDate) {
      where.invoiceDate = {};
      if (startDate) where.invoiceDate.gte = new Date(startDate);
      if (endDate) where.invoiceDate.lte = new Date(endDate);
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          fileName: true,
          invoiceNumber: true,
          invoiceDate: true,
          dueDate: true,
          totalAmount: true,
          status: true,
          issuanceState: true,
          paidAt: true,
          uploadedAt: true,
          customerId: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    const response = apiSuccess(invoices, {
      page,
      pageSize,
      total,
      hasMore: skip + invoices.length < total,
    });

    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// PUT /api/v1/invoices?id=<id> - Update invoice status
export async function PUT(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Invoice ID is required', 400, 'MISSING_ID');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const { status, paidAt, customerId } = body;

    // Check if invoice exists and belongs to user
    const existing = await prisma.invoice.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return apiError('Invoice not found', 404, 'NOT_FOUND');
    }

    // Validate status
    const validStatuses = ['DRAFT', 'SENT', 'PAID'];
    if (status && !validStatuses.includes(status.toUpperCase())) {
      return apiError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
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

    let invoice;
    try {
      invoice = await updateInvoiceStatus(userId, Number(id), status?.toUpperCase(), paidAt, customerId === undefined ? undefined : customerId === null ? null : Number(customerId));
    } catch (error) {
      if (error instanceof InvoicePaymentError) return apiError(error.message, error.status);
      throw error;
    }

    const response = apiSuccess(invoice);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/invoices?id=<id>
export async function DELETE(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return apiError('Invoice ID is required', 400, 'MISSING_ID');
    }

    let result;
    try { result = await deleteInvoice(userId, Number(id)); }
    catch (error) {
      if (error instanceof InvoicePaymentError) return apiError(error.message, error.status);
      throw error;
    }
    const response = apiSuccess(result);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }, { requiredScopes: ['delete'] });
}
