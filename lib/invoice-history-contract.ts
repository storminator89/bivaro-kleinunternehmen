/** Small public DTO: never expose raw audit payloads, file paths or bank data. */
export const HISTORY_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'CANCELLED', 'STATUS_CHANGED', 'PAYMENT_RECEIVED', 'IMPORT', 'EMAIL_SENT'] as const;
export type HistoryAction = typeof HISTORY_ACTIONS[number];
export type HistoryPagination = { page: number; pageSize: number; total: number; totalPages: number };
export type HistoryDocument = {
  id: number; invoiceNumber: string | null; type: string; status: string; issuanceState: string;
  invoiceDate: string | null; uploadedAt: string; totalAmount: number | null;
  currency: string | null; taxMode: 'small-business' | 'standard' | null;
  cancellationReason: string | null; originalInvoiceId: number | null;
};
export type HistoryChange = { field: string; label: string; before: string | null; after: string | null };
export type HistoryEvent = {
  id: number; documentId: number; action: HistoryAction; createdAt: string;
  actor: 'ACCOUNT_RECORDED' | 'UNKNOWN'; changes: HistoryChange[];
};
export type HistoryList = { kind: 'list'; documents: HistoryDocument[]; pagination: HistoryPagination };
export type HistoryDetail = {
  kind: 'detail'; selectedId: number; originalId: number; missingOriginal: boolean;
  documents: HistoryDocument[]; events: HistoryEvent[]; pagination: HistoryPagination;
  payments: { id: number; amountCents: string; currency: string; paidAt: string | null; dateCertainty: string; source: string }[];
  paymentCount: number;
};
export const HISTORY_STATUS: Record<string, string> = { DRAFT: 'Entwurf', SENT: 'Versendet', PAID: 'Bezahlt (Status)', CANCELLED: 'Storniert' };
export function historyStatusLabel(value: unknown): string | null {
  return typeof value === 'string' && Object.hasOwn(HISTORY_STATUS, value) ? HISTORY_STATUS[value] : null;
}
export function historyLifecycle(document: Pick<HistoryDocument, 'status' | 'issuanceState'>): string {
  if (document.status === 'CANCELLED') return 'Storniert';
  if (document.issuanceState === 'ISSUED') return 'Ausgestellt';
  if (document.issuanceState === 'UNISSUED') return 'Nicht ausgestellt';
  return 'Ausstellungsnachweis unbekannt';
}
