import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { parseQuoteWorkflowUpdate, QuoteWorkflowInputError } from '@/lib/quote-workflow';

class WorkflowConflict extends Error {}
async function patchHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return NextResponse.json({ error: 'Ungültige Angebots-ID' }, { status: 400 });
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: 'Ungültige Änderung' }, { status: 400 });
    const data = parseQuoteWorkflowUpdate(input);
    const expected = input.expected;
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)
      || !['status', 'quoteFollowUpOn', 'quoteResponseNote'].every(key => Object.hasOwn(expected, key))) {
      return NextResponse.json({ error: 'Bitte das Angebot neu laden und die Änderung erneut prüfen.' }, { status: 400 });
    }
    const result = await prisma.$transaction(async tx => {
      const old = await tx.invoice.findFirst({ where: { id: Number(id), userId, type: 'QUOTE' } });
      if (!old) return null;
      if (expected.status !== old.status || expected.quoteFollowUpOn !== old.quoteFollowUpOn || expected.quoteResponseNote !== old.quoteResponseNote) throw new WorkflowConflict();
      const changed = await tx.invoice.updateMany({
        where: { id: old.id, userId, type: 'QUOTE', status: old.status, quoteFollowUpOn: old.quoteFollowUpOn, quoteResponseNote: old.quoteResponseNote }, data,
      });
      if (changed.count !== 1) throw new WorkflowConflict();
      const updated = await tx.invoice.findFirstOrThrow({ where: { id: old.id, userId, type: 'QUOTE' } });
      await createFinancialAuditLog({
        userId, action: 'UPDATE', entityType: 'Quote', entityId: old.id,
        entityName: old.invoiceNumber || old.fileName,
        oldValues: { status: old.status, quoteFollowUpOn: old.quoteFollowUpOn, quoteResponseNote: old.quoteResponseNote },
        newValues: data,
        metadata: { actorId: userId, tenantId: userId, operation: 'quote.workflow.update', originalReference: old.invoiceNumber || `quote:${old.id}`, reason: 'Manual in-app follow-up and user-declared response; no electronic customer acceptance' },
      }, tx);
      return updated;
    });
    return result ? NextResponse.json(result) : NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof WorkflowConflict) return NextResponse.json({ error: 'Das Angebot wurde zwischenzeitlich geändert. Bitte schließen, neu laden und erneut prüfen. Ihre Eingabe bleibt bis dahin erhalten.' }, { status: 409 });
    if (error instanceof SyntaxError || error instanceof QuoteWorkflowInputError) return NextResponse.json({ error: error instanceof Error ? error.message : 'Ungültige Änderung' }, { status: 400 });
    console.error('Quote workflow update failed:', error);
    return NextResponse.json({ error: 'Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen.' }, { status: 500 });
  }
}
export const PATCH = protectMutation(patchHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
