/** Browser-safe #54a contract. History is evidence, NEVER additive money rows. */
export const MANUAL_FINANCIAL_RECORD_CONTRACT_VERSION = 1 as const;
export type ManualFinancialRecordKind = 'income' | 'expense';
export type ManualFinancialRecordState = 'LEGACY_UNREVIEWED' | 'RECORDED' | 'FINALIZED';
export type ManualFinancialRecordOperation = 'FINALIZE' | 'CORRECT_AMOUNT';
export type ManualFinancialRecordOriginal = {
  status: 'NONE' | 'ARCHIVED' | 'UNVERIFIED';
  fileName: string | null;
  sha256: string | null;
  byteCount: number | null;
};
export type ManualFinancialRecordHistoryEntry = {
  id: string;
  sequence: number;
  operation: ManualFinancialRecordOperation;
  mutationId: string;
  amount: string;
  paymentDate: string;
  description: string;
  originalAmount: string;
  reason: string | null;
  createdAt: string;
  hash: string;
  previousHash: string | null;
};
export type ManualFinancialRecordDto = {
  contractVersion: typeof MANUAL_FINANCIAL_RECORD_CONTRACT_VERSION;
  kind: ManualFinancialRecordKind;
  id: number;
  recordId: string;
  state: ManualFinancialRecordState;
  origin: string;
  revision: number;
  fingerprint: string;
  description: string;
  paymentDate: string;
  effectiveAmount: string | null;
  currency: 'EUR';
  canFinalize: boolean;
  canCorrectAmount: boolean;
  readOnlyReason: string | null;
  requiresLegacyDeclaration: boolean;
  original: ManualFinancialRecordOriginal;
  history: ManualFinancialRecordHistoryEntry[];
};
export type ManualFinancialRecordMutation = {
  kind: ManualFinancialRecordKind;
  id: number;
  operation: ManualFinancialRecordOperation;
  expectedRevision: number;
  fingerprint: string;
  mutationId: string;
  legacyManualDeclaration?: true;
  amount?: string;
  reason?: string;
};
export type ManualFinancialRecordResponse = { record: ManualFinancialRecordDto; replayed: boolean };
