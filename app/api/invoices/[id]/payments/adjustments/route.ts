import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';
import { PaymentJournalError } from '@/lib/payment-journal/contract';
import type { AdjustmentInput } from '@/lib/payment-journal/adjustment-contract';
async function postHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    let value: unknown;
    try { value = await request.json(); } catch { throw new PaymentJournalError('Ungültiges JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['kind', 'originalPaymentId', 'amount', 'actionDate', 'reason', 'reference', 'idempotencyKey', 'expectedLedgerVersion', 'cancellationInvoiceId', 'declarationNeverReceived', 'expectedAllocationRevision'].includes(key))) throw new PaymentJournalError('Nicht unterstützte Finanzaktionsfelder.');
    if ('expectedAllocationRevision' in value && request.headers.get('X-Bivaro-Payment-Contract') !== '3') return NextResponse.json({ error: 'Diese Finanzaktion erfordert Zahlungsjournal-Vertrag 3.', code: 'PAYMENT_CAPABILITY_REQUIRED', requiredContract: 3 }, { status: 409 });
    const result = await recordPaymentAdjustment(userId, Number(id), value as AdjustmentInput);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof PaymentJournalError) return NextResponse.json({ error: error.message, code: error.code, ...(error.summary ? { summary: error.summary } : {}), ...(error.ledgerVersion ? { ledgerVersion: error.ledgerVersion } : {}) }, { status: error.status });
    throw error;
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
