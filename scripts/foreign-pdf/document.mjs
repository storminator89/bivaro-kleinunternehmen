/** Narrow attachment-only derivation. Never a PDF interpreter/normalizer.
 * Invoked in production only by the independently confined process worker.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument, PDFDict, PDFArray, PDFName, PDFRawStream, PDFStream, AFRelationship, decodePDFRawStream } = require('pdf-lib');
const sax = require('sax');
const MAX_METADATA = 1024 * 1024;
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XMP = 'http://ns.adobe.com/xap/1.0/';
const FX = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';
const EXT = 'http://www.aiim.org/pdfa/ns/extension/';
const SCHEMA = 'http://www.aiim.org/pdfa/ns/schema#';
export class UnsupportedPdfError extends Error {
  constructor(code = 'PDF_UNSUPPORTED_STRUCTURE') { super(code); this.code = code; }
}
/** @returns {never} */
const unsupported = code => { throw new UnsupportedPdfError(code); };
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function parseXmp(xml) {
  if (!xml || Buffer.byteLength(xml) > MAX_METADATA || /<!DOCTYPE|<!ENTITY/i.test(xml)) unsupported('PDF_UNSUPPORTED_METADATA');
  const roots = [], stack = []; let count = 0;
  const parser = sax.parser(true, { xmlns: true, trim: false, normalize: false });
  parser.ondoctype = () => unsupported('PDF_UNSUPPORTED_METADATA');
  parser.onprocessinginstruction = p => { if (!['xpacket','xml'].includes(p.name)) unsupported('PDF_UNSUPPORTED_METADATA'); };
  parser.onopentag = tag => {
    if (++count > 10000 || stack.length > 64 || Object.keys(tag.attributes).length > 64) unsupported('PDF_UNSUPPORTED_METADATA');
    const node = { name: tag.name, local: tag.local, uri: tag.uri, attrs: Object.values(tag.attributes).map(a => ({name:a.name, value:a.value, uri:a.uri, local:a.local})), children: [] };
    (stack.length ? stack[stack.length-1].children : roots).push(node); stack.push(node);
  };
  const text = value => { if (stack.length) stack[stack.length-1].children.push(value); else if (value.trim()) unsupported('PDF_UNSUPPORTED_METADATA'); };
  parser.ontext = text; parser.oncdata = text;
  parser.onclosetag = () => stack.pop();
  try { parser.write(xml).close(); } catch { unsupported('PDF_UNSUPPORTED_METADATA'); }
  if (roots.length !== 1) unsupported('PDF_UNSUPPORTED_METADATA');
  return roots[0];
}
function nodes(root) { const result = [], pending = [root]; while (pending.length) { const n = pending.pop(); if(typeof n !== 'string') {result.push(n); pending.push(...n.children);} } return result; }
function serialize(node) {
  if (typeof node === 'string') return escape(node);
  return `<${node.name}${node.attrs.map(a => ` ${a.name}="${escape(a.value)}"`).join('')}>${node.children.map(serialize).join('')}</${node.name}>`;
}
function mergeMetadata(xml, now) {
  const root = parseXmp(xml), all = nodes(root);
  const rdf = all.filter(n => n.uri === RDF && n.local === 'RDF');
  if (rdf.length !== 1 || all.some(n => n.uri === FX || n.attrs.some(a => a.uri === FX))) unsupported('PDF_UNSUPPORTED_METADATA');
  // RDF permits abbreviated property attributes as well as element values.
  // Never add a second definition of the FX namespace (even under an alias),
  // or reuse an existing extension schema's declared fx prefix. Ambiguous
  // non-scalar schema identities cannot be merged safely either.
  const collides = (local, value) => (local === 'namespaceURI' && value.trim() === FX) || (local === 'prefix' && value.trim() === 'fx');
  for (const n of all) {
    if (n.attrs.some(a => a.uri === SCHEMA && collides(a.local, a.value))) unsupported('PDF_UNSUPPORTED_METADATA');
    if (n.uri === SCHEMA && ['namespaceURI','prefix'].includes(n.local)) {
      if (n.children.some(child => typeof child !== 'string') || n.attrs.some(a => a.uri === RDF)) unsupported('PDF_UNSUPPORTED_METADATA');
      if (collides(n.local, n.children.join(''))) unsupported('PDF_UNSUPPORTED_METADATA');
    }
  }
  const schemas = all.filter(n => n.uri === EXT && n.local === 'schemas');
  if (schemas.length > 1) unsupported('PDF_UNSUPPORTED_METADATA');
  for (const n of all) {
    if (n.uri === XMP && ['ModifyDate','MetadataDate'].includes(n.local)) n.children = [now.toISOString()];
    for (const a of n.attrs) {
      if(a.uri === XMP && ['ModifyDate','MetadataDate'].includes(a.local)) a.value = now.toISOString();
    }
  }
  const hasXmpProperty = name => all.some(n => (n.uri === XMP && n.local === name) || n.attrs.some(a => a.uri === XMP && a.local === name));
  const extra = parseXmp(`<rdf:Description xmlns:rdf="${RDF}" rdf:about="" xmlns:fx="${FX}" xmlns:xmp="${XMP}" xmlns:pdfaExtension="${EXT}" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
${['ModifyDate','MetadataDate'].filter(name => !hasXmpProperty(name)).map(name => `<xmp:${name}>${now.toISOString()}</xmp:${name}>`).join('')}<fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>${FX}</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${[
['DocumentType','Document type'],['DocumentFileName','Name of the embedded XML invoice file'],['Version','Factur-X version'],['ConformanceLevel','Factur-X conformance level'],
].map(([name,description]) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`).join('')}</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>`);
  if (schemas.length) {
    const bags = schemas[0].children.filter(n => typeof n !== 'string' && n.uri === RDF && n.local === 'Bag');
    if(bags.length !== 1 || schemas[0].children.some(n => typeof n === 'string' ? n.trim() : n !== bags[0])) unsupported('PDF_UNSUPPORTED_METADATA');
    const addedSchemas = extra.children.find(n => typeof n !== 'string' && n.uri === EXT && n.local === 'schemas');
    const addedBag = addedSchemas.children.find(n => typeof n !== 'string' && n.uri === RDF && n.local === 'Bag');
    // Self-contained namespace declarations also keep this valid if the source
    // binds the same lexical prefixes to unrelated namespaces elsewhere.
    const li = addedBag.children.find(n => typeof n !== 'string');
    li.attrs.push(...extra.attrs.filter(a => a.name.startsWith('xmlns:')));
    bags[0].children.push(li);
    extra.children = extra.children.filter(n => n !== addedSchemas);
  }
  rdf[0].children.push(extra);
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${serialize(root)}\n<?xpacket end="w"?>`;
}
function inspect(doc) {
  if (doc.isEncrypted || doc.context.trailerInfo.Encrypt) unsupported('PDF_ENCRYPTED');
  const forbidden = new Map([
    ...['ByteRange','Perms','SigFlags'].map(n => [n,'PDF_SIGNED']),
    ...['AcroForm','XFA'].map(n => [n,'PDF_FORMS_UNSUPPORTED']),
    ...['EmbeddedFiles','AF','EF','AFRelationship'].map(n => [n,'PDF_ATTACHMENTS_UNSUPPORTED']),
    ...['JS','JavaScript','AA','OpenAction','RichMedia'].map(n => [n,'PDF_ACTIVE_CONTENT_UNSUPPORTED']),
  ]);
  const pending = doc.context.enumerateIndirectObjects().map(([,o]) => o), seen = new Set(); let total = 0;
  while (pending.length) {
    const obj = pending.pop(); if (!obj || seen.has(obj)) continue; seen.add(obj);
    if(++total > 100000) unsupported('PDF_UNSUPPORTED_STRUCTURE');
    if (obj instanceof PDFStream) { pending.push(obj.dict); continue; }
    if (obj instanceof PDFArray) { pending.push(...obj.asArray()); continue; }
    if (!(obj instanceof PDFDict)) continue;
    for (const [key,value] of obj.entries()) {
      const name = key.decodeText(); if(forbidden.has(name)) unsupported(forbidden.get(name));
      if (value instanceof PDFName && ['Sig','DocTimeStamp'].includes(value.decodeText())) unsupported('PDF_SIGNED');
      if (value instanceof PDFName && ['Filespec','EmbeddedFile','FileAttachment'].includes(value.decodeText())) unsupported('PDF_ATTACHMENTS_UNSUPPORTED');
      pending.push(value);
    }
  }
}
/** Returns only a candidate: source AND candidate still require independent
 * veraPDF-3b checks by the caller; XML profile checks are a separate concern.
 * @returns {Promise<Uint8Array>} */
export async function attachToEligiblePdf(bytes, xml, now = new Date()) {
  inspectInvoiceXml(xml);
  let diagnostic = false;
  const saved = { warn:console.warn, error:console.error };
  console.warn = console.error = () => { diagnostic = true; };
  try {
    let doc;
    try { doc = await PDFDocument.load(bytes, {ignoreEncryption:false, updateMetadata:false, throwOnInvalidObject:true}); }
    catch { unsupported('PDF_INVALID_OR_ENCRYPTED'); }
    inspect(doc);
    if (!doc.getPageCount()) unsupported('PDF_UNSUPPORTED_STRUCTURE');
    const metadata = doc.catalog.lookupMaybe(PDFName.of('Metadata'), PDFRawStream);
    if (!metadata) unsupported('PDF_REQUIRES_NORMALIZATION');
    let decoded;
    try { decoded = decodePDFRawStream(metadata).decode(); } catch { unsupported('PDF_UNSUPPORTED_METADATA'); }
    if (decoded.length > MAX_METADATA) unsupported('PDF_UNSUPPORTED_METADATA');
    let xmp;
    try { xmp = new TextDecoder('utf-8',{fatal:true}).decode(decoded); } catch { unsupported('PDF_UNSUPPORTED_METADATA'); }
    const merged = mergeMetadata(xmp, now);
    // Never replace, remove or reinterpret the original color profiles.
    await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', {mimeType:'text/xml', description:'Factur-X/ZUGFeRD invoice XML', creationDate:now, modificationDate:now, afRelationship:AFRelationship.Alternative});
    doc.setModificationDate(now);
    const stream = doc.context.stream(new TextEncoder().encode(merged), {Type:'Metadata',Subtype:'XML'});
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    const result = await doc.save({updateFieldAppearances:false});
    if (diagnostic) unsupported('PDF_INVALID_STRUCTURE');
    return result;
  } catch (error) {
    if (error instanceof UnsupportedPdfError) throw error;
    unsupported('PDF_INVALID_STRUCTURE');
  } finally { console.warn=saved.warn; console.error=saved.error; }
}

/** Syntax/profile-identity gate only; not an EN16931 business-rule certificate. */
export function inspectInvoiceXml(xml) {
  if (!xml || Buffer.byteLength(xml) > 8*1024*1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) unsupported('PDF_XML_INVALID');
  const encoding = xml.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding)) unsupported('PDF_XML_INVALID');
  const parser=sax.parser(true,{xmlns:true}); const stack=[]; let nodes=0,root=false,profileCount=0,profileDepth=0,profile='';
  const CII='urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',RAM='urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
  parser.ondoctype=()=>unsupported('PDF_XML_INVALID');
  parser.onprocessinginstruction=p=>{if(p.name!=='xml'||profileDepth)unsupported('PDF_XML_INVALID');};
  parser.oncomment=()=>{if(profileDepth)unsupported('PDF_XML_INVALID');};
  parser.onopentag=n=>{
    // The guideline ID must be simple text/CDATA. Ignoring descendant text
    // would accept an identity that differs from the actual XML string value.
    if(profileDepth)unsupported('PDF_XML_INVALID');
    if(++nodes>100000||stack.length>=64||Object.keys(n.attributes).length>64)unsupported('PDF_XML_INVALID');
    if(!stack.length){if(root||n.local!=='CrossIndustryInvoice'||n.uri!==CII)unsupported('PDF_XML_INVALID');root=true;}
    if(n.local==='ID'&&n.uri===RAM&&stack.length===3&&stack[1].local==='ExchangedDocumentContext'&&stack[1].uri===CII&&stack[2].local==='GuidelineSpecifiedDocumentContextParameter'&&stack[2].uri===RAM){profileCount++;profileDepth=stack.length+1;}
    if(n.uri==='http://www.w3.org/2001/XInclude')unsupported('PDF_XML_INVALID');
    stack.push(n);
  };
  parser.ontext=parser.oncdata=t=>{if(profileDepth&&stack.length===profileDepth){profile+=t;if(profile.length>512)unsupported('PDF_XML_INVALID');}};
  parser.onclosetag=()=>{if(profileDepth===stack.length)profileDepth=0;stack.pop();};
  try{parser.write(xml).close();}catch{unsupported('PDF_XML_INVALID');}
  if(!root||profileCount!==1||profile!=='urn:cen.eu:en16931:2017')unsupported('PDF_XML_INVALID');
}
