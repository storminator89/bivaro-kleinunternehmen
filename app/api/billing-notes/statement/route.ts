import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';
import { BillingNoteInputError } from '@/lib/billing-notes';
import { formatBusinessDate } from '@/lib/business-date';
import { summarizeServiceDuration } from '@/lib/service-duration';
import { MAX_STATEMENT_REQUEST_BYTES, parseStatementRequest, type ServiceStatementSnapshot } from '@/lib/service-statement';
import { generateServiceStatementPdf } from '@/lib/service-statement-pdf';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** POST keeps selected IDs out of URLs. It is strictly read-only, including retries. */
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const bytes = await readRequestBodyWithinLimit(request, MAX_STATEMENT_REQUEST_BYTES);
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new BillingNoteInputError('Ungültiges JSON.'); }
    const selection = parseStatementRequest(input);
    const snapshot = await prisma.$transaction(async tx => {
      const customer = await tx.customer.findFirst({ where: { id: selection.customerId, userId }, select: { id: true, name: true } });
      if (!customer) throw new BillingNoteInputError('Kunde nicht gefunden.', 404);
      const projectId = selection.project === 'all' ? undefined : selection.project === 'none' ? null : Number(selection.project);
      const project = typeof projectId === 'number'
        ? await tx.serviceProject.findFirst({ where: { id: projectId, userId, customerId: customer.id }, select: { name: true, archivedAt: true } }) : null;
      if (typeof projectId === 'number' && !project) throw new BillingNoteInputError('Projekt nicht gefunden.', 404);
      const notes = await tx.billingNote.findMany({
        where: {
          id: { in: selection.noteIds }, userId, customerId: customer.id, deletedAt: null,
          customer: { userId }, serviceDate: { gte: selection.from, lte: selection.to },
          ...(projectId === undefined ? {} : { projectId }),
          ...(selection.status === 'open' ? { invoiceId: null } : selection.status === 'linked' ? { invoiceId: { not: null } } : {}),
          AND: [
            { OR: [{ projectId: null }, { project: { userId, customerId: customer.id } }] },
            { OR: [{ invoiceId: null }, { invoice: { userId } }] },
          ],
        },
        select: { id: true, serviceDate: true, description: true, quantity: true, unit: true, durationMinutes: true, invoiceId: true, project: { select: { name: true, archivedAt: true } } },
        orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }], take: selection.noteIds.length,
      });
      if (notes.length !== selection.noteIds.length) throw new BillingNoteInputError('Auswahl nicht mehr verfügbar oder außerhalb der Filter. Bitte Leistungen neu laden und auswählen.', 409);
      if (notes.some(note => note.description !== selection.descriptions.get(note.id))) throw new BillingNoteInputError('Eine Beschreibung wurde inzwischen geändert. Bitte Leistungen neu laden und erneut freigeben.', 409);
      return {
        version: 1, generatedAt: new Date().toISOString(), customer,
        filters: { project: selection.project, from: formatBusinessDate(selection.from), to: formatBusinessDate(selection.to), status: selection.status, projectName: project?.name ?? null, projectArchived: Boolean(project?.archivedAt) },
        rows: notes.map(note => ({ id: note.id, serviceDate: formatBusinessDate(note.serviceDate), description: note.description, quantity: note.quantity, unit: note.unit, durationMinutes: note.durationMinutes, projectName: note.project?.name ?? null, projectArchived: Boolean(note.project?.archivedAt), status: note.invoiceId === null ? 'open' : 'linked' })),
        totals: summarizeServiceDuration(notes),
      } satisfies ServiceStatementSnapshot;
    });
    // Both preview and PDF are made from this detached, single read snapshot.
    const pdf = await generateServiceStatementPdf(snapshot);
    if (pdf.byteLength > 2 * 1024 * 1024) throw new BillingNoteInputError('PDF zu groß. Bitte weniger Leistungen auswählen.', 413);
    return NextResponse.json({ snapshot, pdfBase64: Buffer.from(pdf).toString('base64'), filename: `Leistungsaufstellung-${snapshot.filters.from}-${snapshot.filters.to}.pdf` }, { headers });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof BillingNoteInputError || error instanceof RequestBodyLimitError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    // Do not log customer descriptions, selected IDs, or PDF contents.
    return NextResponse.json({ error: 'Aufstellung konnte nicht erstellt werden. Bitte erneut versuchen.' }, { status: 500, headers });
  }
}

export const POST = protectMutation(postHandler);
