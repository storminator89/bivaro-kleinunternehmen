export type TimelineEntry = {
  key: string;
  kind: 'DOCUMENT' | 'PAYMENT' | 'ADJUSTMENT';
  recordedAt: string;
  document: { id: number; type: string; number: string | null; status: string; href: string; convertedInvoice?: { id: number; number: string | null; href: string } };
  businessDate: string | null;
  dateCertainty: string | null;
  statusLabel: string;
  balance: { state: 'KNOWN' | 'REVIEW' | 'NOT_APPLICABLE'; openCents: string | null };
  amountCents: string | null;
};

export type CustomerTimelinePage = {
  customer: { id: number; name: string };
  entries: TimelineEntry[];
  nextCursor: string | null;
};
