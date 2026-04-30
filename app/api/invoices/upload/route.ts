import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
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

function getSupportedFileKind(file: File): SupportedInvoiceFileKind | null {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (XML_MIME_TYPES.has(mimeType) || lowerName.endsWith('.xml')) return 'xml';
  return null;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = path.basename(fileName || 'rechnung').replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized || 'rechnung';
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

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    const fileKind = getSupportedFileKind(file);
    if (!fileKind) {
      return NextResponse.json({ error: 'Nur PDF- oder XML-E-Rechnungen werden unterstützt' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const xmlContent = await getInvoiceXmlContent(fileKind, buffer);

    if (!xmlContent) {
      const message = fileKind === 'pdf'
        ? 'Keine ZUGFeRD-/Factur-X-XML in der PDF-Datei gefunden'
        : 'Die XML-Datei konnte nicht als E-Rechnung gelesen werden';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    let parsedInvoice: ParsedEInvoice;
    try {
      parsedInvoice = await parseEInvoiceXml(xmlContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ungültige E-Rechnungs-XML';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (parsedInvoice.invoiceNumber) {
      const existingInvoice = await prisma.invoice.findFirst({
        where: { invoiceNumber: parsedInvoice.invoiceNumber, userId },
      });

      if (existingInvoice) {
        return NextResponse.json(
          { error: `Eine Rechnung mit der Nummer ${parsedInvoice.invoiceNumber} existiert bereits.` },
          { status: 409 }
        );
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

    return NextResponse.json(invoice);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Hochladen der Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Verarbeiten der Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
