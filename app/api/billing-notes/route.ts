import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import {
  BillingNoteInputError,
  MAX_BILLING_NOTE_REQUEST_BYTES,
  parseBillingNoteInput,
  parsePositiveId,
} from '@/lib/billing-notes';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';
import { formatBusinessDate } from '@/lib/business-date';

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function serializeBillingNote<T extends { serviceDate: Date }>(note: T) {
  return { ...note, serviceDate: formatBusinessDate(note.serviceDate) };
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const customerValue = url.searchParams.get('customerId');
    const includeLinked = isTruthy(url.searchParams.get('includeLinked')) || isTruthy(url.searchParams.get('all'));
    let customerId: number | undefined;
    if (customerValue !== null && customerValue !== '') {
      customerId = parsePositiveId(customerValue, 'Kunden-ID');
      const customer = await prisma.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } });
      if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const where: Prisma.BillingNoteWhereInput = {
      userId,
      customer: { userId, ...(customerId === undefined ? {} : { id: customerId }) },
      ...(includeLinked ? {} : { invoiceId: null }),
      ...(includeLinked ? { OR: [{ invoiceId: null }, { invoice: { userId } }] } : {}),
    };
    const notes = await prisma.billingNote.findMany({
      where,
      include: { customer: { select: { id: true, name: true } } },
      orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(notes.map(serializeBillingNote));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof BillingNoteInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error fetching billing notes:', error);
    return NextResponse.json({ error: 'Leistungsnotizen konnten nicht geladen werden' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRequestBodyWithinLimit(request, MAX_BILLING_NOTE_REQUEST_BYTES);
    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
      input = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
    }
    const note = parseBillingNoteInput(input);
    const customer = await prisma.customer.findFirst({ where: { id: note.customerId, userId }, select: { id: true } });
    if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    const created = await prisma.billingNote.create({ data: { ...note, userId } });
    return NextResponse.json(serializeBillingNote(created), { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof RequestBodyLimitError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof BillingNoteInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error creating billing note:', error);
    return NextResponse.json({ error: 'Leistungsnotiz konnte nicht gespeichert werden' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const idValue = new URL(request.url).searchParams.get('id');
    const id = parsePositiveId(idValue, 'Leistungsnotiz-ID');
    const deleted = await prisma.billingNote.deleteMany({ where: { id, userId, invoiceId: null } });
    if (deleted.count !== 1) {
      const note = await prisma.billingNote.findFirst({ where: { id, userId }, select: { invoiceId: true } });
      if (!note) return NextResponse.json({ error: 'Leistungsnotiz nicht gefunden' }, { status: 404 });
      return NextResponse.json({ error: 'Zugeordnete Leistungsnotizen können nicht gelöscht werden' }, { status: 409 });
    }
    return NextResponse.json({ success: true, deleted: true, id });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof BillingNoteInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error deleting billing note:', error);
    return NextResponse.json({ error: 'Leistungsnotiz konnte nicht gelöscht werden' }, { status: 500 });
  }
}
