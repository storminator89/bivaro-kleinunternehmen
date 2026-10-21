import { parseServiceCaptureKey, serviceCaptureFingerprint } from '@/lib/service-capture';
import { protectMutation } from '@/lib/request-security';
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
import { parseBusinessDate, BusinessDateError } from '@/lib/business-date';
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
    const status = url.searchParams.get('status');
    if (status !== null && !['open', 'linked', 'all'].includes(status)) throw new BillingNoteInputError('Ungültiger Leistungsstatus.');
    const includeLinked = status === 'all' || status === 'linked' || isTruthy(url.searchParams.get('includeLinked')) || isTruthy(url.searchParams.get('all'));
    let customerId: number | undefined;
    if (customerValue !== null && customerValue !== '') {
      customerId = parsePositiveId(customerValue, 'Kunden-ID');
      const customer = await prisma.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } });
      if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const projectValue = url.searchParams.get('projectId');
    const projectId = projectValue === 'none' ? null : projectValue === null ? undefined : parsePositiveId(projectValue, 'Projekt-ID');
    if (typeof projectId === 'number') {
      const project = await prisma.serviceProject.findFirst({ where: { id: projectId, userId, customerId }, select: { id: true } });
      if (!project) throw new BillingNoteInputError('Projekt nicht gefunden.', 404);
    }
    let from: Date | undefined;
    let to: Date | undefined;
    try {
      const fromValue = url.searchParams.get('from');
      const toValue = url.searchParams.get('to');
      from = fromValue === null ? undefined : parseBusinessDate(fromValue);
      to = toValue === null ? undefined : parseBusinessDate(toValue);
    } catch (error) {
      if (error instanceof BusinessDateError) throw new BillingNoteInputError('Zeitraum muss gültige Kalendertage enthalten.');
      throw error;
    }
    if (from && to && from > to) throw new BillingNoteInputError('Beginn darf nicht nach Ende liegen.');
    const where: Prisma.BillingNoteWhereInput = {
      userId,
      deletedAt: null,
      ...(projectId === undefined ? {} : { projectId }),
      ...(from || to ? { serviceDate: { gte: from, lte: to } } : {}),
      ...(status === 'linked' ? { invoiceId: { not: null } } : {}),
      customer: { userId, ...(customerId === undefined ? {} : { id: customerId }) },
      ...(includeLinked ? {} : { invoiceId: null }),
      ...(includeLinked ? { OR: [{ invoiceId: null }, { invoice: { userId } }] } : {}),
    };
    const notes = await prisma.billingNote.findMany({
      where,
      include: { customer: { select: { id: true, name: true } }, project: { select: { id: true, name: true, archivedAt: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
      orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(notes.map(serializeBillingNote));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof BillingNoteInputError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    console.error('Error fetching billing notes:', error);
    return NextResponse.json({ error: 'Leistungsnotizen konnten nicht geladen werden' }, { status: 500 });
  }
}

async function postHandler(request: Request) {
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
    if (Object.hasOwn(input, 'deletedAt')) throw new BillingNoteInputError('Entfernte Leistungen können nicht erneut erfasst werden.');
    if (Object.hasOwn(input, 'captureFingerprint')) throw new BillingNoteInputError('Erfassungsnachweis wird serverseitig erstellt.');
    const note = parseBillingNoteInput(input);
    const captureKey = parseServiceCaptureKey(input.captureKey);
    const captureFingerprint = captureKey === null ? null : serviceCaptureFingerprint(note);
    const replay = async (client: Pick<Prisma.TransactionClient, 'billingNote'>) => {
      if (captureKey === null) return null;
      const existing = await client.billingNote.findFirst({ where: { userId, captureKey } });
      if (!existing) return null;
      if (existing.deletedAt !== null) throw new BillingNoteInputError('Diese Leistung wurde aus der Übersicht entfernt. Bitte den Bestand aktualisieren.', 409, 'CAPTURE_REMOVED');
      if (existing.captureFingerprint !== captureFingerprint || serviceCaptureFingerprint(existing) !== captureFingerprint) {
        throw new BillingNoteInputError('Dieser Erfassungsschlüssel gehört zu einer anderen Leistung. Bitte den Bestand aktualisieren.', 409, 'CAPTURE_CONFLICT');
      }
      return existing;
    };
    let result;
    try {
      result = await prisma.$transaction(async tx => {
        const existing = await replay(tx);
        if (existing) return { note: existing, replayed: true };
        const customer = await tx.customer.findFirst({ where: { id: note.customerId, userId }, select: { id: true } });
        if (!customer) throw new BillingNoteInputError('Kunde nicht gefunden', 404);
        if (note.projectId !== null) {
          const project = await tx.serviceProject.findFirst({ where: { id: note.projectId, customerId: note.customerId, userId } });
          if (!project) throw new BillingNoteInputError('Projekt nicht gefunden.', 404);
          if (project.archivedAt !== null) throw new BillingNoteInputError('Projekt ist archiviert. Bitte ein aktives Projekt wählen.', 409);
        }
        const created = await tx.billingNote.create({ data: { ...note, userId, captureKey, captureFingerprint } });
        await tx.auditLog.create({ data: {
          userId, action: 'CREATE', entityType: 'BillingNote', entityId: String(created.id), entityName: created.description,
          metadata: JSON.stringify({ operation: 'billing-note.capture', version: 1, captureKey, captureFingerprint }),
        } });
        return { note: created, replayed: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || captureKey === null) throw error;
      const existing = await replay(prisma);
      if (!existing) throw error;
      result = { note: existing, replayed: true };
    }
    return NextResponse.json(serializeBillingNote(result.note), { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof RequestBodyLimitError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof BillingNoteInputError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    console.error('Error creating billing note:', error);
    return NextResponse.json({ error: 'Leistungsnotiz konnte nicht gespeichert werden' }, { status: 500 });
  }
}

async function deleteHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const idValue = new URL(request.url).searchParams.get('id');
    const id = parsePositiveId(idValue, 'Leistungsnotiz-ID');
    await prisma.$transaction(async tx => {
      const note = await tx.billingNote.findFirst({ where: { id, userId } });
      if (!note) throw new BillingNoteInputError('Leistungsnotiz nicht gefunden', 404);
      if (note.invoiceId !== null) throw new BillingNoteInputError('Zugeordnete Leistungsnotizen können nicht entfernt werden', 409);
      if (note.deletedAt !== null) return;
      if (note.captureKey !== null) {
        const removed = await tx.billingNote.updateMany({ where: { id, userId, invoiceId: null, deletedAt: null }, data: { deletedAt: new Date() } });
        if (removed.count !== 1) throw new BillingNoteInputError('Leistung wurde inzwischen geändert. Bitte den Bestand aktualisieren.', 409);
        await tx.auditLog.create({ data: { userId, action: 'DELETE', entityType: 'BillingNote', entityId: String(id), entityName: note.description,
          metadata: JSON.stringify({ operation: 'billing-note.remove', version: 1, captureKey: note.captureKey, retainedReceipt: true }) } });
      } else {
        const removed = await tx.billingNote.deleteMany({ where: { id, userId, invoiceId: null, captureKey: null } });
        if (removed.count !== 1) throw new BillingNoteInputError('Leistung wurde inzwischen geändert. Bitte den Bestand aktualisieren.', 409);
      }
    });
    return NextResponse.json({ success: true, deleted: true, id });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof BillingNoteInputError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    console.error('Error deleting billing note:', error);
    return NextResponse.json({ error: 'Leistungsnotiz konnte nicht gelöscht werden' }, { status: 500 });
  }
}

export const POST = protectMutation(postHandler);
export const DELETE = protectMutation(deleteHandler);
