import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { RequestBodyLimitError, readRequestBodyWithinLimit } from '@/lib/resource-limits';
import { ProcessingCapacityError } from '@/lib/processing-limit';
import { PurchaseDocumentError } from './errors';

export async function purchaseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const bytes = await readRequestBodyWithinLimit(request, 16 * 1024);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyLimitError) throw error;
    throw new PurchaseDocumentError('Ungültige JSON-Anfrage.');
  }
}
export function purchaseErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof PurchaseDocumentError) return NextResponse.json({ error: error.message, code: error.code,
    ...(error.existingDocumentId ? { existingDocumentId: error.existingDocumentId, duplicateKind: 'EXACT_FILE' } : {}) }, { status: error.status });
  if (error instanceof RequestBodyLimitError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ProcessingCapacityError) return NextResponse.json({ error: error.message, code: 'PROCESSING_BUSY' }, { status: error.status, headers: { 'Retry-After': '1' } });
  if ((error as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Beleg wurde gleichzeitig geändert. Bitte erneut laden.', code: 'CONCURRENT_CONFLICT' }, { status: 409 });
  // Never expose parser errors, raw source, filesystem paths or DB exception strings.
  return NextResponse.json({ error: 'Eingangsbeleg konnte nicht verarbeitet werden.', code: 'INTERNAL_ERROR' }, { status: 500 });
}
