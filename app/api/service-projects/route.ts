import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { BillingNoteInputError, parsePositiveId } from '@/lib/billing-notes';
import { parseServiceProjectCreate, parseServiceProjectUpdate } from '@/lib/service-projects';
import { protectMutation } from '@/lib/request-security';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';

const projectSelect = { id: true, customerId: true, name: true, archivedAt: true, createdAt: true, updatedAt: true } as const;

async function readInput(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readRequestBodyWithinLimit(request, 16 * 1024);
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new BillingNoteInputError('Ungültiges JSON.'); }
}

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof BillingNoteInputError || error instanceof RequestBodyLimitError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('Service project request failed:', error);
  return NextResponse.json({ error: 'Projekt konnte nicht verarbeitet werden. Bitte erneut versuchen.' }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const value = url.searchParams.get('customerId');
    const customerId = value === null ? undefined : parsePositiveId(value, 'Kunden-ID');
    if (customerId !== undefined && !await prisma.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } })) {
      throw new BillingNoteInputError('Kunde nicht gefunden.', 404);
    }
    const includeArchived = ['true', '1'].includes(url.searchParams.get('includeArchived') ?? '');
    const projects = await prisma.serviceProject.findMany({
      where: { userId, customerId, customer: { userId }, ...(includeArchived ? {} : { archivedAt: null }) },
      select: projectSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return NextResponse.json(projects);
  } catch (error) { return errorResponse(error); }
}

async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const input = parseServiceProjectCreate(await readInput(request));
    const created = await prisma.$transaction(async tx => {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, userId }, select: { id: true } });
      if (!customer) throw new BillingNoteInputError('Kunde nicht gefunden.', 404);
      return tx.serviceProject.create({ data: { ...input, userId }, select: projectSelect });
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

async function patchHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const { id, name, archived } = parseServiceProjectUpdate(await readInput(request));
    const project = await prisma.$transaction(async tx => {
      const existing = await tx.serviceProject.findFirst({ where: { id, userId, customer: { userId } } });
      if (!existing) throw new BillingNoteInputError('Projekt nicht gefunden.', 404);
      return tx.serviceProject.update({ where: { id }, data: {
        ...(name === undefined ? {} : { name }),
        ...(archived === undefined ? {} : { archivedAt: archived ? (existing.archivedAt ?? new Date()) : null }),
      }, select: projectSelect });
    });
    return NextResponse.json(project);
  } catch (error) { return errorResponse(error); }
}

export const POST = protectMutation(postHandler);
export const PATCH = protectMutation(patchHandler);
