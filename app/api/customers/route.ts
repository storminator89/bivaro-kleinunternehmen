import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
import { readRequestBodyWithinLimit, RequestBodyLimitError, MAX_JSON_REQUEST_BYTES } from '@/lib/resource-limits';
import { BillingNoteInputError, parseNoteVisibility } from '@/lib/billing-notes';

const MAX_CUSTOMER_FIELD_LENGTH = 2_000;
const MAX_CUSTOMER_NAME_LENGTH = 500;

function parseJsonObject(body: Uint8Array): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
  return parsed as Record<string, unknown>;
}

function requiredCustomerName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new BillingNoteInputError('Customer name is required');
  const name = value.trim();
  if (name.length > MAX_CUSTOMER_NAME_LENGTH) throw new BillingNoteInputError('Customer name is too long');
  return name;
}

function optionalCustomerField(input: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in input)) return undefined;
  const value = input[key];
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new BillingNoteInputError(`${key} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_CUSTOMER_FIELD_LENGTH) throw new BillingNoteInputError(`${key} is too long`);
  return trimmed || null;
}

function optionalCustomerData(input: Record<string, unknown>, includeDefaults = false) {
  const data: Record<string, unknown> = {};
  for (const key of ['email', 'address', 'zipCode', 'city', 'taxNumber', 'contactPerson', 'phone', 'internalNote']) {
    const value = optionalCustomerField(input, key);
    if (value !== undefined) data[key] = value;
    else if (includeDefaults) data[key] = null;
  }
  if ('noteVisibility' in input || includeDefaults) data.noteVisibility = parseNoteVisibility(input.noteVisibility, 'BOTH');
  return data;
}

async function readCustomerBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readRequestBodyWithinLimit(request, MAX_JSON_REQUEST_BYTES);
  try {
    return parseJsonObject(body);
  } catch {
    throw new BillingNoteInputError('Ungültiges JSON');
  }
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const customers = await prisma.customer.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return NextResponse.json(customers);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const input = await readCustomerBody(request);
    const name = requiredCustomerName(input.name);

    const newCustomer = await prisma.customer.create({
      data: {
        name,
        ...optionalCustomerData(input, true),
        userId,
      },
    });

    // Audit log
    await auditCreate(userId, 'Customer', newCustomer, newCustomer.name);

    return NextResponse.json(newCustomer);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError || error instanceof BillingNoteInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const input = await readCustomerBody(request);
    const idValue = input.id;
    const parsedId = typeof idValue === 'number' ? idValue : Number(idValue);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) throw new BillingNoteInputError('Customer ID and name are required');
    const name = requiredCustomerName(input.name);

    // Get old values for audit - verify ownership first
    const oldCustomer = await prisma.customer.findFirst({
      where: { id: parsedId, userId },
    });
    
    if (!oldCustomer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: parsedId },
      data: {
        name,
        ...optionalCustomerData(input),
      },
    });

    // Audit log
    if (oldCustomer) {
      await auditUpdate(userId, 'Customer', parsedId, oldCustomer, updatedCustomer, updatedCustomer.name);
    }

    return NextResponse.json(updatedCustomer);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError || error instanceof BillingNoteInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating customer:', error);
    return NextResponse.json(
      { error: 'Customer not found or failed to update' },
      { status: 404 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Customer ID is required' }, { status: 400 });
    }

    // Get customer for audit before deletion - verify ownership
    const customer = await prisma.customer.findFirst({
      where: { id: Number(id), userId },
    });
    
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const billingNoteCount = await prisma.billingNote.count({ where: { customerId: customer.id, userId } });
    if (billingNoteCount > 0) {
      return NextResponse.json({ error: 'Kunden mit Leistungsnotizen können nicht gelöscht werden' }, { status: 409 });
    }

    await prisma.customer.delete({
      where: { id: Number(id), userId },
    });

    // Audit log
    if (customer) {
      await auditDelete(userId, 'Customer', customer, customer.name);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if ((error as { code?: string }).code === 'P2003') {
      return NextResponse.json({ error: 'Kunde kann wegen verknüpfter Daten nicht gelöscht werden' }, { status: 409 });
    }
    console.error('Error deleting customer:', error);
    return NextResponse.json(
      { error: 'Customer not found or failed to delete' },
      { status: 404 }
    );
  }
}
