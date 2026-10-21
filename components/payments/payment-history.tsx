import { formatBusinessDateDisplay } from '@/lib/business-date';
import { displayPaymentAmount, type PaymentHistoryEvent } from '@/lib/full-payment-form';

/** One readable card per immutable allocation, at every viewport size. */
export function PaymentHistory({ events }: { events: PaymentHistoryEvent[] }) {
  if (events.length === 0) return null;
  return <section aria-label="Zahlungsverlauf" className="space-y-2">
    <h3 className="font-semibold">Zahlungsverlauf</h3>
    <ol className="space-y-2">{events.map(event => <li key={event.id} className="rounded-md border p-3 text-sm">
      <p className="flex flex-wrap justify-between gap-2"><strong>{displayPaymentAmount(event.amountCents)}</strong><span>Zahlungsnachweis #{event.id}</span></p>
      <p>{event.paidAt ? formatBusinessDateDisplay(event.paidAt) : 'Datum unbekannt'} · {event.dateCertainty === 'ACTUAL' ? 'Tatsächliches Datum' : event.dateCertainty === 'UNKNOWN' ? 'Datumsnachweis unbekannt' : 'Historischer Datumsnachweis'}</p>
      <p>Quelle: {event.source === 'MANUAL' ? 'Manuell' : event.source === 'LEGACY_STATUS' ? 'Historischer Status' : event.source === 'LEGACY_IMPORT' ? 'Historische Übernahme' : event.source}</p>
      {event.reference && <p className="break-words">Referenz: {event.reference}</p>}
    </li>)}</ol>
  </section>;
}
