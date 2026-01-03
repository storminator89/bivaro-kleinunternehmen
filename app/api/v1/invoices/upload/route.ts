/**
 * API v1 - Invoice Upload Endpoint
 * 
 * POST /api/v1/invoices/upload - Upload a ZUGFeRD/Factur-X PDF invoice
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString, PDFStream } from 'pdf-lib';
import { parseStringPromise } from 'xml2js';
import zlib from 'zlib';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';
import { UPLOAD_BASE_DIR, ensureUploadDirExists } from '@/lib/upload-path';

export async function OPTIONS() {
  return handleCors();
}

// Helper functions for ZUGFeRD extraction
async function extractAttachments(pdfDoc: PDFDocument) {
  const rawAttachments = (() => {
    if (!pdfDoc.catalog.has(PDFName.of('Names'))) return [];
    const Names = pdfDoc.catalog.lookup(PDFName.of('Names'), PDFDict);

    if (!Names.has(PDFName.of('EmbeddedFiles'))) return [];
    const EmbeddedFiles = Names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);

    if (!EmbeddedFiles.has(PDFName.of('Names'))) return [];
    const EFNames = EmbeddedFiles.lookup(PDFName.of('Names'), PDFArray);

    const attachments = [];
    for (let idx = 0, len = EFNames.size(); idx < len; idx += 2) {
      const fileName = EFNames.lookup(idx) as PDFHexString | PDFString;
      const fileSpec = EFNames.lookup(idx + 1, PDFDict);
      attachments.push({ fileName, fileSpec });
    }
    return attachments;
  })();

  return rawAttachments.map(({ fileName, fileSpec }) => {
    const stream = fileSpec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFStream);
    return {
      name: fileName.decodeText(),
      data: stream.getContents(),
    };
  });
}

function tryDecodeUtf8(data: Uint8Array): string | null {
  try {
    const txt = new TextDecoder().decode(data);
    return txt.trim().length > 0 ? txt : null;
  } catch {
    return null;
  }
}

function tryInflate(data: Uint8Array): string | null {
  try {
    const inflated = zlib.inflateSync(Buffer.from(data));
    return new TextDecoder().decode(inflated);
  } catch {
    return null;
  }
}

function tryGunzip(data: Uint8Array): string | null {
  try {
    const gunzipped = zlib.gunzipSync(Buffer.from(data));
    return new TextDecoder().decode(gunzipped);
  } catch {
    return null;
  }
}

async function extractZugferdXml(pdfBuffer: Buffer): Promise<string | null> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const attachments = await extractAttachments(pdfDoc);
  const candidates = attachments.filter(att => {
    const n = att.name.toLowerCase();
    return n.includes('zugferd') || n.includes('factur') || n.includes('xrechnung') || n.endsWith('.xml');
  });
  for (const attachment of candidates) {
    const asUtf8 = tryDecodeUtf8(attachment.data);
    if (asUtf8 && asUtf8.trim().startsWith('<')) return asUtf8;
    const inflated = tryInflate(attachment.data);
    if (inflated && inflated.trim().startsWith('<')) return inflated;
    const gunzipped = tryGunzip(attachment.data);
    if (gunzipped && gunzipped.trim().startsWith('<')) return gunzipped;
  }
  return null;
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

    if (file.type !== 'application/pdf') {
      return apiError('Only PDF files are supported', 400, 'INVALID_FILE_TYPE');
    }

    const tempDir = os.tmpdir();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filePath = join(tempDir, file.name);
    await writeFile(filePath, buffer);

    const uniqueFileName = `${uuidv4()}_${file.name.replace(/\s+/g, '_')}`;
    ensureUploadDirExists();
    const permanentFilePath = path.join(UPLOAD_BASE_DIR, uniqueFileName);

    fs.copyFileSync(filePath, permanentFilePath);

    // Extract ZUGFeRD XML
    const zugferdXmlContent = await extractZugferdXml(buffer);

    if (!zugferdXmlContent) {
      // Clean up
      try { fs.unlinkSync(filePath); } catch { }
      try { fs.unlinkSync(permanentFilePath); } catch { }
      return apiError('No ZUGFeRD/Factur-X XML found in PDF', 400, 'NO_ZUGFERD_XML');
    }

    let parsedXml: unknown;
    try {
      parsedXml = await parseStringPromise(zugferdXmlContent, { explicitArray: false });
    } catch {
      try { fs.unlinkSync(filePath); } catch { }
      try { fs.unlinkSync(permanentFilePath); } catch { }
      return apiError('Invalid or corrupted ZUGFeRD XML', 400, 'INVALID_XML');
    }

    // Helper functions
    const get = (obj: unknown, path: string): unknown => path.split('.').reduce((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
    const asDate = (yyyymmdd?: string | null) => {
      if (!yyyymmdd) return null;
      const s = String(yyyymmdd);
      const match = s.match(/^(\d{4})(\d{2})(\d{2})/);
      if (!match) return null;
      return new Date(`${match[1]}-${match[2]}-${match[3]}`);
    };
    const asNumber = (val: unknown) => {
      const n = parseFloat(String(val));
      return isNaN(n) ? null : n;
    };

    const root = (parsedXml as Record<string, unknown>)['rsm:CrossIndustryInvoice'] as Record<string, unknown> || (parsedXml as Record<string, unknown>)['CrossIndustryInvoice'] as Record<string, unknown> || (parsedXml as Record<string, unknown>)['Invoice'] as Record<string, unknown>;
    if (!root) {
      try { fs.unlinkSync(filePath); } catch { }
      try { fs.unlinkSync(permanentFilePath); } catch { }
      return apiError('Unknown ZUGFeRD/Factur-X structure', 400, 'UNKNOWN_STRUCTURE');
    }

    const exchangedDoc = root['rsm:ExchangedDocument'] || root['ExchangedDocument'];
    const tradeTransaction = root['rsm:SupplyChainTradeTransaction'] || root['SupplyChainTradeTransaction'];

    const invoiceNumber = get(exchangedDoc, 'ram:ID') as string || get(exchangedDoc, 'ID') as string || null;
    const invoiceDateStr = get(exchangedDoc, 'ram:IssueDateTime.udt:DateTimeString._') as string || get(exchangedDoc, 'IssueDateTime.DateTimeString._') as string || null;
    const invoiceDate = asDate(invoiceDateStr) || new Date();

    const dueDateStr = get(tradeTransaction, 'ram:ApplicableHeaderTradeSettlement.ram:SpecifiedTradePaymentTerms.ram:DueDateDateTime.udt:DateTimeString._') as string
      || get(tradeTransaction, 'ApplicableHeaderTradeSettlement.SpecifiedTradePaymentTerms.DueDateDateTime.DateTimeString._') as string;
    const dueDate = asDate(dueDateStr);

    const totalAmount = asNumber(
      get(tradeTransaction, 'ram:ApplicableHeaderTradeSettlement.ram:SpecifiedTradeSettlementHeaderMonetarySummation.ram:GrandTotalAmount')
      || get(tradeTransaction, 'ApplicableHeaderTradeSettlement.SpecifiedTradeSettlementHeaderMonetarySummation.GrandTotalAmount')
    );

    const customerName = get(tradeTransaction, 'ram:ApplicableHeaderTradeAgreement.ram:BuyerTradeParty.ram:Name') as string
      || get(tradeTransaction, 'ApplicableHeaderTradeAgreement.BuyerTradeParty.Name') as string
      || undefined;

    // Clean up temp file
    try { fs.unlinkSync(filePath); } catch { }

    // Check for duplicate invoice number
    if (invoiceNumber) {
      const existingInvoice = await prisma.invoice.findFirst({
        where: { invoiceNumber, userId },
      });

      if (existingInvoice) {
        try { fs.unlinkSync(permanentFilePath); } catch { }
        return apiError(`Invoice with number ${invoiceNumber} already exists`, 409, 'DUPLICATE_INVOICE');
      }
    }

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        fileName: file.name,
        storedFileName: uniqueFileName,
        invoiceNumber: invoiceNumber || `RG-${new Date().getTime()}`,
        invoiceDate: invoiceDate || new Date(),
        dueDate: dueDate,
        totalAmount: totalAmount ?? undefined,
        parsedData: {
          invoiceNumber,
          invoiceDate: (invoiceDate || new Date()).toISOString(),
          dueDate: dueDate ? dueDate.toISOString() : null,
          totalAmount: totalAmount ?? null,
          customerName,
        },
        userId,
      },
    });

    // Create income if there's a total amount
    if (totalAmount && totalAmount > 0) {
      const description = `Rechnung ${invoiceNumber || 'ohne Nummer'}`;

      let customerRecord = null;
      if (customerName) {
        customerRecord = await prisma.customer.findFirst({
          where: { name: customerName, userId },
        });

        if (!customerRecord) {
          customerRecord = await prisma.customer.create({
            data: { name: customerName, userId },
          });
        }
      }

      await prisma.income.create({
        data: {
          description: description.substring(0, 255),
          amount: totalAmount,
          customerId: customerRecord ? customerRecord.id : null,
          invoiceId: invoice.id,
          taxRelevant: true,
          userId,
        },
      });

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          customerId: customerRecord?.id,
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
      customerName,
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
