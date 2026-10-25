import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { assertReminderDocument, previewReminder, ReminderWorkbenchError } from '@/lib/reminder-workbench';
import { generateReminderPdf } from '@/lib/reminder-pdf';

/** Explicit download only: fresh owner-bound data, no persistence or transport. */
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const { invoiceId, ...input } = await request.json();
    if (input.previewAsOf === undefined) {
      throw new ReminderWorkbenchError('Bitte vor dem PDF-Download eine neue Vorschau laden.', 409, 'DOCUMENT_CONFIRMATION_REQUIRED');
    }
    const preview = await previewReminder(userId, Number(invoiceId), input, true);
    assertReminderDocument(preview, input.expectedDocumentVersion);
    const bytes = await generateReminderPdf(preview);
    return new NextResponse(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="mahnentwurf-${preview.invoiceId}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof ReminderWorkbenchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    return NextResponse.json({ error: 'Der PDF-Entwurf konnte nicht heruntergeladen werden. Bitte erneut prüfen oder den Textentwurf verwenden.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
