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


async function extractZugferdXml(pdfBuffer: Buffer): Promise<string | null> {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const attachments = await extractAttachments(pdfDoc);
    for (const attachment of attachments) {
        if (attachment.name.toLowerCase().includes('zugferd-invoice.xml') || attachment.name.toLowerCase().includes('factur-x.xml') || attachment.name.toLowerCase().includes('xrechnung.xml')) {
            return new TextDecoder().decode(attachment.data);
        }
    }
    return null;
}

export async function POST(request: NextRequest) {
  try {
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
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    const permanentFilePath = path.join(uploadDir, uniqueFileName);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.copyFileSync(filePath, permanentFilePath);

    const zugferdXmlContent = await extractZugferdXml(buffer);

    if (!zugferdXmlContent) {
      return NextResponse.json({ error: 'Keine ZUGFeRD-XML in der PDF-Datei gefunden' }, { status: 400 });
    }

    const parsedXml = await parseStringPromise(zugferdXmlContent, { explicitArray: false });

    const exchangedDoc = parsedXml['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument'];
    const tradeTransaction = parsedXml['rsm:CrossIndustryInvoice']['rsm:SupplyChainTradeTransaction'];

    const invoiceNumber = exchangedDoc['ram:ID'];
    const invoiceDateStr = exchangedDoc['ram:IssueDateTime']['udt:DateTimeString']['_'];
    const invoiceDate = new Date(invoiceDateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));

    const dueDateStr = tradeTransaction['ram:ApplicableHeaderTradeSettlement']['ram:SpecifiedTradePaymentTerms']?.['ram:DueDateDateTime']?.['udt:DateTimeString']?.['_'];
    const dueDate = dueDateStr ? new Date(dueDateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) : null;

    const totalAmount = parseFloat(tradeTransaction['ram:ApplicableHeaderTradeSettlement']['ram:SpecifiedTradeSettlementHeaderMonetarySummation']['ram:GrandTotalAmount']);
    const customerName = tradeTransaction['ram:ApplicableHeaderTradeAgreement']['ram:BuyerTradeParty']['ram:Name'];

    const lineItemsData = tradeTransaction['ram:IncludedSupplyChainTradeLineItem'];
    const lineItems = (Array.isArray(lineItemsData) ? lineItemsData : [lineItemsData]).map(item => ({
      positionNumber: item['ram:AssociatedDocumentLineDocument']['ram:LineID'],
      description: item['ram:SpecifiedTradeProduct']['ram:Name'],
      date: item['ram:SpecifiedLineTradeDelivery']['ram:BilledQuantity']['_'],
      details: item['ram:SpecifiedTradeProduct']['ram:Description'],
      amount: parseFloat(item['ram:SpecifiedLineTradeSettlement']['ram:SpecifiedTradeSettlementLineMonetarySummation']['ram:LineTotalAmount'])
    }));
    
    const buyerTradeParty = tradeTransaction['ram:ApplicableHeaderTradeAgreement']['ram:BuyerTradeParty'];
    const buyerInfo = {
        email: buyerTradeParty['ram:DefinedTradeContact']['ram:EmailURIUniversalCommunication']['ram:URIID'],
        zipCode: buyerTradeParty['ram:PostalTradeAddress']['ram:PostcodeCode'],
        address: buyerTradeParty['ram:PostalTradeAddress']['ram:LineOne'],
        city: buyerTradeParty['ram:PostalTradeAddress']['ram:CityName'],
        country: buyerTradeParty['ram:PostalTradeAddress']['ram:CountryID'],
    };

    const sellerTradeParty = tradeTransaction['ram:ApplicableHeaderTradeAgreement']['ram:SellerTradeParty'];
    const sellerInfo = {
        name: sellerTradeParty['ram:Name'],
        email: sellerTradeParty['ram:DefinedTradeContact']['ram:EmailURIUniversalCommunication']['ram:URIID'],
        zipCode: sellerTradeParty['ram:PostalTradeAddress']['ram:PostcodeCode'],
        address: sellerTradeParty['ram:PostalTradeAddress']['ram:LineOne'],
        city: sellerTradeParty['ram:PostalTradeAddress']['ram:CityName'],
        country: sellerTradeParty['ram:PostalTradeAddress']['ram:CountryID'],
    };

    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Fehler beim Löschen der temporären Datei:', error);
    }

    const invoice = await prisma.invoice.create({
      data: {
        fileName: file.name,
        storedFileName: uniqueFileName,
        invoiceNumber: invoiceNumber || `RG-${new Date().getTime()}`,
        invoiceDate: invoiceDate,
        dueDate: dueDate,
        totalAmount,
        parsedData: {
          invoiceNumber,
          invoiceDate: invoiceDate.toISOString(),
          dueDate: dueDate ? dueDate.toISOString() : null,
          totalAmount,
          customerName,
          lineItems,
          buyerInfo,
          sellerInfo,
          rawXml: zugferdXmlContent
        },
        paidStatus: false,
      },
    });

    if (totalAmount > 0) {
      const description = `Rechnung ${invoiceNumber || 'ohne Nummer'}`;
      const income = await prisma.income.create({
        data: {
          description: description.substring(0, 255),
          amount: totalAmount,
          customer: customerName,
          invoiceId: invoice.id,
          taxRelevant: true,
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
    console.error('Fehler beim Hochladen der Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Verarbeiten der Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}