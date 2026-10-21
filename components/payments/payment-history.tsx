import { formatBusinessDateDisplay } from '@/lib/business-date';
import { displayPaymentAmount, type PaymentHistoryEvent } from '@/lib/full-payment-form';
import type { PaymentAdjustmentEvent } from '@/lib/payment-adjustment-form';

/** One readable card per immutable allocation, at every viewport size. */
export function PaymentHistory({ events, adjustments = [] }: { events: PaymentHistoryEvent[]; adjustments?: PaymentAdjustmentEvent[] }) {
  if (events.length === 0) return null;
  return <section aria-label="Zahlungsverlauf" className="min-w-0">
    <details open={events.length <= 2} className="rounded-xl border bg-muted/10 px-4">
    <summary className="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"><span className="font-semibold">Zahlungsverlauf</span><span className="ml-2 text-muted-foreground">{events.length} {events.length === 1 ? 'Eingang' : 'Eingänge'}{adjustments.length > 0 ? ` · ${adjustments.length} ${adjustments.length === 1 ? 'Folgebeleg' : 'Folgebelege'}` : ''}</span></summary>
    <ol className="space-y-3 pb-4">{events.map(event => <li key={event.id} className="rounded-lg border bg-card p-3 text-sm">
      <p className="flex flex-wrap justify-between gap-2"><strong>{displayPaymentAmount(event.amountCents)}</strong><span>Original-Zahlungsnachweis #{event.id}</span></p>
      <p>{event.paidAt ? formatBusinessDateDisplay(event.paidAt) : 'Datum unbekannt'} · {event.dateCertainty === 'ACTUAL' ? 'Tatsächliches Datum' : event.dateCertainty === 'UNKNOWN' ? 'Datumsnachweis unbekannt' : 'Historischer Datumsnachweis'}</p>
      <details className="text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">Nachweisdetails</summary><div className="space-y-1"><p>Quelle: {event.source === 'MANUAL' ? 'Manuell' : event.source === 'LEGACY_STATUS' ? 'Historischer Status' : event.source === 'LEGACY_IMPORT' ? 'Historische Übernahme' : event.source}</p>{event.reference && <p className="break-words">Referenz: {event.reference}</p>}</div></details>
      {adjustments.some(adjustment => adjustment.originalPaymentId === event.id) && <ol aria-label={`Unveränderliche Folgebelege zu Zahlungsnachweis ${event.id}`} className="mt-3 space-y-3 border-l-2 pl-3">{adjustments.filter(adjustment => adjustment.originalPaymentId === event.id).map(adjustment => <li key={adjustment.id} className="space-y-1">
        <p className="font-semibold">{adjustment.kind === 'PAYMENT_CORRECTION' ? 'Korrektur: nie erhalten' : 'Erstattung: tatsächlich zurückgezahlt'} · {displayPaymentAmount(adjustment.amountCents)}</p>
        <p className="text-xs text-muted-foreground">Folgebeleg #{adjustment.id} → Original #{event.id} · {formatBusinessDateDisplay(adjustment.actionDate)}</p>
        <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">Folgebeleg ansehen</summary><div className="space-y-1"><p>{adjustment.kind === 'PAYMENT_CORRECTION' ? 'Fehlbuchung entdeckt' : 'Tatsächliche Auszahlung'}: {formatBusinessDateDisplay(adjustment.actionDate)}</p><p>Buchungszuordnung: {formatBusinessDateDisplay(adjustment.accountingEffectiveOn)} · steuerlich prüfpflichtig, nicht freigegeben</p>
        {adjustment.cancellationInvoiceId && <p>Vollständiger Stornobeleg #{adjustment.cancellationInvoiceId}</p>}
        <p className="break-words">Grund: {adjustment.reason}</p><p className="break-words">Nachweis: {adjustment.reference}</p></div></details>
      </li>)}</ol>}
    </li>)}</ol></details>
  </section>;
}
