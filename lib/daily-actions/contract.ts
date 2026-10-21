/** Browser-safe read model. Suggestions never authorize a financial operation. */
export type DailyActionKind = 'INVOICE_OVERDUE' | 'INVOICE_REVIEW' | 'INVOICE_DUE' | 'QUOTE_FOLLOW_UP' | 'QUOTE_READY' | 'QUOTE_RESPONSE' | 'RECEIPT_REVIEW';
export type DailyAction = {
  id: string;
  kind: DailyActionKind;
  priority: number;
  title: string;
  reason: string;
  source: string;
  party: string | null;
  date: string;
  dateLabel: string;
  amountCents: string | null;
  amountLabel: string;
  href: string;
  cta: string;
};
export type DailyActions = {
  businessDate: string;
  timeZone: 'Europe/Berlin';
  generatedAt: string;
  actions: DailyAction[];
  /** Count of matching actions within the explicitly bounded source selection. */
  actionCount: number;
  isPartial: boolean;
};
