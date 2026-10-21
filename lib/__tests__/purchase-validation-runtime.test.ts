import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectValidationXml, MAX_VALIDATION_XML_BYTES } from '@/lib/purchase-documents/validation-xml';
import { validatePurchaseOriginal, verifyValidationAssets } from '@/lib/purchase-documents/validation-runtime';
import { technicalReportFingerprint, validateTechnicalReport } from '@/lib/purchase-documents/validation-evidence';
import { XRECHNUNG_PROFILE } from '@/lib/purchase-documents/validation-contract';

const fixture = (name: string) => readFile(path.join(import.meta.dirname, 'fixtures/incoming-validation', name));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const xml = (content: string) => Buffer.from(`<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:c="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><c:CustomizationID>${XRECHNUNG_PROFILE}</c:CustomizationID>${content}</Invoice>`);

describe('bounded technical XML gate, not conformity validation', () => {
  it('recognizes exact CII/UBL namespaces and supported profile without extracting accounting fields', async () => {
    expect(inspectValidationXml(await fixture('valid-cii.xml'))).toEqual({ format: 'CII', profile: XRECHNUNG_PROFILE, supported: true });
    expect(inspectValidationXml(await fixture('valid-ubl.xml'))).toEqual({ format: 'UBL', profile: XRECHNUNG_PROFILE, supported: true });
    expect(inspectValidationXml(Buffer.from('<Invoice><CustomizationID>urn:unknown</CustomizationID></Invoice>'))).toEqual({ format: null, profile: null, supported: false });
    const unrelated = Buffer.from((await fixture('valid-ubl.xml')).toString().replace('<Invoice ', '<Invoice xmlns:other="urn:synthetic:not-schema-instance" other:schemaLocation="file:///synthetic/ignored-name" '));
    expect(inspectValidationXml(unrelated).supported).toBe(true);
  });
  it('rejects DTD/entities, XInclude, stylesheets, invalid UTF-8, duplicate roots and malformed/deep/large inputs', () => {
    for (const bytes of [
      Buffer.from('<!DOCTYPE Invoice SYSTEM "http://127.0.0.1:9/never"><Invoice/>'),
      Buffer.from('<!DOCTYPE Invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]><Invoice>&x;</Invoice>'),
      xml('<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://example.test/never"/>'),
      Buffer.from('<?xml-stylesheet href="http://127.0.0.1:9/never"?><Invoice/>'),
      Buffer.from([60, 120, 62, 0xc0, 0xaf]), Buffer.from('<a/><b/>'), Buffer.from('<a>'),
      xml('<x>'.repeat(65) + '</x>'.repeat(65)), xml('<x/>'.repeat(20_001)), Buffer.alloc(MAX_VALIDATION_XML_BYTES + 1),
      xml(`<c:CustomizationID>${XRECHNUNG_PROFILE}</c:CustomizationID>`),
    ]) expect(() => inspectValidationXml(bytes)).toThrow();
  });
  it('never promotes extraction, unknown profiles, absent tools or original hash mismatches to VALID', async () => {
    const bytes = await fixture('valid-ubl.xml');
    const result = await validatePurchaseOriginal({ bytes, expectedSha256: hash(bytes), mediaType: 'application/xml' }, { assetsRoot: '/tmp/absent-bivaro-validator-assets', now: new Date('2026-10-21T00:00:00.000Z') });
    expect(result).toMatchObject({ status: 'NOT_RUN', reasonCode: 'VALIDATOR_RULES_UNAVAILABLE', checks: { xml: 'PASSED', xsd: 'NOT_RUN', schematron: 'NOT_RUN' }, accountingApproval: 'NOT_PERFORMED' });
    expect(validateTechnicalReport(result, hash(bytes))).toEqual(result);
    expect(technicalReportFingerprint({ ...result })).toBe(technicalReportFingerprint(result));
    expect((await validatePurchaseOriginal({ bytes, expectedSha256: 'a'.repeat(64), mediaType: 'application/xml' })).reasonCode).toBe('ORIGINAL_HASH_MISMATCH');
    expect((await validatePurchaseOriginal({ bytes, expectedSha256: hash(bytes), mediaType: 'application/pdf' })).status).toBe('UNSUPPORTED');
    const unknown = Buffer.from(bytes.toString().replace(XRECHNUNG_PROFILE, 'urn:unsupported:profile'));
    expect((await validatePurchaseOriginal({ bytes: unknown, expectedSha256: hash(unknown), mediaType: 'application/xml' })).status).toBe('UNSUPPORTED');
    const ciiCredit = Buffer.from((await fixture('valid-cii.xml')).toString().replace('<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>381</ram:TypeCode>'));
    expect((await validatePurchaseOriginal({ bytes: ciiCredit, expectedSha256: hash(ciiCredit), mediaType: 'application/xml' })).status).toBe('UNSUPPORTED');
  });
});

const assetsRoot = process.env.BIVARO_EINVOICE_TEST_ASSETS;
describe.skipIf(!assetsRoot)('official pinned offline KoSIT XSD + Schematron integration', () => {
  it('verifies the complete official rule tree and both derived scenario configurations', async () => { await expect(verifyValidationAssets(assetsRoot!)).resolves.toBeUndefined(); });
  for (const name of ['valid-cii.xml', 'valid-ubl.xml']) it(`validates synthetic ${name} with the real offline engine`, async () => {
    const bytes = await fixture(name);
    const result = await validatePurchaseOriginal({ bytes, expectedSha256: hash(bytes), mediaType: 'application/xml' }, { assetsRoot });
    expect(result).toMatchObject({ status: 'VALID', reasonCode: 'SUPPORTED_RULES_PASSED', checks: { xml: 'PASSED', xsd: 'PASSED', schematron: 'PASSED' }, accountingApproval: 'NOT_PERFORMED' });
    expect(validateTechnicalReport(result, hash(bytes))).toEqual(result);
  }, 35_000);
  it('rejects reachable remote schema hints before either CII/UBL engine can consult them', async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => { requests.push(request.url ?? ''); response.end('SYNTHETIC_CANARY'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture server');
      const endpoint = `http://127.0.0.1:${address.port}`;
      expect(await (await fetch(`${endpoint}/reachability-control`)).text()).toBe('SYNTHETIC_CANARY');
      expect(requests).toEqual(['/reachability-control']); requests.length = 0;
      for (const [name, namespace] of [
        ['valid-cii.xml', 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'],
        ['valid-ubl.xml', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'],
      ]) {
        const original = (await fixture(name)).toString();
        const bytes = Buffer.from(original.replace(/<(rsm:CrossIndustryInvoice|Invoice) /, `<$1 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${namespace} ${endpoint}/external.xsd" xsi:noNamespaceSchemaLocation="${endpoint}/no-namespace.xsd" `));
        expect(bytes.toString()).not.toBe(original);
        expect(() => inspectValidationXml(bytes)).toThrow('XML_SCHEMA_HINTS_UNSUPPORTED');
        const result = await validatePurchaseOriginal({ bytes, expectedSha256: hash(bytes), mediaType: 'application/xml' }, { assetsRoot });
        expect(result).toMatchObject({ status: 'UNSUPPORTED', reasonCode: 'XML_SCHEMA_HINTS_UNSUPPORTED', originalSha256: hash(bytes), checks: { xml: 'NOT_RUN', xsd: 'NOT_RUN', schematron: 'NOT_RUN' } });
        expect(requests).toEqual([]);
      }
      const foreign = Buffer.from((await fixture('valid-ubl.xml')).toString().replace('<cbc:CustomizationID>', `<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionContent><foreign:probe xmlns:foreign="urn:synthetic:foreign" xmlns:hint="http://www.w3.org/2001/XMLSchema-instance" hint:schemaLocation="urn:synthetic:foreign ${endpoint}/foreign-lax.xsd"/></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:CustomizationID>`));
      expect(await validatePurchaseOriginal({ bytes: foreign, expectedSha256: hash(foreign), mediaType: 'application/xml' }, { assetsRoot })).toMatchObject({ status: 'UNSUPPORTED', reasonCode: 'XML_SCHEMA_HINTS_UNSUPPORTED', findings: [] });
      expect(requests).toEqual([]);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, 70_000);
  it('rejects wrong sums and a required missing field through official rules, not heuristics', async () => {
    const original = (await fixture('valid-ubl.xml')).toString();
    for (const changed of [original.replace('<cbc:TaxInclusiveAmount currencyID="EUR">119.00', '<cbc:TaxInclusiveAmount currencyID="EUR">129.00'), original.replace(/<cbc:BuyerReference>[^<]+<\/cbc:BuyerReference>/, ''), original.replace('<cbc:ID>SYNTHETIC-UBL-001</cbc:ID>', '')]) {
      const bytes = Buffer.from(changed);
      const result = await validatePurchaseOriginal({ bytes, expectedSha256: hash(bytes), mediaType: 'application/xml' }, { assetsRoot });
      expect(result.status).toBe('FAILED'); expect(result.findings.some(item => item.severity === 'error')).toBe(true);
      expect(validateTechnicalReport(result, hash(bytes))).toEqual(result);
    }
  }, 70_000);
  it('keeps accepted informational guidance visibly distinct from an unqualified technical pass', async () => {
    const bytes = Buffer.from((await fixture('valid-ubl.xml')).toString().replace(/<cac:Delivery>[\s\S]*?<\/cac:Delivery>/, ''));
    const result = await validatePurchaseOriginal({ bytes, expectedSha256: hash(bytes), mediaType: 'application/xml' }, { assetsRoot });
    expect(result.status).toBe('WARNINGS'); expect(result.findings.some(item => item.severity === 'information')).toBe(true);
  }, 35_000);
});
