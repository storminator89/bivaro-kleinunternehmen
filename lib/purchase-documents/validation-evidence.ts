import { createHash } from 'node:crypto';
import { VALIDATION_STATUSES, XRECHNUNG_PROFILE, type PurchaseTechnicalReport } from './validation-contract';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger technischer Prüfbericht.');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unbekannte Felder im technischen Prüfbericht.');
}
function boundedText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
export function validationRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Prüfschlüssel muss eine kleingeschriebene UUID sein.');
  return value;
}
/** Closed portable v1 contract. Imported evidence never grants current validity. */
export function validateTechnicalReport(value: unknown, expectedHash: string): PurchaseTechnicalReport {
  const report = record(value);
  exactKeys(report, ['reportVersion', 'originalSha256', 'checkerVersion', 'validatorVersion', 'rulesVersion', 'rulesSha256', 'checkedAt', 'status', 'reasonCode', 'format', 'profile', 'checks', 'findings', 'findingsTruncated', 'accountingApproval']);
  if (report.reportVersion !== 1 || !HASH.test(expectedHash) || report.originalSha256 !== expectedHash || report.accountingApproval !== 'NOT_PERFORMED') throw new Error('Prüfbericht ist nicht an das Original gebunden.');
  if (!['checkerVersion', 'validatorVersion', 'rulesVersion', 'reasonCode'].every(key => boundedText(report[key], 128) && /^[A-Za-z0-9_.-]+$/.test(report[key] as string))
    || typeof report.rulesSha256 !== 'string' || !HASH.test(report.rulesSha256)
    || typeof report.checkedAt !== 'string' || !Number.isFinite(Date.parse(report.checkedAt)) || new Date(report.checkedAt).toISOString() !== report.checkedAt
    || !VALIDATION_STATUSES.includes(report.status as typeof VALIDATION_STATUSES[number])
    || ![null, 'CII', 'UBL'].includes(report.format as null | string)
    || !(report.profile === null || boundedText(report.profile, 512)) || typeof report.findingsTruncated !== 'boolean') throw new Error('Prüfbericht enthält ungültige Metadaten.');
  const checks = record(report.checks);
  exactKeys(checks, ['xml', 'xsd', 'schematron']);
  if (!['PASSED', 'FAILED', 'NOT_RUN'].includes(String(checks.xml)) || !['PASSED', 'FAILED', 'NOT_RUN'].includes(String(checks.xsd)) || !['PASSED', 'WARNINGS', 'FAILED', 'NOT_RUN'].includes(String(checks.schematron))) throw new Error('Prüfschritte sind ungültig.');
  if (!Array.isArray(report.findings) || report.findings.length > 256) throw new Error('Zu viele Prüfhinweise.');
  for (const item of report.findings) {
    const finding = record(item);
    exactKeys(finding, ['ruleId', 'severity', 'field', 'message']);
    if (!boundedText(finding.ruleId, 128) || !['error', 'warning', 'information'].includes(String(finding.severity)) || !(finding.field === null || boundedText(finding.field, 1200)) || !boundedText(finding.message, 2000)) throw new Error('Ungültiger Prüfhinweis.');
  }
  if (report.status === 'VALID' || report.status === 'WARNINGS') {
    if (report.profile !== XRECHNUNG_PROFILE || !['CII', 'UBL'].includes(String(report.format)) || checks.xml !== 'PASSED' || checks.xsd !== 'PASSED' || !['PASSED', 'WARNINGS'].includes(String(checks.schematron))
      || report.findings.some(item => record(item).severity === 'error') || (report.status === 'VALID' && (checks.schematron !== 'PASSED' || report.findings.length !== 0 || report.findingsTruncated))) throw new Error('Positives Prüfergebnis ist unvollständig.');
  }
  return report as unknown as PurchaseTechnicalReport;
}
/** Stable semantic identity excludes tenant remapping and imported-history flags. */
export function technicalReportFingerprint(report: PurchaseTechnicalReport): string {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
    return JSON.stringify(value);
  }
  return createHash('sha256').update(canonical(report)).digest('hex');
}
