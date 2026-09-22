import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import {
  extractPriceHistoryEntries,
  isPriceHistoryInvoiceFromTenant,
  PRICE_HISTORY_INVOICE_LIMIT,
  type PriceHistoryInvoice,
} from '@/lib/price-history';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const customerId = Number(id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return NextResponse.json({ error: 'Ungültige Kunden-ID' }, { status: 400 });
    }

    // Check ownership before querying history so an ID from another tenant
    // cannot be used to probe whether invoices exist.
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, userId },
      select: { id: true },
    });
    if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });

    // ISSUED is the explicit proof that a draft/import was actually sent. An
    // UNKNOWN imported row is intentionally excluded even when its parsed XML
    // happens to contain plausible line prices.
    const [settings, invoices] = await Promise.all([
      prisma.settings.findUnique({
        where: { userId },
        select: { companyName: true, email: true, taxNumber: true },
      }),
      prisma.invoice.findMany({
        where: {
          userId,
          customerId,
          type: 'INVOICE',
          status: { in: ['SENT', 'PAID'] },
          issuanceState: 'ISSUED',
        },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          uploadedAt: true,
          parsedData: true,
        },
        orderBy: [
          { invoiceDate: 'desc' },
          { uploadedAt: 'desc' },
          { id: 'desc' },
        ],
        take: PRICE_HISTORY_INVOICE_LIMIT,
      }),
    ]);

    const entries = extractPriceHistoryEntries(
      (invoices as PriceHistoryInvoice[]).filter(invoice => isPriceHistoryInvoiceFromTenant(invoice, settings || {})),
    );
    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Error fetching customer price history:', error);
    return NextResponse.json({ error: 'Preishistorie konnte nicht geladen werden' }, { status: 500 });
  }
}
