/** Technical evidence only. Never an expense approval or a legal certification. */
export const PURCHASE_VALIDATION_VERSION = 'incoming-xrechnung-v1';
export const PURCHASE_VALIDATOR_VERSION = 'kosit-1.6.3';
export const PURCHASE_RULES_VERSION = 'xrechnung-3.0.2-2026-08-31';
export const PURCHASE_VALIDATOR_SHA256 = '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9';
export const PURCHASE_RULES_SHA256 = '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8';
export const XRECHNUNG_PROFILE = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
export const VALIDATION_STATUSES = ['NOT_RUN', 'UNSUPPORTED', 'FAILED', 'WARNINGS', 'VALID'] as const;
export type PurchaseValidationStatus = typeof VALIDATION_STATUSES[number];
export type PurchaseValidationFinding = { ruleId: string; severity: 'error' | 'warning' | 'information'; field: string | null; message: string };
export type PurchaseTechnicalReport = {
  reportVersion: 1;
  originalSha256: string;
  checkerVersion: string;
  validatorVersion: string;
  rulesVersion: string;
  rulesSha256: string;
  checkedAt: string;
  status: PurchaseValidationStatus;
  reasonCode: string;
  format: 'CII' | 'UBL' | null;
  profile: string | null;
  checks: { xml: 'PASSED' | 'FAILED' | 'NOT_RUN'; xsd: 'PASSED' | 'FAILED' | 'NOT_RUN'; schematron: 'PASSED' | 'WARNINGS' | 'FAILED' | 'NOT_RUN' };
  findings: PurchaseValidationFinding[];
  findingsTruncated: boolean;
  /** Deliberately constant: technical validation must never approve accounting. */
  accountingApproval: 'NOT_PERFORMED';
};
export type PurchaseValidationRecord = {
  id: string;
  provenance: 'LOCAL' | 'IMPORTED_HISTORIC';
  report: PurchaseTechnicalReport;
  /** False for imported history, older checker/rules, or a different original. */
  current: boolean;
};
export type PurchaseValidationResponse = { reports: PurchaseValidationRecord[]; replayed?: boolean };
export function isCurrentPurchaseValidation(record: Pick<PurchaseValidationRecord, 'provenance' | 'report'>, hash: string): boolean {
  return record.provenance === 'LOCAL' && record.report.originalSha256 === hash
    && record.report.checkerVersion === PURCHASE_VALIDATION_VERSION
    && record.report.validatorVersion === PURCHASE_VALIDATOR_VERSION
    && record.report.rulesVersion === PURCHASE_RULES_VERSION && record.report.rulesSha256 === PURCHASE_RULES_SHA256;
}
export function purchaseValidationLabel(report: PurchaseTechnicalReport): string {
  return ({ NOT_RUN: 'Technisch nicht geprüft', UNSUPPORTED: 'Prüfung nicht unterstützt', FAILED: 'Technische Prüfung fehlgeschlagen', WARNINGS: 'Technisch geprüft · Hinweise', VALID: 'Technisch geprüft · unterstützte Regeln erfüllt' })[report.status];
}
