import { parser } from 'sax';
import type { PurchaseTechnicalReport, PurchaseValidationFinding } from './validation-contract';

const REP = 'http://www.xoev.de/de/validator/varl/1';
export const MAX_VALIDATION_REPORT_BYTES = 2 * 1024 * 1024;
/** Extract a bounded plain-data report. Never render KoSIT's embedded HTML. */
export function readOfficialValidationReport(bytes: Uint8Array, expectedHash: string): Pick<PurchaseTechnicalReport, 'status' | 'checks' | 'findings' | 'findingsTruncated'> {
  if (!bytes.byteLength || bytes.byteLength > MAX_VALIDATION_REPORT_BYTES) throw new Error('REPORT_LIMIT');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('REPORT_XML');
  const sax = parser(true, { xmlns: true });
  let depth = 0, nodes = 0;
  let valid: boolean | null = null;
  const steps = new Map<string, boolean>();
  const findings: PurchaseValidationFinding[] = [];
  let finding: PurchaseValidationFinding | null = null;
  let messageDepth = 0, hashDepth = 0, hash = '', engineDepth = 0, engine = '';
  let truncated = false;
  let hasError = false, hasHints = false;
  sax.onopentag = node => {
    if (++depth > 128 || ++nodes > 50_000) throw new Error('REPORT_LIMIT');
    const attr = (key: string) => node.attributes[key]?.value;
    if (depth === 1) {
      if (node.uri !== REP || node.local !== 'report' || !['true', 'false'].includes(attr('valid'))) throw new Error('REPORT_ROOT');
      valid = attr('valid') === 'true';
    }
    if (node.uri !== REP) return;
    if (node.local === 'validationStepResult') {
      const id = attr('id');
      if (['val-xml', 'val-xsd', 'val-sch.1', 'val-sch.2'].includes(id)) {
        if (steps.has(id) || !['true', 'false'].includes(attr('valid'))) throw new Error('REPORT_STEPS');
        steps.set(id, attr('valid') === 'true');
      }
    }
    if (node.local === 'hashValue') { if (hashDepth || hash) throw new Error('REPORT_HASH'); hashDepth = depth; }
    if (node.local === 'name' && depth === 3) engineDepth = depth;
    if (node.local === 'message') {
      if (finding) throw new Error('REPORT_MESSAGE');
      const level = attr('level');
      if (!['error', 'warning', 'information'].includes(level)) throw new Error('REPORT_SEVERITY');
      if (level === 'error') hasError = true; else hasHints = true;
      const line = attr('lineNumber'), column = attr('columnNumber');
      const field = attr('xpathLocation') || (line && /^\d{1,8}$/.test(line) ? `XML-Zeile ${line}${column && /^\d{1,8}$/.test(column) ? `, Spalte ${column}` : ''}` : null);
      finding = { ruleId: (attr('code') || attr('id') || 'TECHNICAL_RULE').slice(0, 128), severity: level as PurchaseValidationFinding['severity'], field: field?.slice(0, 1200) || null, message: '' };
      messageDepth = depth;
    }
  };
  const text = (value: string) => {
    if (hashDepth) { hash += value; if (hash.length > 128) throw new Error('REPORT_HASH'); }
    if (engineDepth) { engine += value; if (engine.length > 128) throw new Error('REPORT_ENGINE'); }
    if (finding && finding.message.length < 2000) finding.message += value.slice(0, 2000 - finding.message.length);
  };
  sax.ontext = text; sax.oncdata = text;
  sax.onclosetag = () => {
    if (depth === hashDepth) hashDepth = 0;
    if (depth === engineDepth) engineDepth = 0;
    if (depth === messageDepth && finding) {
      finding.message = finding.message.replace(/\s+/g, ' ').trim();
      if (findings.length < 256) findings.push(finding); else truncated = true;
      finding = null; messageDepth = 0;
    }
    depth--;
  };
  sax.ondoctype = () => { throw new Error('REPORT_XML'); };
  sax.onerror = () => { throw new Error('REPORT_XML'); };
  sax.write(xml).close();
  if (valid === null || engine !== 'KoSIT Validator 1.6.3' || hash.trim() !== Buffer.from(expectedHash, 'hex').toString('base64') || !steps.has('val-xml') || !steps.has('val-xsd')) throw new Error('REPORT_INCOMPLETE');
  // KoSIT intentionally does not execute Schematron after an XSD failure.
  // That is a demonstrated schema rejection, not an unavailable validator.
  if (!valid && steps.get('val-xml') && steps.get('val-xsd') === false && hasError) return { status: 'FAILED', checks: { xml: 'PASSED', xsd: 'FAILED', schematron: 'NOT_RUN' }, findings, findingsTruncated: truncated };
  if (steps.size !== 4) throw new Error('REPORT_INCOMPLETE');
  const schematronPassed = steps.get('val-sch.1') && steps.get('val-sch.2');
  if (!schematronPassed && valid && !hasHints && !hasError) throw new Error('REPORT_INCOMPLETE');
  const checks: PurchaseTechnicalReport['checks'] = { xml: steps.get('val-xml') ? 'PASSED' : 'FAILED', xsd: steps.get('val-xsd') ? 'PASSED' : 'FAILED', schematron: hasError || !valid ? 'FAILED' : schematronPassed ? 'PASSED' : 'WARNINGS' };
  // Never promote an inconsistent/partial engine result or truncated errors.
  const failed = !valid || Object.values(checks).includes('FAILED') || hasError;
  return { status: failed ? 'FAILED' : truncated || hasHints ? 'WARNINGS' : 'VALID', checks, findings, findingsTruncated: truncated };
}
