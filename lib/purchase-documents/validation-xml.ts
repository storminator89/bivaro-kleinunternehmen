import { parser, type SaxNode } from 'sax';
import { XRECHNUNG_PROFILE } from './validation-contract';

export const MAX_VALIDATION_XML_BYTES = 2 * 1024 * 1024;
const CII = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
const RAM = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
const UBL = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
export class ValidationXmlError extends Error {
  constructor(readonly code: string) { super(code); }
}
export type ValidationXmlIdentity = { format: 'CII' | 'UBL' | null; profile: string | null; supported: boolean };
/** Streaming gate only, NOT an XSD/Schematron substitute. SAX never resolves resources. */
export function inspectValidationXml(bytes: Uint8Array): ValidationXmlIdentity {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VALIDATION_XML_BYTES) throw new ValidationXmlError('XML_SIZE_LIMIT');
  let xml: string;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ValidationXmlError('XML_ENCODING'); }
  // Reject before parsing so even a parser upgrade cannot enable DTD/entity resolution.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new ValidationXmlError('XML_EXTERNAL_CONTENT');
  const encoding = xml.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding)) throw new ValidationXmlError('XML_ENCODING');
  let nodes = 0, roots = 0;
  const stack: SaxNode[] = [];
  let format: ValidationXmlIdentity['format'] = null;
  let profile: string | null = null;
  let profileText = '';
  let profileDepth = 0;
  let profileCount = 0;
  let typeCode: string | null = null, typeCount = 0, typeDepth = 0, typeText = '';
  const started = performance.now();
  const sax = parser(true, { xmlns: true });
  sax.onopentag = node => {
    if (++nodes > 20_000 || stack.length >= 64 || Object.keys(node.attributes).length > 64 || performance.now() - started > 1000) throw new ValidationXmlError('XML_RESOURCE_LIMIT');
    if (node.uri === 'http://www.w3.org/2001/XInclude') throw new ValidationXmlError('XML_EXTERNAL_CONTENT');
    // Pinned scenarios select the schemas. Even file-only JAXP access is not a
    // repository sandbox for foreign/lax namespaces; never consult input hints.
    if (Object.values(node.attributes).some(attribute => attribute.uri === 'http://www.w3.org/2001/XMLSchema-instance' && ['schemaLocation', 'noNamespaceSchemaLocation'].includes(attribute.local))) throw new ValidationXmlError('XML_SCHEMA_HINTS_UNSUPPORTED');
    if (stack.length === 0) {
      if (++roots !== 1) throw new ValidationXmlError('XML_SYNTAX');
      if (node.local === 'CrossIndustryInvoice' && node.uri === CII) format = 'CII';
      else if (node.local === 'Invoice' && node.uri === UBL) format = 'UBL';
    }
    const ublProfile = format === 'UBL' && stack.length === 1 && node.local === 'CustomizationID' && node.uri === CBC;
    const ciiProfile = format === 'CII' && stack.length === 3 && node.local === 'ID' && node.uri === RAM
      && stack[1].local === 'ExchangedDocumentContext' && stack[1].uri === CII
      && stack[2].local === 'GuidelineSpecifiedDocumentContextParameter' && stack[2].uri === RAM;
    if (ublProfile || ciiProfile) { profileCount++; profileDepth = stack.length + 1; profileText = ''; }
    const ublType = format === 'UBL' && stack.length === 1 && node.local === 'InvoiceTypeCode' && node.uri === CBC;
    const ciiType = format === 'CII' && stack.length === 2 && node.local === 'TypeCode' && node.uri === RAM && stack[1].local === 'ExchangedDocument' && stack[1].uri === CII;
    if (ublType || ciiType) { typeCount++; typeDepth = stack.length + 1; typeText = ''; }
    stack.push(node);
  };
  const text = (value: string) => {
    if (performance.now() - started > 1000) throw new ValidationXmlError('XML_RESOURCE_LIMIT');
    if (profileDepth && stack.length === profileDepth) {
      profileText += value;
      if (profileText.length > 512) throw new ValidationXmlError('XML_PROFILE_LIMIT');
    }
    if (typeDepth && stack.length === typeDepth) { typeText += value; if (typeText.length > 16) throw new ValidationXmlError('XML_PROFILE_LIMIT'); }
  };
  sax.ontext = text; sax.oncdata = text;
  sax.onclosetag = () => {
    if (performance.now() - started > 1000) throw new ValidationXmlError('XML_RESOURCE_LIMIT');
    if (profileDepth === stack.length) { profile = profileText.trim() || null; profileDepth = 0; }
    if (typeDepth === stack.length) { typeCode = typeText.trim() || null; typeDepth = 0; }
    stack.pop();
  };
  sax.ondoctype = () => { throw new ValidationXmlError('XML_EXTERNAL_CONTENT'); };
  sax.onprocessinginstruction = instruction => {
    if (instruction.name !== 'xml') throw new ValidationXmlError('XML_EXTERNAL_CONTENT');
  };
  sax.onerror = () => { throw new ValidationXmlError('XML_SYNTAX'); };
  try { sax.write(xml).close(); }
  catch (error) { if (error instanceof ValidationXmlError) throw error; throw new ValidationXmlError('XML_SYNTAX'); }
  if (roots !== 1 || stack.length !== 0 || profileCount > 1 || typeCount > 1) throw new ValidationXmlError('XML_SYNTAX');
  // A missing required type still reaches the official XSD/rules and fails there.
  // Known non-invoice document types are outside this deliberately narrow profile.
  return { format, profile, supported: format !== null && profile === XRECHNUNG_PROFILE && (typeCode === null || typeCode === '380') };
}
