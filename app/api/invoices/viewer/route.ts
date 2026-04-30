import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { getRawEInvoiceXml } from '@/lib/e-invoice-parser';
import { buildEInvoiceViewerHtml } from '@/lib/e-invoice-viewer';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID ist erforderlich' },
        { status: 400 }
      );
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: Number(id), userId },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'Rechnung nicht gefunden' },
        { status: 404 }
      );
    }

    if (!getRawEInvoiceXml(invoice.parsedData)) {
      return NextResponse.json(
        { error: 'Für diese Rechnung ist keine E-Rechnungs-XML verfügbar' },
        { status: 404 }
      );
    }

    const html = buildEInvoiceViewerHtml({
      fileName: invoice.fileName,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      parsedData: invoice.parsedData,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Anzeigen der E-Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Anzeigen der E-Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
