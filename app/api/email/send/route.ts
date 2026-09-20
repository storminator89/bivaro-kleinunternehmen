import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { EmailDeliveryRecordingError, normalizeSendEmailRequest, sendDocumentEmail } from '@/lib/email';

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = normalizeSendEmailRequest(await request.json());
    const result = await sendDocumentEmail(userId, payload);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof EmailDeliveryRecordingError) {
      return NextResponse.json({
        error: error.message, code: 'DELIVERY_RECORDING_FAILED',
        smtpAccepted: true, retryUnsafe: true, messageId: error.messageId,
      }, { status: 502 });
    }

    console.error('E-Mail-Versand fehlgeschlagen:', error);
    const message = error instanceof Error ? error.message : 'E-Mail konnte nicht versendet werden';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
