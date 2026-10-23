import { formatMoneyEUR } from '@/lib/money';

/** Display exact cents with two places; never round through a JS number. */
export function formatTimelineMoney(value: string | null): string | null {
  if (value === null || !/^[0-9]{1,16}$/u.test(value)) return null;
  const [whole, fraction = ''] = formatMoneyEUR(BigInt(value)).split('.');
  return `${whole},${fraction.padEnd(2, '0')} €`;
}

export type TimelineEntry = {
  key: string;
  kind: 'DOCUMENT' | 'PAYMENT' | 'ADJUSTMENT' | 'ALLOCATION';
  attribution?: { originInvoiceId: number; allocatedInvoiceId: number; fromInvoiceId?: number; toInvoiceId?: number; cancellationInvoiceId?: number | null };
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
