import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { protectMutation } from '@/lib/request-security';
import { ProcessingCapacityError } from '@/lib/processing-limit';
import { RequestBodyLimitError } from '@/lib/resource-limits';
import { MAX_OWN_INVOICE_JSON_BYTES, OwnInvoiceInputError, parseOwnInvoiceSource } from '@/lib/own-invoice-source';
import { OwnInvoiceImageError } from '@/lib/server/own-invoice-image';
import { OwnInvoicePdfAValidationError } from '@/lib/server/own-invoice-pdfa-validator';
import { renderOwnInvoice } from '@/lib/server/own-invoice-renderer';

export const runtime = 'nodejs';

/** Render only. Issuance/upload/idempotent snapshots remain separate contracts. */
async function postHandler(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !['ADMIN', 'USER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Rechnungsdaten.' }, { status: 400 });
  }
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['source', 'preview'].includes(key))
      || !('source' in body) || !('preview' in body) || typeof body.preview !== 'boolean') {
      throw new OwnInvoiceInputError('Eine Rechnungsquelle und ein eindeutiger Vorschaumodus sind erforderlich.');
    }
    const source = parseOwnInvoiceSource(body.source);
    const bytes = await renderOwnInvoice(source, { userId: session.user.id, preview: body.preview });
    return new Response(bytes, { headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof OwnInvoiceInputError || error instanceof OwnInvoiceImageError
      || error instanceof RequestBodyLimitError || error instanceof OwnInvoicePdfAValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ProcessingCapacityError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Retry-After': '1' } });
    }
    // Do not log source values, addresses, bank data or native decoder output.
    console.error('Controlled invoice rendering failed.');
    return NextResponse.json({ error: 'Die Rechnung konnte nicht sicher erstellt oder als PDF/A-3b validiert werden. Es wurde keine Rechnung gespeichert.' }, { status: 500 });
  }
}

export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_OWN_INVOICE_JSON_BYTES });
