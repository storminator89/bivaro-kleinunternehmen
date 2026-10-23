import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { DashboardIcon } from '@/components/brand/dashboard-icon';
import { formatCurrency } from '@/lib/dashboard-utils';

export type DashboardActivity = { id: number | string; type: 'income' | 'expense'; description: string; date: string; amount: number; movementKind?: 'RECEIPT' | 'PAYMENT_CORRECTION' | 'CUSTOMER_REFUND'; invoiceId?: number | null; originInvoiceId?: number | null; allocatedInvoiceId?: number | null; invoiceAttribution?: 'IMMUTABLE_CASH_ORIGIN' | 'CURRENT_ADJUSTMENT'; paymentAllocationReviewRequired?: boolean };

export function DashboardActivityFeed({ activities }: { activities: DashboardActivity[] }) {
  return <section className="dashboard-activity-feed" aria-labelledby="activity-feed-heading">
    <header><DashboardIcon name="tile-activity" size={32} /><h2 id="activity-feed-heading">Letzte Aktivitäten</h2></header>
    {activities.length ? <ul>{activities.slice(0, 5).map(activity => {
      const income = activity.type === 'income';
      const adjustment = activity.movementKind === 'PAYMENT_CORRECTION' || activity.movementKind === 'CUSTOMER_REFUND';
      const label = activity.movementKind === 'PAYMENT_CORRECTION' ? 'Korrektur: nie erhalten' : activity.movementKind === 'CUSTOMER_REFUND' ? 'Erstattung: tatsächlich zurückgezahlt' : income ? 'Einnahme' : 'Ausgabe';
      const currentInvoice = !activity.paymentAllocationReviewRequired && Number.isSafeInteger(activity.allocatedInvoiceId) && activity.allocatedInvoiceId! > 0 ? activity.allocatedInvoiceId : null;
      const href = income && activity.invoiceAttribution === 'IMMUTABLE_CASH_ORIGIN' && (currentInvoice || activity.originInvoiceId) ? `/history?invoiceId=${currentInvoice || activity.originInvoiceId}` : adjustment ? Number.isSafeInteger(activity.invoiceId) && activity.invoiceId! > 0 ? `/history?invoiceId=${activity.invoiceId}` : '/history' : `/dashboard?tab=${income ? 'incomes' : 'expenses'}`;
      const reducing = adjustment || !income;
      return <li key={`${activity.type}-${activity.id}`}><Link href={href} aria-label={`${label} anzeigen: ${activity.description}`}>
        <span className={`activity-direction ${reducing ? 'text-critical bg-secondary' : 'text-positive bg-positive-surface'}`}><DashboardIcon name={reducing ? "nav-expenses" : "nav-incomes"} size={32} /></span>
        <span className="activity-description"><strong>{activity.description}</strong><span>{new Date(activity.date).toLocaleDateString('de-DE')} · {label}</span>{activity.originInvoiceId && <span>Original-Rechnung #{activity.originInvoiceId} · {activity.paymentAllocationReviewRequired ? 'Aktuelle Zuordnung prüfen' : currentInvoice ? `aktuell #${currentInvoice}` : 'Aktuelle Zuordnung unbekannt'}</span>}</span>
        <span className={`activity-amount ${reducing ? 'text-critical' : 'text-positive'}`}>{formatCurrency(reducing ? -Math.abs(activity.amount) : activity.amount)}</span>
      </Link></li>;
    })}</ul> : <p className="p-6 text-sm text-muted-foreground">Noch keine Buchungen.</p>}
    <footer><Link href="/dashboard?tab=invoices">Rechnungen verwalten<ChevronRight aria-hidden="true" /></Link></footer>
  </section>;
}
