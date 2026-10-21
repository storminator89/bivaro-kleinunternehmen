/** Browser-safe, bounded AI evidence. This data never authorizes a posting. */
export const AI_RECEIPT_SCHEMA_VERSION = 1 as const;
export const AI_RECEIPT_MAX_JOBS = 16;
export const AI_RECEIPT_MAX_LINES = 30;
export type AiReceiptResult = {
  schemaVersion: 1; provenance: 'AI_UNREVIEWED';
  supplierName: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  currency: string | null; documentType: 'INVOICE' | 'CREDIT_NOTE' | 'UNKNOWN';
  grossAmount: string | null; netAmount: string | null; taxAmount: string | null;
  lineItemsComplete: boolean | null;
  lineItems: Array<{ description: string | null; quantity: string | null; unitPrice: string | null; amount: string | null; taxRate: string | null }>;
  warnings: Array<{ code: string; message: string }>;
};
export type AiExtractionJob = {
  id: string; configVersion: number; configRevision: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
  sourceSha256: string; sourceRevision: number; createdAt: string; deadlineAt: string;
  finishedAt: string | null; errorCode: string | null; result: AiReceiptResult | null; draftApplied: boolean;
};
export type AiExtractionState = { version: 1; jobs: AiExtractionJob[] };
export type AiDraftProvenance = { version: 1; provenance: 'AI_UNREVIEWED' | 'AI_USER_EDITED'; jobId: string; configVersion: number; configRevision: string; originalSha256: string; appliedAt: string; fields: string[] };
