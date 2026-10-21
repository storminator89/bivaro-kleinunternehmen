import type { InvoiceCalculationItem } from '@/lib/invoice-calculation';

export type ServiceBillingLine = InvoiceCalculationItem & {
  description: string;
  unit: string;
  taxRate: number;
  taxCategory?: 'S' | 'E' | 'Z';
  exemptionReason?: string;
};
export type ServiceBillingPlanDto = {
  id: string;
  stableKey: string;
  name: string;
  customerId: number;
  customer: { id: number; name: string };
  cadence: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  anchorDate: string;
  nextPeriod: number;
  status: 'ACTIVE' | 'PAUSED';
  revision: number;
  taxMode: 'small-business' | 'standard';
  items: ServiceBillingLine[];
  preview: { periodStart: string; periodEnd: string; nextDue: string };
  due: boolean;
  missed: boolean;
  periods: {
    periodIndex: number;
    periodStart: string;
    periodEnd: string;
    action: 'GENERATED' | 'SKIPPED';
    invoiceId: number | null;
    invoice?: { id: number; status: string; invoiceNumber: string | null; unrendered: boolean } | null;
  }[];
};
export type ServiceBillingList = { today: string; plans: ServiceBillingPlanDto[] };
export const CADENCE_LABELS = { MONTHLY: 'Monatlich', QUARTERLY: 'Vierteljährlich', YEARLY: 'Jährlich' } as const;
export const SERVICE_SELECT_CLASS = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';
export function serviceDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
export function serviceCurrency(value: number) { return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value); }
export async function serviceJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', ...init }); }
  catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error('Keine eindeutige Antwort erhalten. Deine Eingaben bleiben erhalten. Bitte mit derselben Anfrage erneut bestätigen oder den aktuellen Stand laden.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Die Anfrage konnte nicht abgeschlossen werden. Bitte den aktuellen Stand laden.');
  if (data === null) throw new Error('Die Antwort konnte nicht gelesen werden. Bitte den aktuellen Stand erneut laden; bereits gespeicherte Entwürfe werden nicht erneut angelegt.');
  return data as T;
}
