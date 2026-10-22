import { describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib';
import { addFacturXPdfA3Metadata, FACTUR_X_XML_FILENAME, getSrgbIccProfileBytes } from '@/lib/pdfa3';

function decodePdfText(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }

  return null;
}

function lookupFacturXFileSpec(pdfDoc: PDFDocument): PDFDict {
  const names = pdfDoc.catalog.lookup(PDFName.of('Names'), PDFDict);
  const embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
  const embeddedFileNames = embeddedFiles.lookup(PDFName.of('Names'), PDFArray);
  const fileEntries = embeddedFileNames.asArray();

  for (let index = 0; index < fileEntries.length; index += 2) {
    const fileName = decodePdfText(fileEntries[index]);
    const fileSpecRef = fileEntries[index + 1];

    if (fileName === FACTUR_X_XML_FILENAME && fileSpecRef instanceof PDFRef) {
      return pdfDoc.context.lookup(fileSpecRef, PDFDict);
    }
  }

  throw new Error('Factur-X attachment was not found');
}

describe('PDF/A-3 Factur-X metadata', () => {
  it('embeds the Factur-X XML as an associated file with output intent and XMP metadata', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage();

    await addFacturXPdfA3Metadata(pdfDoc, '<rsm:CrossIndustryInvoice />', {
      invoiceNumber: 'RE-2025-001 & Co',
      createdAt: new Date('2025-01-02T03:04:05.000Z'),
      modifiedAt: new Date('2025-01-03T04:05:06.000Z'),
    });

    const savedBytes = await pdfDoc.save();
    const loadedDoc = await PDFDocument.load(savedBytes);
    const fileSpec = lookupFacturXFileSpec(loadedDoc);

    expect(fileSpec.lookup(PDFName.of('AFRelationship'), PDFName).toString()).toBe('/Alternative');
    expect(decodePdfText(fileSpec.lookup(PDFName.of('F')))).toBe(FACTUR_X_XML_FILENAME);

    const associatedFiles = loadedDoc.catalog.lookup(PDFName.of('AF'), PDFArray);
    expect(associatedFiles.size()).toBe(1);

    const outputIntents = loadedDoc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    expect(outputIntents.size()).toBe(1);
    const outputIntentRef = outputIntents.get(0);
    expect(outputIntentRef).toBeInstanceOf(PDFRef);
    const outputIntent = loadedDoc.context.lookup(outputIntentRef as PDFRef, PDFDict);
    expect(outputIntent.lookup(PDFName.of('S'), PDFName).toString()).toBe('/GTS_PDFA1');
    expect(decodePdfText(outputIntent.lookup(PDFName.of('OutputConditionIdentifier')))).toBe('sRGB IEC61966-2.1');
    expect(outputIntent.lookup(PDFName.of('DestOutputProfile'), PDFStream).getContentsSize()).toBeGreaterThan(0);

    const metadata = loadedDoc.catalog.lookup(PDFName.of('Metadata'), PDFStream).getContentsString();
    expect(metadata).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(metadata).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(metadata).toContain(`<fx:DocumentFileName>${FACTUR_X_XML_FILENAME}</fx:DocumentFileName>`);
    expect(metadata).toContain('<rdf:li xml:lang="x-default">Rechnung RE-2025-001 &amp; Co</rdf:li>');
    expect(loadedDoc.getSubject()).toBe('Factur-X/ZUGFeRD invoice');
    expect(metadata).toContain('<dc:description>');
    expect(metadata).toContain('<rdf:li xml:lang="x-default">Factur-X/ZUGFeRD invoice</rdf:li>');
  });

  it('ships an sRGB ICC profile for PDF/A output intents', () => {
    const iccProfile = getSrgbIccProfileBytes();

    expect(iccProfile.length).toBeGreaterThan(128);
    expect(String.fromCharCode(...iccProfile.slice(36, 40))).toBe('acsp');
  });

});
