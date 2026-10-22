import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { attachToEligiblePdf, inspectInvoiceXml, UnsupportedPdfError } from '../../scripts/foreign-pdf/document.mjs';
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const XML = '\uFEFF<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"><rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext></rsm:CrossIndustryInvoice>';
const XMP = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:private="urn:synthetic:private" xmp:ModifyDate="2026-10-01T00:00:00Z"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance><private:Kept><![CDATA[Text <&> Ä]]></private:Kept></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
async function fixture(change?: (doc: PDFDocument) => Promise<void> | void, xmp = XMP) {
  // Parser/serialization fixture only, NOT PDF/A conformance evidence.
  const doc = await PDFDocument.create(), page = doc.addPage([300,400]);
  page.drawText('Searchable unchanged text',{font:await doc.embedFont(StandardFonts.Helvetica),x:30,y:350});
  page.drawRectangle({x:10,y:10,width:30,height:40,opacity:0.4});
  const profile = doc.context.register(doc.context.stream(new Uint8Array([1,2,3,4]),{N:4}));
  doc.catalog.set(PDFName.of('OutputIntents'),doc.context.obj([{Type:'OutputIntent',S:'GTS_PDFA1',OutputConditionIdentifier:PDFString.of('synthetic-CMYK-preserved'),DestOutputProfile:profile}]));
  doc.catalog.set(PDFName.of('Metadata'),doc.context.register(doc.context.stream(new TextEncoder().encode(xmp),{Type:'Metadata',Subtype:'XML'})));
  if(change) await change(doc);
  return doc.save();
}
function raw(value:unknown):PDFRawStream {if(!(value instanceof PDFRawStream))throw new Error('Expected raw stream');return value;}
const metadata=(pdf:PDFDocument)=>new TextDecoder().decode(decodePDFRawStream(raw(pdf.catalog.lookup(PDFName.of('Metadata')))).decode());
const profile=(pdf:PDFDocument)=>{
  const intent=pdf.catalog.lookup(PDFName.of('OutputIntents'),PDFArray).lookup(0,PDFDict);
  return {id:intent.lookup(PDFName.of('OutputConditionIdentifier'),PDFString).decodeText(),bytes:hash(raw(intent.lookup(PDFName.of('DestOutputProfile'))).getContents())};
};
describe('foreign PDF pure candidate fixtures (not conformance evidence)',()=>{
  it('keeps original bytes, every existing content stream, geometry and non-sRGB output intent; embeds exact XML/BOM',async()=>{
    const bytes=await fixture(), original=hash(bytes), before=await PDFDocument.load(bytes,{updateMetadata:false});
    const candidate=await attachToEligiblePdf(bytes,XML,new Date('2026-10-22T12:00:00Z'));
    const after=await PDFDocument.load(candidate,{updateMetadata:false});
    expect(hash(bytes)).toBe(original);expect(profile(after)).toEqual(profile(before));
    expect(after.getPages().map(p=>p.getSize())).toEqual(before.getPages().map(p=>p.getSize()));
    expect(after.getPages().map(p=>p.node.Contents()?.toString())).toEqual(before.getPages().map(p=>p.node.Contents()?.toString()));
    for(const [,o] of before.context.enumerateIndirectObjects())if(o instanceof PDFRawStream && o.dict.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()!=='Metadata'){
      expect(after.context.enumerateIndirectObjects().some(([,n])=>n instanceof PDFRawStream&&hash(n.getContents())===hash(o.getContents()))).toBe(true);
    }
    const xmp=metadata(after);
    expect(xmp).toContain('<private:Kept>Text &lt;&amp;&gt; Ä</private:Kept>');
    expect(xmp).toContain('xmp:ModifyDate="2026-10-22T12:00:00.000Z"');
    expect(xmp).toContain('<xmp:MetadataDate>2026-10-22T12:00:00.000Z</xmp:MetadataDate>');
    const spec=after.catalog.lookup(PDFName.of('AF'),PDFArray).lookup(0,PDFDict);
    const embedded=raw(spec.lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F')));
    expect(hash(decodePDFRawStream(embedded).decode())).toBe(hash(new TextEncoder().encode(XML)));
  });
  it('does not invent output intents for calibrated sources',async()=>{
    const result=await attachToEligiblePdf(await fixture(doc=>{doc.catalog.delete(PDFName.of('OutputIntents'));}),XML);
    expect((await PDFDocument.load(result)).catalog.has(PDFName.of('OutputIntents'))).toBe(false);
  });
  it('preserves existing extension schema items while adding the Factur-X schema',async()=>{
    const xmp=XMP.replace('</rdf:Description>','<pdfaExtension:schemas xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"><rdf:Bag><rdf:li rdf:parseType="Resource"><original:Kept xmlns:original="urn:synthetic:schema">yes</original:Kept></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>');
    const final=metadata(await PDFDocument.load(await attachToEligiblePdf(await fixture(undefined,xmp),XML),{updateMetadata:false}));
    expect(final).toContain('urn:synthetic:schema');expect(final).toContain('Factur-X PDFA Extension Schema');
    expect(final.match(/<pdfaExtension:schemas/g)).toHaveLength(1);
  });
  it.each([
    ['FX element', '<alias:DocumentFileName xmlns:alias="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">old.xml</alias:DocumentFileName>', ''],
    ['abbreviated FX attribute', '', 'xmlns:alias="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#" alias:DocumentFileName="old.xml"'],
    ['declared schema and abbreviated FX attribute', '<ext:schemas xmlns:ext="http://www.aiim.org/pdfa/ns/extension/"><rdf:Bag><rdf:li rdf:parseType="Resource" xmlns:s="http://www.aiim.org/pdfa/ns/schema#"><s:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</s:namespaceURI><s:prefix>alias</s:prefix></rdf:li></rdf:Bag></ext:schemas>', 'xmlns:alias="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#" alias:DocumentFileName="old.xml"'],
    ['schema namespace element', '<s:namespaceURI xmlns:s="http://www.aiim.org/pdfa/ns/schema#">urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</s:namespaceURI>', ''],
    ['abbreviated schema namespace', '', 'xmlns:s="http://www.aiim.org/pdfa/ns/schema#" s:namespaceURI="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"'],
    ['schema prefix element', '<s:prefix xmlns:s="http://www.aiim.org/pdfa/ns/schema#">fx</s:prefix>', ''],
    ['abbreviated schema prefix', '', 'xmlns:s="http://www.aiim.org/pdfa/ns/schema#" s:prefix="fx"'],
    ['schema resource identity', '<s:namespaceURI xmlns:s="http://www.aiim.org/pdfa/ns/schema#" rdf:resource="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"/>', ''],
    ['non-simple schema identity', '<s:namespaceURI xmlns:s="http://www.aiim.org/pdfa/ns/schema#">urn:factur-x:<s:other>pdfa:</s:other>CrossIndustryDocument:invoice:1p0#</s:namespaceURI>', ''],
  ])('rejects preexisting/ambiguous %s before generating conflicting metadata', async (_name, properties, attributes) => {
    const xmp=XMP.replace('rdf:about=""',`rdf:about="" ${attributes}`).replace('</rdf:Description>',`${properties}</rdf:Description>`);
    const input=await fixture(undefined,xmp),before=hash(input);
    await expect(attachToEligiblePdf(input,XML)).rejects.toMatchObject({code:'PDF_UNSUPPORTED_METADATA'});
    expect(hash(input)).toBe(before);
  });
  it('permits an unused FX namespace declaration without inventing a collision',async()=>{
    const xmp=XMP.replace('rdf:about=""','rdf:about="" xmlns:unused="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"');
    await expect(attachToEligiblePdf(await fixture(undefined,xmp),XML)).resolves.toBeInstanceOf(Uint8Array);
  });
  it.each([
    ['signature',(d:PDFDocument)=>{d.catalog.set(PDFName.of('Perms'),d.context.obj({DocMDP:{Type:'Sig'}}));},'PDF_SIGNED'],
    ['orphan signature',(d:PDFDocument)=>{d.context.register(d.context.obj({Type:'Sig',ByteRange:[0,10,20,30]}));},'PDF_SIGNED'],
    ['form',(d:PDFDocument)=>{d.getForm().createTextField('synthetic');},'PDF_FORMS_UNSUPPORTED'],
    ['Names attachment',(d:PDFDocument)=>{d.catalog.set(PDFName.of('Names'),d.context.obj({EmbeddedFiles:{Kids:[]}}));},'PDF_ATTACHMENTS_UNSUPPORTED'],
    ['AF attachment',(d:PDFDocument)=>{d.catalog.set(PDFName.of('AF'),d.context.obj([]));},'PDF_ATTACHMENTS_UNSUPPORTED'],
    ['orphan attachment',(d:PDFDocument)=>{d.context.register(d.context.obj({Type:'EmbeddedFile'}));},'PDF_ATTACHMENTS_UNSUPPORTED'],
    ['active action',(d:PDFDocument)=>{d.catalog.set(PDFName.of('OpenAction'),d.context.obj({S:'JavaScript',JS:PDFString.of('not executed')}));},'PDF_ACTIVE_CONTENT_UNSUPPORTED'],
  ] as const)('rejects %s without deleting it',async(_name,change,code)=>{
    const input=await fixture(change),before=hash(input);
    await expect(attachToEligiblePdf(input,XML)).rejects.toMatchObject({code});expect(hash(input)).toBe(before);
  });
  it.each(['%PDF-invalid','%PDF-1.7\n%%EOF'])('rejects malformed input',async value=>{
    await expect(attachToEligiblePdf(new TextEncoder().encode(value),XML)).rejects.toBeInstanceOf(UnsupportedPdfError);
  });
  it.each(['<!DOCTYPE test [<!ENTITY ext SYSTEM "file:///never">]><x/>','<x:xmpmeta xmlns:x="adobe:ns:meta/">','<root/>'])('rejects incompatible XMP',async xmp=>{
    await expect(attachToEligiblePdf(await fixture(undefined,xmp),XML)).rejects.toMatchObject({code:'PDF_UNSUPPORTED_METADATA'});
  });
  it('rejects preexisting factur-x.xml instead of overwriting',async()=>{
    const input=await fixture(async doc=>{await doc.attach(new TextEncoder().encode('keep original'),'factur-x.xml');});
    await expect(attachToEligiblePdf(input,XML)).rejects.toMatchObject({code:'PDF_ATTACHMENTS_UNSUPPORTED'});
  });
});
describe('XML structural identity gate, not business-rule certification',()=>{
  it('accepts UTF-8 CII and declared EN16931 identity',()=>expect(()=>inspectInvoiceXml(XML)).not.toThrow());
  it('accepts only exact guideline character data, including an equivalent CDATA representation',()=>{
    expect(()=>inspectInvoiceXml(XML.replace('>urn:cen.eu:en16931:2017</ram:ID>','><![CDATA[urn:cen.eu:en16931:2017]]></ram:ID>'))).not.toThrow();
  });
  it.each([
    '<ram:Nested>other</ram:Nested>urn:cen.eu:en16931:2017',
    'urn:cen.eu:en16931:2017<ram:Nested>other</ram:Nested>',
    'urn:cen.eu:<ram:Nested>ignored</ram:Nested>en16931:2017',
    '<ram:Nested>urn:cen.eu:en16931:2017</ram:Nested>',
    ' urn:cen.eu:en16931:2017',
    'urn:cen.eu:en16931:2017 ',
    'urn:cen.eu:<!--not simple content-->en16931:2017',
    'urn:cen.eu:<?xml version="1.0"?>en16931:2017',
  ])('rejects nested, mixed or non-exact guideline ID content: %s',value=>{
    const xml=XML.replace('>urn:cen.eu:en16931:2017</ram:ID>',`>${value}</ram:ID>`);
    expect(()=>inspectInvoiceXml(xml)).toThrow(UnsupportedPdfError);
  });
  it.each([XML.replace('urn:cen.eu:en16931:2017','other'),'<root/>',XML.replace('UTF-8','UTF-16'),'<!DOCTYPE test [<!ENTITY ext SYSTEM "file:///never">]>'+XML,XML.replace('</ram:ID>','')])('rejects malformed/unsupported XML',xml=>{
    expect(()=>inspectInvoiceXml(xml)).toThrow(UnsupportedPdfError);
  });
});
