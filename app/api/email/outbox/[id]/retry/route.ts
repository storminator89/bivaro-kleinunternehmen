import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { readEmailOutbox, validateEmailRequestId, EmailOutboxConflict } from '@/lib/email-outbox';
import { sendDocumentEmail, EmailDeliveryRecordingError } from '@/lib/email';

async function postHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    const input = await request.json();
    const requestId = validateEmailRequestId(input?.requestId);
    const item = await readEmailOutbox(userId, id);
    if (!item || !item.invoiceId || !['invoice', 'quote'].includes(item.documentType)) return NextResponse.json({ error: 'Versandauftrag nicht gefunden.' }, { status: 404 });
    if (!['FAILED', 'UNKNOWN'].includes(item.state)) return NextResponse.json({ outbox: item });
    const result = await sendDocumentEmail(userId, {
      id: item.invoiceId, documentType: item.documentType as 'invoice' | 'quote',
      requestId: item.requestId, attachmentSha256: item.attachmentSha256, reviewedFrom: item.from, reviewedReplyTo: item.replyTo,
      to: item.to, cc: item.cc, bcc: item.bcc, subject: item.subject, text: item.text,
    }, { outboxId: item.id, requestId, acknowledgeUnknown: input.acknowledgeUnknown === true });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof EmailDeliveryRecordingError) return NextResponse.json({ error: error.message, code: 'DELIVERY_RECORDING_FAILED', smtpAccepted: true, retryUnsafe: true, messageId: error.messageId }, { status: 502 });
    return NextResponse.json({ error: error instanceof EmailOutboxConflict ? error.message : 'Wiederholung nicht möglich. Bitte Versandverlauf prüfen.' }, { status: 409 });
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
