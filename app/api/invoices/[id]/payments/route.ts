import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { adoptLegacyPaidInvoice, readInvoicePaymentJournal, recordFullPayment } from '@/lib/payment-journal/service';
import { PaymentJournalError, type FullPaymentInput } from '@/lib/payment-journal/contract';

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof PaymentJournalError) return NextResponse.json({ error: error.message, code: error.code, ...(error.code === 'PAYMENT_CAPABILITY_REQUIRED' ? { requiredContract: 3 } : {}), ...(error.summary ? { summary: error.summary } : {}), ...(error.ledgerVersion ? { ledgerVersion: error.ledgerVersion } : {}) }, { status: error.status });
  throw error;
}

export async function GET(request: Request, context: Context) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    const journal = await readInvoicePaymentJournal(userId, Number(id), request.headers.get('X-Bivaro-Payment-Contract') === '3' ? 3 : 2);
    if (journal.adjustments.length && !['2', '3'].includes(request.headers.get('X-Bivaro-Payment-Contract') ?? '')) return NextResponse.json({ error: 'Dieser Zahlungsstand erfordert einen Client mit Zahlungsjournal-Vertrag 2.', code: 'PAYMENT_CAPABILITY_REQUIRED', requiredContract: 2 }, { status: 409 });
    return NextResponse.json(journal);
  } catch (error) { return errorResponse(error); }
}

async function postHandler(request: Request, context: Context) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    let input: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      input = value as Record<string, unknown>;
    } catch { return NextResponse.json({ error: 'Ungültiges JSON', code: 'INVALID_PAYMENT' }, { status: 400 }); }
    if (input.kind === 'LEGACY_IMPORT') {
      if (Object.keys(input).some(key => key !== 'kind')) throw new PaymentJournalError('Legacy-Übernahme akzeptiert keine geänderten Beträge oder historischen Daten.');
      return NextResponse.json(await adoptLegacyPaidInvoice(userId, Number(id)));
    }
    if (Object.keys(input).some(key => !['amount', 'currency', 'paidAt', 'source', 'reference', 'idempotencyKey', 'expectedPaidCents', 'expectedLedgerVersion'].includes(key))) {
      throw new PaymentJournalError('Nicht unterstützte Zahlungsfelder.');
    }
    if (input.source !== 'MANUAL') throw new PaymentJournalError('Für neue Zahlungen ist die Quelle MANUAL erforderlich.');
    const result = await recordFullPayment(userId, Number(id), input as FullPaymentInput);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
