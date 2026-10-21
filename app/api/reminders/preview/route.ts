import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { previewReminder, ReminderWorkbenchError } from '@/lib/reminder-workbench';

async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const { invoiceId, ...input } = await request.json();
    return NextResponse.json(await previewReminder(userId, Number(invoiceId), input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof ReminderWorkbenchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: 'Der Mahnentwurf konnte nicht vorbereitet werden.' }, { status: 400 });
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
