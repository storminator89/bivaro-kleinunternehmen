/**
 * API v1 - Invoice Upload Endpoint
 *
 * POST /api/v1/invoices/upload - Upload a ZUGFeRD/Factur-X PDF or standalone XML e-invoice
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';
import { deleteTenantFile, writeTenantFile } from '@/lib/upload-path';
import { getNextDocumentNumber } from '@/lib/invoice-numbers';
import { ProcessingCapacityError, withProcessingSlot } from '@/lib/processing-limit';
import { inTransaction } from '@/lib/db-transaction';
import {
  isRequestBodyWithinLimit,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_XML_INPUT_BYTES,
} from '@/lib/resource-limits';
import {
  extractEmbeddedEInvoiceXml,
  parseEInvoiceXml,
  type ParsedEInvoice,
} from '@/lib/e-invoice-parser';

type SupportedInvoiceFileKind = 'pdf' | 'xml';

const XML_MIME_TYPES = new Set([
  'application/xml',
  'text/xml',
  'application/x-xml',
  'application/octet-stream',
]);

export async function OPTIONS(request: NextRequest) {
  return handleCors(request);
}

function getSupportedFileKind(file: File): SupportedInvoiceFileKind | null {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (XML_MIME_TYPES.has(mimeType) || lowerName.endsWith('.xml')) return 'xml';
  return null;
}

function decodeStandaloneXml(buffer: Buffer): string | null {
  const xmlContent = new TextDecoder().decode(buffer).replace(/^\uFEFF/, '').trim();
  return xmlContent.startsWith('<') ? xmlContent : null;
}

async function getInvoiceXmlContent(fileKind: SupportedInvoiceFileKind, buffer: Buffer): Promise<string | null> {
  if (fileKind === 'pdf') {
    return extractEmbeddedEInvoiceXml(buffer);
  }
  return decodeStandaloneXml(buffer);
}

async function findOrCreateCustomer(
  parsedInvoice: ParsedEInvoice,
  userId: string,
  db: Pick<Prisma.TransactionClient, 'customer'> = prisma,
) {
  const customerName = parsedInvoice.customerName;
  if (!customerName) return null;

  const existingCustomer = await db.customer.findFirst({
    where: { name: customerName, userId },
  });

  if (existingCustomer) return existingCustomer;

  return db.customer.create({
    data: {
      name: customerName,
      email: parsedInvoice.buyerInfo.email ?? undefined,
      address: parsedInvoice.buyerInfo.address ?? undefined,
      zipCode: parsedInvoice.buyerInfo.zipCode ?? undefined,
      city: parsedInvoice.buyerInfo.city ?? undefined,
      userId,
    },
  });
}

function toStoredParsedData(parsedInvoice: ParsedEInvoice) {
  return {
    invoiceNumber: parsedInvoice.invoiceNumber,
    invoiceDate: parsedInvoice.invoiceDate ? parsedInvoice.invoiceDate.toISOString() : null,
    dueDate: parsedInvoice.dueDate ? parsedInvoice.dueDate.toISOString() : null,
    totalAmount: parsedInvoice.totalAmount,
    customerName: parsedInvoice.customerName,
    lineItems: parsedInvoice.lineItems,
    buyerInfo: parsedInvoice.buyerInfo,
    sellerInfo: parsedInvoice.sellerInfo,
    rawXml: parsedInvoice.rawXml,
    eInvoiceFormat: parsedInvoice.format,
  };
}

// POST /api/v1/invoices/upload
export async function POST(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const contentType = request.headers.get('content-type') || '';

    if (!contentType.includes('multipart/form-data')) {
      return apiError('Content-Type must be multipart/form-data', 400, 'INVALID_CONTENT_TYPE');
    }
    if (!isRequestBodyWithinLimit(request, MAX_INVOICE_UPLOAD_BYTES + 128 * 1024)) {
      return apiError('Request is too large', 413, 'PAYLOAD_TOO_LARGE');
    }

    let formData: FormData;
    try {
      const boundedBody = await readRequestBodyWithinLimit(request, MAX_INVOICE_UPLOAD_BYTES + 128 * 1024);
      formData = await requestWithBody(request, boundedBody).formData();
    } catch (error) {
      if (error instanceof RequestBodyLimitError) {
        return apiError(error.message, error.status, 'PAYLOAD_TOO_LARGE');
      }
      return apiError('Failed to parse form data', 400, 'INVALID_FORM_DATA');
    }

    const file = formData.get('file');

    if (!(file instanceof File)) {
      return apiError('No file uploaded. Use field name "file"', 400, 'MISSING_FILE');
    }

    const fileKind = getSupportedFileKind(file);
    if (!fileKind) {
      return apiError('Only PDF or XML e-invoices are supported', 400, 'INVALID_FILE_TYPE');
    }

    const maxFileBytes = fileKind === 'pdf' ? MAX_INVOICE_UPLOAD_BYTES : MAX_XML_INPUT_BYTES;
    if (file.size > maxFileBytes) {
      return apiError('File is too large', 413, 'PAYLOAD_TOO_LARGE');
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.byteLength > maxFileBytes) {
      return apiError('File is too large', 413, 'PAYLOAD_TOO_LARGE');
    }
    let parsedInvoice: ParsedEInvoice;
    try {
      const parsed = await withProcessingSlot(userId, async () => {
        const extracted = await getInvoiceXmlContent(fileKind, buffer);
        if (!extracted) return { extracted, parsed: null };
        return { extracted, parsed: await parseEInvoiceXml(extracted) };
      });
      if (!parsed.extracted || !parsed.parsed) {
        const message = fileKind === 'pdf'
          ? 'No ZUGFeRD/Factur-X XML found in PDF'
          : 'XML file could not be read as an e-invoice';
        return apiError(message, 400, fileKind === 'pdf' ? 'NO_ZUGFERD_XML' : 'INVALID_XML');
      }
      parsedInvoice = parsed.parsed;
    } catch (error) {
      if (error instanceof ProcessingCapacityError) {
        const response = apiError(error.message, error.status, 'PROCESSING_BUSY');
        response.headers.set('Retry-After', '1');
        return response;
      }
      if (error instanceof RequestBodyLimitError) {
        return apiError(error.message, error.status, 'PAYLOAD_TOO_LARGE');
      }
      const message = error instanceof Error ? error.message : 'Invalid e-invoice XML';
      return apiError(message, 400, 'INVALID_XML');
    }

    if (parsedInvoice.invoiceNumber) {
      const existingInvoice = await prisma.invoice.findFirst({
        where: { invoiceNumber: parsedInvoice.invoiceNumber, userId },
      });

      if (existingInvoice) {
        return apiError(`Invoice with number ${parsedInvoice.invoiceNumber} already exists`, 409, 'DUPLICATE_INVOICE');
      }
    }

    const invoiceDate = parsedInvoice.invoiceDate || new Date();
    if (Number.isNaN(invoiceDate.getTime()) || (parsedInvoice.dueDate && Number.isNaN(parsedInvoice.dueDate.getTime()))) {
      return apiError('Invalid invoice date', 400, 'INVALID_DATE');
    }
    if (parsedInvoice.totalAmount !== null && !Number.isFinite(parsedInvoice.totalAmount)) {
      return apiError('Invalid invoice amount', 400, 'INVALID_AMOUNT');
    }

    let storedFileName: string | null = null;
    let invoice;
    try {
      storedFileName = await writeTenantFile(userId, file.name, buffer);
      invoice = await inTransaction(async (tx) => {
        const customerRecord = await findOrCreateCustomer(parsedInvoice, userId, tx);
        const invoiceNumber = parsedInvoice.invoiceNumber || await getNextDocumentNumber(tx, userId, 'INVOICE', invoiceDate.getFullYear());
        return tx.invoice.create({
          data: {
            type: 'INVOICE',
            fileName: file.name,
            storedFileName: storedFileName!,
            invoiceNumber,
            invoiceDate,
            dueDate: parsedInvoice.dueDate,
            totalAmount: parsedInvoice.totalAmount ?? undefined,
            parsedData: toStoredParsedData(parsedInvoice),
            customerId: customerRecord?.id,
            userId,
          },
        });
      });
    } catch (error) {
      if (storedFileName) {
        try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort orphan cleanup */ }
      }
      if ((error as { code?: string }).code === 'P2002') {
        return apiError('Invoice number already exists', 409, 'DUPLICATE_INVOICE');
      }
      throw error;
    }

    const response = apiSuccess({
      id: invoice.id,
      fileName: invoice.fileName,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      customerName: parsedInvoice.customerName,
      eInvoiceFormat: parsedInvoice.format,
      hasEInvoiceXml: true,
      hasPdfFile: fileKind === 'pdf',
    });

    response.headers.set('Location', `/api/v1/invoices?id=${invoice.id}`);
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }, { requiredScopes: ['write'] });
}
