import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readOfficialValidationReport } from '@/lib/purchase-documents/validation-report-parser';
import { validatePurchaseOriginal } from '@/lib/purchase-documents/validation-runtime';

const hash = 'a'.repeat(64);
const message = (level = 'warning', id = 'SYNTHETIC-RULE') => `<r:message code="${id}" level="${level}" xpathLocation="/Invoice/Total">Synthetic explanation</r:message>`;
function report(options: { valid?: boolean; messages?: string; steps?: string; engine?: string; originalHash?: string } = {}) {
  return Buffer.from(`<r:report xmlns:r="http://www.xoev.de/de/validator/varl/1" valid="${options.valid ?? true}"><r:engine><r:name>${options.engine ?? 'KoSIT Validator 1.6.3'}</r:name></r:engine><r:documentIdentification><r:documentHash><r:hashValue>${Buffer.from(options.originalHash ?? hash, 'hex').toString('base64')}</r:hashValue></r:documentHash></r:documentIdentification>${options.steps ?? ['val-xml', 'val-xsd', 'val-sch.1', 'val-sch.2'].map(id => `<r:validationStepResult id="${id}" valid="true"/>`).join('')}${options.messages ?? ''}</r:report>`);
}
describe('official report normalization, safe failure and no remote entity resolution', () => {
  it('keeps accepted, hint-bearing and rejected reports visibly different', () => {
    expect(readOfficialValidationReport(report(), hash).status).toBe('VALID');
    expect(readOfficialValidationReport(report({ messages: message() }), hash).status).toBe('WARNINGS');
    expect(readOfficialValidationReport(report({ messages: message('information') }), hash).status).toBe('WARNINGS');
    expect(readOfficialValidationReport(report({ valid: false, messages: message('error') }), hash).status).toBe('FAILED');
  });
  it('rejects absent checks, changed engine, foreign original and malformed/untrusted report data', () => {
    for (const bytes of [report({ steps: '' }), report({ engine: 'KoSIT Validator 1.6.2' }), report({ originalHash: 'b'.repeat(64) }), Buffer.from('<broken>'), report({ messages: message('future-severity') })]) expect(() => readOfficialValidationReport(bytes, hash)).toThrow();
  });
  it('recognizes an official XML parsing failure without inventing later validation steps', () => {
    const steps = '<r:validationStepResult id="val-xml" valid="false"/>';
    const parsed = readOfficialValidationReport(report({ valid: false, steps, messages: message('error', 'generic-error') }), hash);
    expect(parsed).toMatchObject({ status: 'FAILED', checks: { xml: 'FAILED', xsd: 'NOT_RUN', schematron: 'NOT_RUN' } });
    expect(parsed.findings).toEqual([expect.objectContaining({ ruleId: 'generic-error', severity: 'error' })]);
    expect(() => readOfficialValidationReport(report({ valid: false, steps }), hash)).toThrow('REPORT_INCOMPLETE');
    expect(() => readOfficialValidationReport(report({ valid: true, steps, messages: message('error') }), hash)).toThrow('REPORT_INCOMPLETE');
    expect(() => readOfficialValidationReport(report({ valid: false, steps: `${steps}<r:validationStepResult id="val-xsd" valid="true"/>`, messages: message('error') }), hash)).toThrow('REPORT_INCOMPLETE');
  });
  it('retains bounded findings without losing a blocking error after the display cap', () => {
    const parsed = readOfficialValidationReport(report({ valid: false, messages: message().repeat(256) + message('error', 'FINAL-BLOCKING-ERROR') }), hash);
    expect(parsed.status).toBe('FAILED'); expect(parsed.findings).toHaveLength(256); expect(parsed.findingsTruncated).toBe(true);
  });
  it('never contacts an external XML entity endpoint, even when it is reachable', async () => {
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('MUST_NOT_BE_READ'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture server');
      const bytes = Buffer.from(`<!DOCTYPE Invoice [<!ENTITY remote SYSTEM "http://127.0.0.1:${address.port}/invoice">]><Invoice>&remote;</Invoice>`);
      const result = await validatePurchaseOriginal({ bytes, expectedSha256: createHash('sha256').update(bytes).digest('hex'), mediaType: 'application/xml' });
      expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'XML_EXTERNAL_CONTENT' }); expect(requests).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
