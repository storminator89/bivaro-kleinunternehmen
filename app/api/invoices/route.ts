import { readInvoiceList } from '@/lib/server/invoice-list';
import { protectMutation } from '@/lib/request-security';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { inTransaction } from '@/lib/db-transaction';
import { deleteTenantFile, writeTenantFile } from '@/lib/upload-path';
import {
  isFiniteNumber,
  readRequestBodyWithinLimit,
  RequestBodyLimitError,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_JSON_REQUEST_BYTES,
} from '@/lib/resource-limits';
import { PaymentJournalError } from '@/lib/payment-journal/contract';
import { deleteInvoice, InvoicePaymentError, updateInvoiceStatus } from '@/lib/invoice-payments';

async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRequestBodyWithinLimit(request, MAX_JSON_REQUEST_BYTES);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
    }
    const { fileName, invoiceNumber, invoiceDate, dueDate, totalAmount, parsedData, customerId, pdfBytes } = input;

    if (typeof fileName !== 'string' || fileName.trim().length === 0 || fileName.length > 255 || !parsedData || typeof parsedData !== 'object') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Only generated ordinary uploads can establish payment-term provenance.
    if ((parsedData as Record<string, unknown>).paymentTermSelection != null) {
      return NextResponse.json({ error: 'Zahlungszielherkunft ist nur bei der gewöhnlichen Rechnungserstellung zulässig.' }, { status: 400 });
    }

    // A record without actual document bytes would advertise a downloadable
    // PDF while containing an empty placeholder. Require callers of this JSON
    // compatibility endpoint to provide the real file content. The normal UI
    // uses /api/invoices/upload, which streams a multipart file instead.
    if (
      typeof pdfBytes !== 'string'
      || pdfBytes.length === 0
      || !/^[A-Za-z0-9+/]*={0,2}$/u.test(pdfBytes)
      || pdfBytes.length % 4 === 1
    ) {
      return NextResponse.json({ error: 'Eine echte PDF-Datei ist erforderlich' }, { status: 400 });
    }
    if (Math.ceil((pdfBytes.length * 3) / 4) > MAX_INVOICE_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'PDF ist zu groß' }, { status: 413 });
    }
    const pdfBuffer = Buffer.from(pdfBytes, 'base64');
    if (pdfBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Eine echte PDF-Datei ist erforderlich' }, { status: 400 });
    }
    if (pdfBuffer.byteLength > MAX_INVOICE_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'PDF ist zu groß' }, { status: 413 });
    }

    const parsedCustomerId = customerId === undefined || customerId === null || customerId === ''
      ? null
      : Number(customerId);
    if (parsedCustomerId !== null && (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0)) {
      return NextResponse.json({ error: 'Ungültiger Kunde' }, { status: 400 });
    }
    if (parsedCustomerId !== null) {
      const customer = await prisma.customer.findFirst({ where: { id: parsedCustomerId, userId } });
      if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const parsedAmount = totalAmount === undefined || totalAmount === null || totalAmount === ''
      ? null
      : Number(totalAmount);
    if (parsedAmount !== null && !isFiniteNumber(parsedAmount)) {
      return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });
    }
    const parsedInvoiceDate = invoiceDate ? new Date(String(invoiceDate)) : null;
    const parsedDueDate = dueDate ? new Date(String(dueDate)) : null;
    if ((parsedInvoiceDate && Number.isNaN(parsedInvoiceDate.getTime())) || (parsedDueDate && Number.isNaN(parsedDueDate.getTime()))) {
      return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
    }

    const normalizedInvoiceNumber = invoiceNumber === undefined || invoiceNumber === null || invoiceNumber === ''
      ? null
      : String(invoiceNumber).trim();
    if (normalizedInvoiceNumber) {
      const existingNumber = await prisma.invoice.findFirst({ where: { invoiceNumber: normalizedInvoiceNumber, userId } });
      if (existingNumber) {
        return NextResponse.json({ error: 'Die Rechnungsnummer ist bereits vergeben.' }, { status: 409 });
      }
    }

    let storedFileName: string | null = null;
    try {
      storedFileName = await writeTenantFile(userId, fileName, pdfBuffer);
      const invoice = await inTransaction(async tx => {
        const created = await tx.invoice.create({
          data: {
            fileName,
            storedFileName: storedFileName!,
            invoiceNumber: normalizedInvoiceNumber,
            invoiceDate: parsedInvoiceDate,
            dueDate: parsedDueDate,
            totalAmount: parsedAmount,
            parsedData,
            customerId: parsedCustomerId,
            // This compatibility endpoint imports caller-provided bytes; it
            // cannot prove that the document was never issued.
            issuanceState: 'UNKNOWN',
            userId,
          },
        });
        await createFinancialAuditLog({
          userId,
          action: 'CREATE',
          entityType: 'Invoice',
          entityId: created.id,
          entityName: created.invoiceNumber || created.fileName,
          newValues: { status: created.status, issuanceState: created.issuanceState, invoiceNumber: created.invoiceNumber },
          metadata: {
            actorId: userId,
            tenantId: userId,
            operation: 'invoice.create',
            originalReference: created.invoiceNumber ?? `invoice:${created.id}`,
            reason: 'invoice draft created',
          },
        }, tx);
        return created;
      });

      return NextResponse.json(invoice);
    } catch (error) {
      if (storedFileName) {
        try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort orphan cleanup */ }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Die Rechnungsnummer ist bereits vergeben.' }, { status: 409 });
    }
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
    const document = url.searchParams.get('document');
    if (document !== null && (!/^[1-9]\d*$/.test(document) || !Number.isSafeInteger(Number(document)))) return NextResponse.json({ error: 'Ungültige Dokument-ID' }, { status: 400 });
    return await readInvoiceList(userId, request.headers, {
      page, pageSize, search: url.searchParams.get('search') || '', paidStatus: url.searchParams.get('paidStatus'),
      dateRange: url.searchParams.get('dateRange') as 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null,
      ...(document !== null ? { documentId: Number(document) } : {}),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof PaymentJournalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function deleteHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }

    const result = await deleteInvoice(userId, Number(id));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof InvoicePaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
  }
}

async function putHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRequestBodyWithinLimit(request, MAX_JSON_REQUEST_BYTES);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
    }
    const { id, status, paidAt, customerId } = input;

    if (!id) {
      return NextResponse.json({ error: 'ID und Status sind erforderlich' }, { status: 400 });
    }
    const parsedId = Number(id);
    const parsedCustomerId: number | null | undefined = customerId === undefined || customerId === null || customerId === ''
      ? (customerId as null | undefined)
      : Number(customerId);
    if (parsedCustomerId !== undefined && parsedCustomerId !== null
      && (!Number.isSafeInteger(parsedCustomerId) || parsedCustomerId <= 0)) {
      return NextResponse.json({ error: 'Ungültiger Kunde' }, { status: 400 });
    }
    const parsedPaidAt: string | null | undefined = paidAt === undefined || paidAt === null || paidAt === ''
      ? (paidAt as null | undefined)
      : String(paidAt);
    const updatedInvoice = await updateInvoiceStatus(
      userId,
      parsedId,
      status === undefined ? undefined : String(status),
      parsedPaidAt,
      parsedCustomerId,
    );
    return NextResponse.json(updatedInvoice);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof InvoicePaymentError || error instanceof PaymentJournalError) {
      return NextResponse.json({ error: error.message, ...(error instanceof PaymentJournalError ? { code: error.code } : {}) }, { status: error.status });
    }
    return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
  }
}

export const POST = protectMutation(postHandler);
export const DELETE = protectMutation(deleteHandler);
export const PUT = protectMutation(putHandler);
