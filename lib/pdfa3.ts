import { AFRelationship, PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib';

export const FACTUR_X_XML_FILENAME = 'factur-x.xml';

const OUTPUT_CONDITION_IDENTIFIER = 'sRGB IEC61966-2.1';

// Minimal LittleCMS sRGB ICC profile. PDF/A requires an embedded output intent;
// relying on the viewer's default DeviceRGB color space is not sufficient.
const SRGB_IEC61966_2_1_ICC_BASE64 =
  'AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oABAAeABMANwASYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c';

export type FacturXPdfA3Options = {
  invoiceNumber: string;
  createdAt?: Date;
  modifiedAt?: Date;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

export function getSrgbIccProfileBytes(): Uint8Array {
  return base64ToBytes(SRGB_IEC61966_2_1_ICC_BASE64);
}

function addOutputIntent(pdfDoc: PDFDocument, iccProfileBytes: Uint8Array) {
  const outputProfileStream = pdfDoc.context.flateStream(iccProfileBytes, {
    N: 3,
    Alternate: 'DeviceRGB',
  });
  const outputProfileRef = pdfDoc.context.register(outputProfileStream);

  const outputIntent = pdfDoc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of(OUTPUT_CONDITION_IDENTIFIER),
    Info: PDFString.of(OUTPUT_CONDITION_IDENTIFIER),
    DestOutputProfile: outputProfileRef,
  });
  const outputIntentRef = pdfDoc.context.register(outputIntent);

  const outputIntents = PDFArray.withContext(pdfDoc.context);
  outputIntents.push(outputIntentRef);
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), outputIntents);
}

function buildFacturXXmpMetadata({ invoiceNumber, createdAt, modifiedAt }: Required<FacturXPdfA3Options>): string {
  const title = xmlEscape(`Rechnung ${invoiceNumber}`);
  const createdAtIso = xmlEscape(toIsoDate(createdAt));
  const modifiedAtIso = xmlEscape(toIsoDate(modifiedAt));

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"
      xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <xmp:CreatorTool>Bivaro</xmp:CreatorTool>
      <xmp:CreateDate>${createdAtIso}</xmp:CreateDate>
      <xmp:ModifyDate>${modifiedAtIso}</xmp:ModifyDate>
      <xmp:MetadataDate>${modifiedAtIso}</xmp:MetadataDate>
      <pdf:Producer>pdf-lib</pdf:Producer>
      <dc:format>application/pdf</dc:format>
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${title}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTUR_X_XML_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Document type</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Name of the embedded XML invoice file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Factur-X version</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Factur-X conformance level</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function addXmpMetadata(pdfDoc: PDFDocument, metadata: string) {
  const metadataXmlBytes = new TextEncoder().encode(metadata);
  const metadataStream = pdfDoc.context.stream(metadataXmlBytes, {
    Type: 'Metadata',
    Subtype: 'XML',
    Length: metadataXmlBytes.length,
  });
  const metadataStreamRef = pdfDoc.context.register(metadataStream);
  pdfDoc.catalog.set(PDFName.of('Metadata'), metadataStreamRef);
}

export async function addFacturXPdfA3Metadata(
  pdfDoc: PDFDocument,
  xmlContent: string,
  options: FacturXPdfA3Options,
): Promise<void> {
  const createdAt = options.createdAt ?? new Date();
  const modifiedAt = options.modifiedAt ?? createdAt;
  const xmlBytes = new TextEncoder().encode(xmlContent);

  pdfDoc.setTitle(`Rechnung ${options.invoiceNumber}`);
  pdfDoc.setSubject('Factur-X/ZUGFeRD invoice');
  pdfDoc.setCreator('Bivaro');
  pdfDoc.setProducer('pdf-lib');
  pdfDoc.setCreationDate(createdAt);
  pdfDoc.setModificationDate(modifiedAt);

  await pdfDoc.attach(xmlBytes, FACTUR_X_XML_FILENAME, {
    mimeType: 'text/xml',
    description: 'Factur-X/ZUGFeRD invoice XML',
    creationDate: createdAt,
    modificationDate: modifiedAt,
    afRelationship: AFRelationship.Alternative,
  });

  addOutputIntent(pdfDoc, getSrgbIccProfileBytes());
  addXmpMetadata(pdfDoc, buildFacturXXmpMetadata({
    invoiceNumber: options.invoiceNumber,
    createdAt,
    modifiedAt,
  }));
}
