import Link from 'next/link';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { displayPaymentAmount, type PaymentHistoryEvent, type PaymentAllocationHistoryEvent } from '@/lib/full-payment-form';
import type { EffectivePayment } from '@/lib/payment-journal/allocation-contract';
import type { PaymentAdjustmentEvent } from '@/lib/payment-adjustment-form';

function AdjustmentHistory({ adjustments, originalPaymentId }: { adjustments: PaymentAdjustmentEvent[]; originalPaymentId: number }) {
  const related = adjustments.filter(adjustment => adjustment.originalPaymentId === originalPaymentId);
  if (!related.length) return null;
  return <ol aria-label={`Unveränderliche Folgebelege zu Zahlungsnachweis ${originalPaymentId}`} className="mt-3 space-y-3 border-l-2 pl-3">{related.map(adjustment => <li key={adjustment.id} className="space-y-1">
    <p className="font-semibold">{adjustment.kind === 'PAYMENT_CORRECTION' ? 'Korrektur: nie erhalten' : 'Erstattung: tatsächlich zurückgezahlt'} · {displayPaymentAmount(adjustment.amountCents)}</p>
    <p className="text-xs text-muted-foreground">Folgebeleg #{adjustment.id} → Original #{originalPaymentId} · {formatBusinessDateDisplay(adjustment.actionDate)}</p>
    <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">Folgebeleg ansehen</summary><div className="space-y-1"><p>{adjustment.kind === 'PAYMENT_CORRECTION' ? 'Fehlbuchung entdeckt' : 'Tatsächliche Auszahlung'}: {formatBusinessDateDisplay(adjustment.actionDate)}</p><p>Buchungszuordnung: {formatBusinessDateDisplay(adjustment.accountingEffectiveOn)} · steuerlich prüfpflichtig, nicht freigegeben</p>
      {adjustment.contractVersion === 3 && adjustment.allocationBasisSnapshot && <p>Original: {String(adjustment.allocationBasisSnapshot.originInvoiceNumber)} · Zuordnung bei Erfassung: {String(adjustment.allocationBasisSnapshot.currentInvoiceNumber)}</p>}
      {adjustment.cancellationInvoiceId && <p>Vollständiger Stornobeleg #{adjustment.cancellationInvoiceId}</p>}
      <p className="break-words">Grund: {adjustment.reason}</p><p className="break-words">Nachweis: {adjustment.reference}</p></div></details>
  </li>)}</ol>;
}

/** Original evidence, current allocation and cash-neutral changes are separate views. */
export function PaymentHistory({ events, adjustments = [], effectivePayments, originAssignments, allocationHistory = [] }: {
  events: PaymentHistoryEvent[]; adjustments?: PaymentAdjustmentEvent[]; effectivePayments?: EffectivePayment[];
  originAssignments?: EffectivePayment[]; allocationHistory?: PaymentAllocationHistoryEvent[];
}) {
  if (events.length === 0 && !effectivePayments?.length && !allocationHistory.length) return null;
  return <section aria-label="Zahlungsverlauf" className="min-w-0">
    <details open={events.length <= 2} className="rounded-xl border bg-muted/10 px-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"><span className="font-semibold">Zahlungsverlauf</span><span className="ml-2 text-muted-foreground">{events.length} {effectivePayments !== undefined ? 'Originaleingänge' : events.length === 1 ? 'Eingang' : 'Eingänge'}{effectivePayments !== undefined ? ` · ${effectivePayments.length} aktuell zugeordnet` : ''}{adjustments.length > 0 ? ` · ${adjustments.length} ${adjustments.length === 1 ? 'Folgebeleg' : 'Folgebelege'}` : ''}</span></summary>
      {effectivePayments !== undefined && <div className="space-y-2 border-t py-3 text-sm"><h4 className="font-semibold">Aktuell dieser Rechnung zugeordnet</h4>{effectivePayments.length ? <ul className="space-y-2">{effectivePayments.map(root => <li key={root.originalPaymentId} className="rounded-lg border bg-card p-3"><p className="font-medium">{displayPaymentAmount(root.validReceivedCents)} · Original-Zahlungsnachweis #{root.originalPaymentId}</p><p className="mt-1 text-xs text-muted-foreground">Ursprung Rechnung #{root.originInvoiceId} → aktuell Rechnung #{root.allocatedInvoiceId}{root.allocationRevision !== null ? ` · Stand ${root.allocationRevision}` : ''}</p>{root.bindingStableKey && <Link className="mt-1 inline-flex min-h-11 items-center text-xs text-primary underline underline-offset-4" href="/bank-csv">Andere Rechnung · Bankimport öffnen</Link>}{!events.some(event => event.id === root.originalPaymentId) && <AdjustmentHistory adjustments={adjustments} originalPaymentId={root.originalPaymentId} />}</li>)}</ul> : <p className="text-muted-foreground">Kein Zahlungseingang aktuell zugeordnet. Ursprüngliche Nachweise bleiben erhalten.</p>}</div>}
      <ol className="space-y-3 pb-4">{events.map(event => {
        const current = originAssignments?.find(root => root.originalPaymentId === event.id);
        return <li key={event.id} className="rounded-lg border bg-card p-3 text-sm">
          <p className="flex flex-wrap justify-between gap-2"><strong>{displayPaymentAmount(event.amountCents)}</strong><span>Original-Zahlungsnachweis #{event.id}</span></p>
          {effectivePayments !== undefined && <p className="text-xs text-muted-foreground">Originaleingang auf Rechnung #{event.invoiceId}{current ? <> · Aktuell <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${current.allocatedInvoiceId}`}>Rechnung #{current.allocatedInvoiceId}</Link></> : !effectivePayments.some(root => root.originalPaymentId === event.id) ? ' · nicht aktuell dieser Rechnung zugeordnet' : ''}</p>}
          <p>{event.paidAt ? formatBusinessDateDisplay(event.paidAt) : 'Datum unbekannt'} · {event.dateCertainty === 'ACTUAL' ? 'Tatsächliches Datum' : event.dateCertainty === 'UNKNOWN' ? 'Datumsnachweis unbekannt' : 'Historischer Datumsnachweis'}</p>
          <details className="text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">Nachweisdetails</summary><div className="space-y-1"><p>Quelle: {event.source === 'MANUAL' ? 'Manuell' : event.source === 'LEGACY_STATUS' ? 'Historischer Status' : event.source === 'LEGACY_IMPORT' ? 'Historische Übernahme' : event.source}</p>{event.reference && <p className="break-words">Referenz: {event.reference}</p>}</div></details>
          <AdjustmentHistory adjustments={adjustments} originalPaymentId={event.id} />
        </li>;
      })}</ol>
      {allocationHistory.length > 0 && <div className="space-y-2 border-t py-3 text-sm"><h4 className="font-semibold">Rechnungswechsel · kein Geldfluss</h4><ol className="space-y-3">{allocationHistory.map(change => <li key={change.stableKey} className="space-y-1"><p><Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${change.fromInvoiceId}`}>{change.fromInvoiceNumber}</Link> → <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${change.toInvoiceId}`}>{change.toInvoiceNumber}</Link> · {displayPaymentAmount(change.amountCents)}</p><p className="text-xs text-muted-foreground">Entdeckt {formatBusinessDateDisplay(change.actionDate)} · Stand {change.revision}</p><p className="break-words">{change.reason}</p></li>)}</ol></div>}
    </details>
  </section>;
}
