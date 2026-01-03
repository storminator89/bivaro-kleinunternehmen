import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString, PDFStream } from 'pdf-lib';
import { parseStringPromise } from 'xml2js';
import zlib from 'zlib';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { UPLOAD_BASE_DIR, ensureUploadDirExists } from '@/lib/upload-path';

const prisma = new PrismaClient();

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
    const txt = new TextDecoder().decode(inflated);
    return txt;
  } catch {
    return null;
  }
}

function tryGunzip(data: Uint8Array): string | null {
  try {
    const gunzipped = zlib.gunzipSync(Buffer.from(data));
    const txt = new TextDecoder().decode(gunzipped);
    return txt;
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
    // Some embedded files can be Flate/gzip compressed. Try multiple decoders.
    const asUtf8 = tryDecodeUtf8(attachment.data);
    if (asUtf8 && asUtf8.trim().startsWith('<')) return asUtf8;
    const inflated = tryInflate(attachment.data);
    if (inflated && inflated.trim().startsWith('<')) return inflated;
    const gunzipped = tryGunzip(attachment.data);
    if (gunzipped && gunzipped.trim().startsWith('<')) return gunzipped;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const tempDir = os.tmpdir();
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Nur PDF-Dateien werden unterstützt' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filePath = join(tempDir, file.name);
    await writeFile(filePath, buffer);

    const uniqueFileName = `${uuidv4()}_${file.name.replace(/\s+/g, '_')}`;
    ensureUploadDirExists();
    const permanentFilePath = path.join(UPLOAD_BASE_DIR, uniqueFileName);

    fs.copyFileSync(filePath, permanentFilePath);

    const zugferdXmlContent = await extractZugferdXml(buffer);

    if (!zugferdXmlContent) {
      return NextResponse.json({ error: 'Keine ZUGFeRD-XML in der PDF-Datei gefunden' }, { status: 400 });
    }

    let parsedXml: unknown;
    try {
      parsedXml = await parseStringPromise(zugferdXmlContent, { explicitArray: false });
    } catch {
      return NextResponse.json({ error: 'Ungültige oder komprimierte ZUGFeRD-XML konnte nicht gelesen werden' }, { status: 400 });
    }

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
      return NextResponse.json({ error: 'Unbekannte ZUGFeRD/Factur-X Struktur' }, { status: 400 });
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
    const customerName = get(tradeTransaction, 'ram:ApplicableHeaderTradeAgreement.ram:BuyerTradeParty.ram:Name')
      || get(tradeTransaction, 'ApplicableHeaderTradeAgreement.BuyerTradeParty.Name')
      || undefined;

    const lineItemsData = get(tradeTransaction, 'ram:IncludedSupplyChainTradeLineItem') || get(tradeTransaction, 'IncludedSupplyChainTradeLineItem') || [];
    const itemsArr = Array.isArray(lineItemsData) ? lineItemsData : [lineItemsData].filter(Boolean);
    const lineItems = itemsArr.map((item: unknown) => ({
      positionNumber: get(item, 'ram:AssociatedDocumentLineDocument.ram:LineID') || get(item, 'AssociatedDocumentLineDocument.LineID') || undefined,
      description: get(item, 'ram:SpecifiedTradeProduct.ram:Name') || get(item, 'SpecifiedTradeProduct.Name') || undefined,
      date: get(item, 'ram:SpecifiedLineTradeDelivery.ram:BilledQuantity._') || get(item, 'SpecifiedLineTradeDelivery.BilledQuantity._') || undefined,
      details: get(item, 'ram:SpecifiedTradeProduct.ram:Description') || get(item, 'SpecifiedTradeProduct.Description') || undefined,
      amount: asNumber(
        get(item, 'ram:SpecifiedLineTradeSettlement.ram:SpecifiedTradeSettlementLineMonetarySummation.ram:LineTotalAmount')
        || get(item, 'SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount')
      ),
    }));

    const buyerTradeParty = get(tradeTransaction, 'ram:ApplicableHeaderTradeAgreement.ram:BuyerTradeParty') || get(tradeTransaction, 'ApplicableHeaderTradeAgreement.BuyerTradeParty') || {};
    const buyerInfo = {
      email: get(buyerTradeParty, 'ram:DefinedTradeContact.ram:EmailURIUniversalCommunication.ram:URIID') as string
        || get(buyerTradeParty, 'DefinedTradeContact.EmailURIUniversalCommunication.URIID') as string
        || undefined,
      zipCode: get(buyerTradeParty, 'ram:PostalTradeAddress.ram:PostcodeCode') as string
        || get(buyerTradeParty, 'PostalTradeAddress.PostcodeCode') as string
        || undefined,
      address: get(buyerTradeParty, 'ram:PostalTradeAddress.ram:LineOne') as string
        || get(buyerTradeParty, 'PostalTradeAddress.LineOne') as string
        || undefined,
      city: get(buyerTradeParty, 'ram:PostalTradeAddress.ram:CityName') as string
        || get(buyerTradeParty, 'PostalTradeAddress.CityName') as string
        || undefined,
      country: get(buyerTradeParty, 'ram:PostalTradeAddress.ram:CountryID') as string
        || get(buyerTradeParty, 'PostalTradeAddress.CountryID') as string
        || undefined,
    };

    const sellerTradeParty = get(tradeTransaction, 'ram:ApplicableHeaderTradeAgreement.ram:SellerTradeParty') || get(tradeTransaction, 'ApplicableHeaderTradeAgreement.SellerTradeParty') || {};
    const sellerInfo = {
      name: get(sellerTradeParty, 'ram:Name') as string || get(sellerTradeParty, 'Name') as string || undefined,
      email: get(sellerTradeParty, 'ram:DefinedTradeContact.ram:EmailURIUniversalCommunication.ram:URIID') as string
        || get(sellerTradeParty, 'DefinedTradeContact.EmailURIUniversalCommunication.URIID') as string
        || undefined,
      zipCode: get(sellerTradeParty, 'ram:PostalTradeAddress.ram:PostcodeCode') as string
        || get(sellerTradeParty, 'PostalTradeAddress.PostcodeCode') as string
        || undefined,
      address: get(sellerTradeParty, 'ram:PostalTradeAddress.ram:LineOne') as string
        || get(sellerTradeParty, 'PostalTradeAddress.LineOne') as string
        || undefined,
      city: get(sellerTradeParty, 'ram:PostalTradeAddress.ram:CityName') as string
        || get(sellerTradeParty, 'PostalTradeAddress.CityName') as string
        || undefined,
      country: get(sellerTradeParty, 'ram:PostalTradeAddress.ram:CountryID') as string
        || get(sellerTradeParty, 'PostalTradeAddress.CountryID') as string
        || undefined,
    };

    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Fehler beim Löschen der temporären Datei:', error);
    }

    if (invoiceNumber) {
      const existingInvoice = await prisma.invoice.findFirst({
        where: { invoiceNumber, userId },
      });

      if (existingInvoice) {
        return NextResponse.json(
          { error: `Eine Rechnung mit der Nummer ${invoiceNumber} existiert bereits.` },
          { status: 409 } // Conflict
        );
      }
    }

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
          lineItems,
          buyerInfo,
          sellerInfo,
          rawXml: zugferdXmlContent
        },
        userId,
      },
    });

    if (totalAmount !== null && totalAmount > 0) {
      const description = `Rechnung ${invoiceNumber || 'ohne Nummer'}`;

      let customerRecord = null;
      if (customerName) {
        customerRecord = await prisma.customer.findFirst({
          where: { name: customerName, userId },
        });

        if (!customerRecord) {
          customerRecord = await prisma.customer.create({
            data: { name: customerName as string, userId },
          });
        }
      }

      const income = await prisma.income.create({
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
          income: { connect: { id: income.id } }
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
