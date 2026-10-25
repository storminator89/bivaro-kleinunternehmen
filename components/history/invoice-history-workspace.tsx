'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, ArrowRight, FileText, History, Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUDIT_ACTION_LABELS } from '@/lib/audit-presentation';
import { HISTORY_ACTIONS, historyStatusLabel, historyLifecycle, type HistoryDetail, type HistoryDocument, type HistoryList, type HistoryPagination } from '@/lib/invoice-history-contract';
import { displayPaymentAmount } from '@/lib/full-payment-form';
import { PAYMENT_DASHBOARD_REFRESH_EVENT } from '@/lib/payment-dashboard-refresh';
import styles from './history-workspace.module.css';

const control = styles.control;
function instant(value: string) { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC'; }
function day(value: string | null) { return value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : 'Datum unbekannt'; }
function amount(document: HistoryDocument) {
  if (document.totalAmount === null) return 'Betrag unbekannt';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(document.totalAmount) + ` ${document.currency ?? '(Währung nicht dokumentiert)'}`;
}
function Pager({ pagination, onPage }: { pagination: HistoryPagination; onPage: (page: number) => void }) {
  return <nav aria-label="Historie blättern" className={styles.pager}>
    <span>Seite {pagination.page} · {pagination.total} {pagination.total === 1 ? 'Eintrag' : 'Einträge'}</span>
    <div className="flex gap-2"><Button variant="outline" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ArrowLeft aria-hidden="true" className="size-4" />Zurück</Button><Button variant="outline" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Weiter<ArrowRight aria-hidden="true" className="size-4" /></Button></div>
  </nav>;
}
function DocumentStand({ document, originalId, missingOriginal }: { document: HistoryDocument; originalId: number; missingOriginal: boolean }) {
  return <li className={styles.document}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className={styles.documentRole}>{document.id === originalId ? missingOriginal ? 'Gewähltes Dokument · Ursprung nicht verfügbar' : 'Ursprungsdokument' : 'Referenzierte Korrektur'}</p><h3 className="mt-1 break-words font-semibold">{document.invoiceNumber || `Dokument #${document.id}`}</h3><p className="mt-1 text-sm">{document.type === 'CREDIT_NOTE' ? 'Gutschrift / Stornobeleg' : 'Rechnung'} · {historyLifecycle(document)}</p></div><p className="break-words font-semibold tabular-nums">{amount(document)}</p></div>
    <dl className={styles.documentFacts}><div><dt className="text-muted-foreground">Dokumentdatum</dt><dd>{day(document.invoiceDate)}</dd></div><div><dt className="text-muted-foreground">Aktueller Dokumentstatus</dt><dd>{historyStatusLabel(document.status) ?? 'Unbekannt'}</dd></div><div><dt className="text-muted-foreground">Im Dokument gespeicherte Steuerwahl</dt><dd>{document.taxMode === 'small-business' ? 'Kleinunternehmer' : document.taxMode === 'standard' ? 'Regelbesteuerung' : 'Nicht dokumentiert / Altbestand'}</dd></div><div><dt className="text-muted-foreground">In Bivaro gespeichert</dt><dd>{instant(document.uploadedAt)}</dd></div></dl>
    {document.originalInvoiceId && <p className="text-sm">Bezieht sich auf Ursprungsdokument #{document.originalInvoiceId}.</p>}
    {document.cancellationReason && <div className="text-sm"><p className="font-medium">Gespeicherter Stornogrund</p><p className="mt-1 whitespace-pre-wrap break-words">{document.cancellationReason}</p></div>}
    <a className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={`/api/invoices/download?id=${document.id}&download=true`}><FileText className="size-4" aria-hidden="true" />Gespeicherte Datei herunterladen<span className="sr-only">: {document.invoiceNumber || `Dokument ${document.id}`}</span></a>
  </li>;
}
export function InvoiceAdjustmentEvidence({ adjustments, adjustmentCount }: Pick<HistoryDetail, 'adjustments' | 'adjustmentCount'>) {
  if (adjustments === undefined) return <p className="mt-4 text-sm text-muted-foreground">Korrektur- und Erstattungsbelege sind in diesem Datenstand nicht enthalten. Daraus folgt keine Aussage über erfolgte Erstattungen.</p>;
  return <section aria-label="Original-verknüpfte Zahlungsfolgebelege" className="mt-4 space-y-3 border-t border-border pt-4">
    <h3 className="font-semibold">Korrektur- und Erstattungsbelege · {adjustmentCount ?? adjustments.length}</h3>
    <p className="text-sm text-muted-foreground">Gespeicherte Folgebelege · Keine Überweisung · Steuerlich ungeprüft.</p>
    {adjustments.length ? <ol className="divide-y divide-border">{adjustments.map(adjustment => <li key={adjustment.id} className="space-y-1 py-3 text-sm">
      <p className="font-semibold">{adjustment.kind === 'PAYMENT_CORRECTION' ? 'Korrektur: nie erhalten' : adjustment.kind === 'CUSTOMER_REFUND' ? 'Erstattung: tatsächlich zurückgezahlt' : 'Finanzbeleg prüfen'} · {/^[1-9]\d{0,15}$/u.test(adjustment.amountCents) ? displayPaymentAmount(adjustment.amountCents) : 'Betrag prüfen'}</p>
      <p>Folgebeleg #{adjustment.id} → Original-Zahlungsnachweis #{adjustment.originalPaymentId}</p>{adjustment.originInvoiceId && <p>Original auf Rechnung #{adjustment.originInvoiceId} · Zuordnung bei Erfassung: Rechnung #{adjustment.invoiceId ?? adjustment.allocatedInvoiceId}</p>}
      <p>{adjustment.kind === 'CUSTOMER_REFUND' ? 'Tatsächliche Auszahlung' : 'Fehlbuchung entdeckt'}: {day(adjustment.actionDate)}</p>
      <p>Buchungszuordnung: {instant(adjustment.accountingEffectiveOn)}</p><p>Protokolliert: {instant(adjustment.recordedAt)}</p>
      {adjustment.cancellationInvoiceId && <p>Vollständiger Stornobeleg #{adjustment.cancellationInvoiceId}</p>}
      <p className="break-words">Grund: {adjustment.reason}</p>
    </li>)}</ol> : <p className="text-sm">Keine Korrektur- oder Erstattungsbelege im aktuellen Journal vorhanden.</p>}
    {(adjustmentCount ?? adjustments.length) > adjustments.length && <p className="text-sm text-muted-foreground">Gezeigt: die neuesten {adjustments.length} von {adjustmentCount} Folgebelegen. Vollständigen Verlauf in den Rechnungsaktionen prüfen; aus diesem Ausschnitt keine Zahlungsbilanz ableiten.</p>}
  </section>;
}
function Detail({ detail }: { detail: HistoryDetail }) {
  return <div className={styles.evidenceGrid}>
    <section className={styles.panel} aria-labelledby="document-relationship-title">
      <div className={styles.panelHeading}><h2 id="document-relationship-title" className="font-semibold">Original und Korrektur</h2><p className="mt-1 text-sm text-muted-foreground">Gespeicherte Dokumentstände · mögliche Lücken im Verlauf.</p></div>
      {detail.missingOriginal && <p role="status" className="px-5 pt-4 text-sm">Der referenzierte Ursprung ist in deinem Bestand nicht verfügbar. Es wird keine Beziehung ergänzt oder vermutet.</p>}
      <ol aria-label="Dokumentbeziehungen">{detail.documents.map(document => <DocumentStand key={document.id} document={document} originalId={detail.originalId} missingOriginal={detail.missingOriginal} />)}</ol>
      {detail.documents.length === 1 && <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">Keine Korrektur im aktuellen Bestand verknüpft.</p>}

    </section>
    <section className={styles.paymentPanel} aria-labelledby="history-payments-title">
      <h2 id="history-payments-title" className="font-semibold">Zahlungsnachweise getrennt vom Dokument</h2>
      <p className={styles.evidenceNotice}>Storno bedeutet nicht zurückgezahlt.</p><p className="mt-1 text-sm text-muted-foreground">Zahlungseingänge und Folgebelege getrennt prüfen.</p>
      {detail.payments.length ? <ol aria-label="Gespeicherte Zahlungsnachweise" className="mt-4 divide-y divide-border">{detail.payments.map(payment => <li key={payment.id} className="py-3 text-sm"><p className="flex flex-wrap justify-between gap-2"><span>Nachweis #{payment.id}</span><strong className="tabular-nums">{/^[1-9]\d{0,15}$/.test(payment.amountCents) ? new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(payment.amountCents) / 100) : 'Betrag prüfen'} {payment.currency}</strong></p><p className="mt-1">{day(payment.paidAt)} · {payment.dateCertainty === 'ACTUAL' ? 'Tatsächliches Zahlungsdatum' : payment.dateCertainty === 'UNKNOWN' ? 'Datumsnachweis unbekannt' : 'Historischer Datumsnachweis'}</p>{payment.originInvoiceId && <p className="mt-1 text-xs text-muted-foreground">Original auf Rechnung #{payment.originInvoiceId} · {payment.allocatedInvoiceId ? `Aktuell Rechnung #${payment.allocatedInvoiceId}` : 'Aktuelle Zuordnung prüfen'}</p>}<p className="mt-1 text-muted-foreground">Quelle: {payment.source === 'MANUAL' ? 'Manuell erfasst' : payment.source === 'LEGACY_IMPORT' ? 'Historische Übernahme' : payment.source === 'LEGACY_STATUS' ? 'Historischer Status' : 'Nicht eingeordnet'}</p></li>)}</ol> : <p className="mt-4 text-sm">Keine Zahlungsjournal-Einträge vorhanden. Ein alter Bezahlt-Status allein belegt hier weder Zahlung noch Erstattung.</p>}
      {detail.paymentCount > detail.payments.length && <p className="mt-3 text-sm text-muted-foreground">Gezeigt: die neuesten {detail.payments.length} von {detail.paymentCount} Zahlungsnachweisen. Den vollständigen Zahlungsverlauf findest du in den Rechnungsaktionen.</p>}
      {detail.paymentReviewRequired && <p role="status" className="mt-3 text-sm">Aktuelle Zuordnung muss geprüft werden. Historische Nachweise sind keine aktuelle Zahlungsbilanz.</p>}
      {detail.allocationHistory && detail.allocationHistory.length > 0 && <section aria-label="Rechnungszuordnungen ohne Geldfluss" className="mt-4 space-y-3 border-t pt-4"><h3 className="font-semibold">Rechnungszuordnung geändert</h3><p className="text-sm text-muted-foreground">Kein zusätzlicher Geldeingang und keine Rückzahlung.</p><ol className="divide-y">{detail.allocationHistory.map(change => <li key={change.stableKey} className="space-y-1 py-3 text-sm"><p className="font-medium"><Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${change.fromInvoiceId}`}>Rechnung #{change.fromInvoiceId}</Link> → <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${change.toInvoiceId}`}>Rechnung #{change.toInvoiceId}</Link> · {displayPaymentAmount(change.amountCents)}</p><p>Entdeckt {day(change.actionDate)} · Stand {change.revision}</p><p className="break-words">{change.reason}</p></li>)}</ol></section>}
      <InvoiceAdjustmentEvidence adjustments={detail.adjustments} adjustmentCount={detail.adjustmentCount} />
      <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" href="/dashboard?tab=invoices">Zu den Rechnungsaktionen</Link>
    </section>
  </div>;
}
export function InvoiceHistoryWorkspace() {
  const { data: session } = useSession();
  return <HistoryContent key={session?.user?.id ?? 'signed-out'} />;
}
function HistoryContent() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const query = params.toString(), selected = params.has('invoiceId');
  const { status } = useSession();
  const [data, setData] = useState<HistoryList | HistoryDetail | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [search, setSearch] = useState(params.get('search') ?? '');
  useEffect(() => {
    const refreshPayments = () => setRetry(value => value + 1);
    window.addEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments);
    return () => window.removeEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments);
  }, []);
  useEffect(() => setSearch(params.get('search') ?? ''), [params]);
  useEffect(() => {
    if (status !== 'authenticated') return;
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    fetch(`/api/change-history?${query}`, { signal: controller.signal, cache: 'no-store', headers: { 'X-Bivaro-Payment-Contract': '3' } }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Historie konnte nicht geladen werden.');
      if (!controller.signal.aborted) setData(body);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Historie konnte nicht geladen werden.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, retry, status]);
  function navigate(values: Record<string, string | null>) {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
    router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  return <div className={styles.workspace}>
    <PageHeader title="Rechnungshistorie" description="App-Protokolle · Verlauf kann Lücken enthalten." actions={<Button variant="outline" disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />Aktualisieren</Button>} />
    {selected && <Button variant="outline" className={styles.back} onClick={() => navigate({ invoiceId: null, page: null, action: null, from: null, to: null })}><ArrowLeft className="size-4" aria-hidden="true" />Alle Dokumente</Button>}
    {!selected && <form role="search" aria-label="Rechnungen für die Historie suchen" className={styles.search} onSubmit={event => { event.preventDefault(); navigate({ search: search.trim() || null, page: null }); }}><div className="min-w-0 flex-1 space-y-2"><Label htmlFor="history-search">Rechnungs- oder Gutschriftnummer</Label><Input id="history-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Dokumentnummer suchen" /></div><Button variant="outline" type="submit">Suchen</Button>{params.has('search') && <Button variant="ghost" type="button" onClick={() => navigate({ search: null, page: null })}>Suche zurücksetzen</Button>}</form>}
    {selected && <form aria-label="Protokoll filtern" className={styles.filters} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); navigate({ action: String(form.get('action')) || null, from: String(form.get('from')) || null, to: String(form.get('to')) || null, page: null }); }} key={`${params.get('action')}-${params.get('from')}-${params.get('to')}`}>
      <div className="space-y-2"><Label htmlFor="history-action">Protokollierte Aktion</Label><select className={control} name="action" id="history-action" defaultValue={params.get('action') ?? ''}><option value="">Alle Aktionen</option>{HISTORY_ACTIONS.map(action => <option key={action} value={action}>{AUDIT_ACTION_LABELS[action]}</option>)}</select></div><div className="space-y-2"><Label htmlFor="history-from">Protokolliert ab (UTC)</Label><Input type="date" name="from" id="history-from" defaultValue={params.get('from') ?? ''} /></div><div className="space-y-2"><Label htmlFor="history-to">Protokolliert bis (UTC)</Label><Input type="date" name="to" id="history-to" defaultValue={params.get('to') ?? ''} /></div><div className={styles.filterActions}><Button variant="outline" type="submit">Filter anwenden</Button><Button variant="ghost" type="button" onClick={() => navigate({ action: null, from: null, to: null, page: null })}>Filter zurücksetzen</Button></div>
    </form>}
    <div aria-live="polite" aria-busy={loading}>
      {loading ? <div role="status" className={styles.loading}><p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Rechnungshistorie wird geladen…</p><div className={styles.skeletonRows} aria-hidden="true"><span /><span /><span /></div></div> : error ? <div role="alert" className={styles.error}><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Erneut versuchen</Button><Button variant="ghost" onClick={() => router.push('/history')}>Zur Dokumentübersicht</Button></div> : data?.kind === 'list' ? <section className={styles.panel} aria-labelledby="history-list-title"><h2 className={styles.panelHeading} id="history-list-title">Dokument auswählen · {data.pagination.total}</h2>{data.documents.length ? <ul aria-label="Dokumente mit Historie">{data.documents.map(document => <li key={document.id} className="border-b border-border last:border-b-0"><button type="button" className={styles.documentChoice} onClick={() => navigate({ invoiceId: String(document.id), page: null })}><div className="min-w-0"><p className="break-words font-semibold">{document.invoiceNumber || `Dokument #${document.id}`}</p><p className="mt-1 text-sm text-muted-foreground">{document.type === 'CREDIT_NOTE' ? 'Gutschrift / Stornobeleg' : 'Rechnung'} · {historyLifecycle(document)} · {day(document.invoiceDate)}</p></div><span className="flex items-center gap-1 text-sm font-medium text-primary">Historie ansehen<ArrowRight className="size-4" aria-hidden="true" /></span></button></li>)}</ul> : <div className="space-y-2 p-6"><h3 className="font-medium">Keine passenden Dokumente</h3><p className="text-sm text-muted-foreground">Suche oder Seite ändern.</p></div>}<Pager pagination={data.pagination} onPage={page => navigate({ page: String(page) })} /></section> : data?.kind === 'detail' ? <div className={styles.detail}><Detail detail={data} /><section className={styles.panel} aria-labelledby="history-events-title"><div className={styles.panelHeading}><h2 id="history-events-title" className="font-semibold">Protokollierte Ereignisse · {data.pagination.total}</h2><p className="mt-1 text-sm text-muted-foreground">Zeitpunkt der App-Protokollierung · neueste zuerst.</p></div>{data.events.length ? <ol aria-label="Protokollierte Dokumentereignisse" className={styles.timeline}>{data.events.map(event => <li key={event.id} className={styles.event}><div className="flex flex-wrap justify-between gap-2"><h3 className="min-w-0 max-w-full break-words font-semibold">{AUDIT_ACTION_LABELS[event.action]} · {data.documents.find(document => document.id === event.documentId)?.invoiceNumber || `Dokument #${event.documentId}`}</h3><time dateTime={event.createdAt} className="text-sm text-muted-foreground">{instant(event.createdAt)}</time></div><p className="text-sm">Akteur: {event.actor === 'ACCOUNT_RECORDED' ? 'Dein Konto (im Protokoll zugeordnet)' : 'Nicht eindeutig protokolliert'}</p>{event.changes.length ? <dl className="space-y-2 text-sm">{event.changes.map(change => <div key={change.field} className={styles.change}><dt className="text-muted-foreground">{change.label}</dt><dd className="break-words"><span className="font-medium">Vorher:</span> {change.before ?? 'Nicht protokolliert / unbekannt'}<br /><span className="font-medium">Nachher:</span> {change.after ?? 'Nicht protokolliert / unbekannt'}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">Keine Vorher-/Nachher-Werte protokolliert.</p>}</li>)}</ol> : <div className="space-y-2 p-5"><History className="size-5 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">Keine protokollierten Ereignisse für diese Auswahl</h3><p className="text-sm text-muted-foreground">Filter ändern. Fehlende Einträge schließen frühere Änderungen nicht aus.</p></div>}<Pager pagination={data.pagination} onPage={page => navigate({ page: String(page) })} /></section></div> : null}
    </div>
  </div>;
}
