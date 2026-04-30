/**
 * API v1 - Invoice Upload Endpoint
 *
 * POST /api/v1/invoices/upload - Upload a ZUGFeRD/Factur-X PDF or standalone XML e-invoice
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/lib/prisma';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';
import { UPLOAD_BASE_DIR, ensureUploadDirExists } from '@/lib/upload-path';
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

export async function OPTIONS() {
  return handleCors();
}

function getSupportedFileKind(file: File): SupportedInvoiceFileKind | null {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (XML_MIME_TYPES.has(mimeType) || lowerName.endsWith('.xml')) return 'xml';
  return null;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = path.basename(fileName || 'invoice').replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized || 'invoice';
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

async function findOrCreateCustomer(parsedInvoice: ParsedEInvoice, userId: string) {
  const customerName = parsedInvoice.customerName;
  if (!customerName) return null;

  const existingCustomer = await prisma.customer.findFirst({
    where: { name: customerName, userId },
  });

  if (existingCustomer) return existingCustomer;

  return prisma.customer.create({
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

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return apiError('Failed to parse form data', 400, 'INVALID_FORM_DATA');
    }

    const file = formData.get('file') as File;

    if (!file) {
      return apiError('No file uploaded. Use field name "file"', 400, 'MISSING_FILE');
    }

    const fileKind = getSupportedFileKind(file);
    if (!fileKind) {
      return apiError('Only PDF or XML e-invoices are supported', 400, 'INVALID_FILE_TYPE');
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const xmlContent = await getInvoiceXmlContent(fileKind, buffer);

    if (!xmlContent) {
      const message = fileKind === 'pdf'
        ? 'No ZUGFeRD/Factur-X XML found in PDF'
        : 'XML file could not be read as an e-invoice';
      return apiError(message, 400, fileKind === 'pdf' ? 'NO_ZUGFERD_XML' : 'INVALID_XML');
    }

    let parsedInvoice: ParsedEInvoice;
    try {
      parsedInvoice = await parseEInvoiceXml(xmlContent);
    } catch (error) {
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

    const safeOriginalFileName = sanitizeFileName(file.name);
    const uniqueFileName = `${uuidv4()}_${safeOriginalFileName}`;
    ensureUploadDirExists();
    const permanentFilePath = path.join(UPLOAD_BASE_DIR, uniqueFileName);
    fs.writeFileSync(permanentFilePath, buffer);

    const customerRecord = await findOrCreateCustomer(parsedInvoice, userId);
    const invoiceDate = parsedInvoice.invoiceDate || new Date();
    const invoiceNumber = parsedInvoice.invoiceNumber || `RG-${Date.now()}`;

    const invoice = await prisma.invoice.create({
      data: {
        fileName: file.name,
        storedFileName: uniqueFileName,
        invoiceNumber,
        invoiceDate,
        dueDate: parsedInvoice.dueDate,
        totalAmount: parsedInvoice.totalAmount ?? undefined,
        parsedData: toStoredParsedData(parsedInvoice),
        customerId: customerRecord?.id,
        userId,
      },
    });

    if (parsedInvoice.totalAmount !== null && parsedInvoice.totalAmount > 0) {
      const income = await prisma.income.create({
        data: {
          description: `Rechnung ${invoiceNumber}`.substring(0, 255),
          amount: parsedInvoice.totalAmount,
          customerId: customerRecord ? customerRecord.id : null,
          invoiceId: invoice.id,
          taxRelevant: true,
          userId,
        },
      });

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          income: { connect: { id: income.id } },
        },
      });
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
