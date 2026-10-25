import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { previewReminder, ReminderWorkbenchError } from '@/lib/reminder-workbench';

/** Fresh balance validation, no record creation and no transport. Text draft, not an invoice PDF. */
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const { invoiceId, ...input } = await request.json();
    const preview = await previewReminder(userId, Number(invoiceId), input, true);
    return new NextResponse(`${preview.subject}\nDatenstand (UTC): ${preview.previewAsOf}\nDokumentrevision: ${preview.documentVersion}\n\n${preview.text}\n\nMahnungsentwurf - keine neue Rechnung, kein Versandnachweis.\n`, { headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="mahnentwurf-${Number(invoiceId)}.txt"`,
      'Cache-Control': 'no-store',
    } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof ReminderWorkbenchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: 'Der Mahnentwurf konnte nicht heruntergeladen werden.' }, { status: 400 });
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
