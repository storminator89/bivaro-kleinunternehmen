'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArchiveX, Download, FileText, Info, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ParsedEInvoiceParty } from '@/lib/e-invoice-parser';
import type { IncomingDocument, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { errorMessage, extractionLabel, formatFileSize, formatSourceAmount, formatSourceDate, incomingJson, incomingResponseError, reviewLabel, type ReviewAction } from './incoming-document-ui';

export function SourceParty({ title, party }: { title: string; party: ParsedEInvoiceParty | null }) {
  return <section className="min-w-0 py-4" aria-label={title}>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    <p className="mt-2 break-words font-medium">{party?.name || 'Nicht ausgelesen'}</p>
    {party && <div className="mt-1 space-y-1 break-words text-sm text-muted-foreground">
      {party.address && <p className="whitespace-pre-line">{party.address}</p>}
      {(party.zipCode || party.city) && <p>{[party.zipCode, party.city].filter(Boolean).join(' ')}</p>}
      {party.country && <p>{party.country}</p>}
      {party.email && <p className="break-all">{party.email}</p>}
    </div>}
  </section>;
}
export function SourcePreview({ document, onOpen }: { document: IncomingDocument; onOpen: (id: number) => void }) {
  const preview = document.preview;
  const types = { INVOICE: 'Rechnung', CREDIT_NOTE: 'Gutschrift', DEBIT_NOTE: 'Belastungsanzeige', UNKNOWN: 'Unbekannter Dokumenttyp' };
  return <>
    <div className="border-y border-border py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bruttobetrag laut Original · ungeprüft</p>
      <p className="mt-1 break-words text-2xl font-semibold tabular-nums sm:text-3xl">{formatSourceAmount(document.totalAmount, document.currency)}</p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium"><Info className="size-4 shrink-0" aria-hidden="true" />{reviewLabel(document)}</p>
    </div>
    <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 [&>section]:sm:pr-5 [&>section+section]:sm:pl-5">
      <SourceParty title="Lieferant / Verkäufer" party={document.supplierCandidate} />
      <SourceParty title="Empfänger / Käufer" party={document.buyerCandidate} />
    </div>
    <p className="border-b border-border pb-4 text-xs text-muted-foreground">Ausgelesene Angaben sind nur Vorschläge. Lieferant und Empfänger werden nicht als Kunden angelegt. Bitte die Zugehörigkeit anhand des Originals prüfen.</p>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 py-5 text-sm [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words [&_dd]:font-medium">
      <div><dt>Rechnungsnummer</dt><dd>{document.invoiceNumber || 'Nicht ausgelesen'}</dd></div>
      <div><dt>Rechnungsdatum</dt><dd>{formatSourceDate(document.invoiceDate)}</dd></div>
      <div><dt>Dokumenttyp</dt><dd>{preview ? types[preview.documentType] : 'Nicht ausgelesen'}</dd></div>
      <div><dt>Währung</dt><dd>{document.currency || 'Nicht ausgelesen'}</dd></div>
      <div><dt>Auslesen</dt><dd>{extractionLabel(document.parseStatus)}</dd></div>
      <div><dt>Konformitätsprüfung</dt><dd>Nicht validiert</dd></div>
      {preview?.dueDate && <div><dt>Fällig laut Original</dt><dd>{formatSourceDate(preview.dueDate)}</dd></div>}
      {preview?.dueAmount !== null && preview?.dueAmount !== undefined && <div><dt>Restbetrag laut Original</dt><dd>{formatSourceAmount(preview.dueAmount, preview.currency)}</dd></div>}
    </dl>
    {document.parseStatus !== 'PARSED' && <div className="mb-4 flex gap-2 rounded-md bg-caution-surface p-3 text-sm text-caution-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>{document.parseStatus === 'PENDING' ? 'Das Auslesen ist noch ausstehend. Bitte neu laden oder das Auslesen erneut starten.' : document.parseErrorCode === 'NO_EMBEDDED_XML' ? 'Im PDF wurden keine eingebetteten Rechnungsdaten gefunden. Das vollständige Original bleibt erhalten. Kein OCR verfügbar.' : 'Die Rechnungsdaten konnten nicht ausgelesen werden. Das Original bleibt erhalten; bitte manuell prüfen.'}</p></div>}
    {document.parserWarnings.length > 0 && <section aria-labelledby="incoming-warning-heading" className="mb-4 border-l-2 border-caution pl-3">
      <h3 id="incoming-warning-heading" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 shrink-0 text-caution" aria-hidden="true" />Prüfhinweise</h3>
      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">{document.parserWarnings.map((warning, index) => <li key={`${warning.code}-${index}`} className="break-words">{warning.message}</li>)}</ul>
    </section>}
    {document.businessDuplicates.length > 0 && <section className="mb-4" aria-label="Mögliche fachliche Dubletten">
      <h3 className="text-sm font-semibold">Ähnliche Belege prüfen</h3><p className="mt-1 text-xs text-muted-foreground">Gleicher Lieferantenname und gleiche Rechnungsnummer sind ein Hinweis, kein Nachweis einer Dublette.</p>
      <ul className="mt-2 divide-y divide-border">{document.businessDuplicates.map(duplicate => <li key={duplicate.id}><Button variant="link" className="h-auto min-h-11 max-w-full justify-start whitespace-normal px-0 text-left" onClick={() => onOpen(duplicate.id)}>Beleg #{duplicate.id} · {duplicate.invoiceNumber || 'Ohne Rechnungsnummer'} · {formatSourceAmount(duplicate.totalAmount, duplicate.currency)}</Button></li>)}</ul>
    </section>}
    <section className="border-t border-border py-4 text-sm" aria-label="Nächster Schritt">
      <h3 className="font-semibold">{document.reviewState === 'DISMISSED' ? 'Original aufbewahrt' : document.linkedExpenseId !== null ? 'Mit Ausgabe verknüpft' : 'Prüfen, noch nicht buchen'}</h3>
      <p className="mt-1 text-muted-foreground">{document.reviewState === 'DISMISSED' ? 'Der Beleg ist aus der offenen Prüfung genommen. Das Original bleibt unverändert erhalten. Wieder öffnen startet keine Buchung.' : document.linkedExpenseId !== null ? `Dieser Beleg ist mit Ausgabe #${document.linkedExpenseId} verknüpft.` : 'Die Ausgabenerfassung aus diesem Beleg ist in dieser Version noch nicht verfügbar. Upload, Auslesen und Prüfung erzeugen keine Ausgabe und keine Zahlung.'}</p>
      {!document.approvalSupported && preview && <p className="mt-2 text-muted-foreground">Dieser Beleg ist außerdem nicht für die spätere unterstützte Ausgabenerfassung freigegeben. Bitte die Prüfhinweise beachten; das Original bleibt erhalten.</p>}
    </section>
  </>;
}

export function IncomingDocumentReview({ id, onClose, onChanged, onOpen, returnFocus }: { id: number; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void; returnFocus: () => void }) {
  const [document, setDocument] = useState<IncomingDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<ReviewAction | 'download' | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null); setActionError(null);
    incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${id}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDocument(result.document); })
      .catch(error => { if (!controller.signal.aborted) setLoadError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, refresh]);
  async function mutate(action: ReviewAction) {
    if (!document || busyRef.current) return;
    busyRef.current = true; setBusy(action); setActionError(null);
    try {
      const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: document.revision, ...(action === 'dismiss' ? { reason: reason.trim() } : {}) }) });
      onChanged();
      if (alive.current) { setDocument(result.document); setDismissOpen(false); setReason(''); title.current?.focus({ preventScroll: true }); }
    } catch (error) { if (alive.current) setActionError(errorMessage(error)); }
    finally { busyRef.current = false; if (alive.current) setBusy(null); }
  }
  async function downloadOriginal() {
    if (!document || busyRef.current) return;
    busyRef.current = true; setBusy('download'); setActionError(null);
    try {
      const response = await fetch(`/api/purchase-documents/${id}/original`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw incomingResponseError(response.status, await response.json().catch(() => null));
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = document.originalRef.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (alive.current) setActionError(errorMessage(error)); }
    finally { busyRef.current = false; if (alive.current) setBusy(null); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-5 sm:max-w-2xl sm:p-6" onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus({ preventScroll: true }); }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}>
      <DialogHeader className="mb-5 min-w-0 pr-9 text-left">
        <DialogTitle ref={title} tabIndex={-1} className="flex items-center gap-2 leading-snug outline-none"><FileText className="size-5 shrink-0" aria-hidden="true" />Eingangsbeleg prüfen</DialogTitle>
        <DialogDescription className="break-all">{document?.originalRef.fileName ?? `Beleg #${id}`} · Original und ausgelesene Vorschau</DialogDescription>
      </DialogHeader>
      {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Beleg wird geladen…</p> : loadError ? <div role="alert" className="space-y-3 py-4"><p>{loadError}</p><Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Erneut laden</Button></div> : document && <>
        <SourcePreview document={document} onOpen={onOpen} />
        <section aria-label="Originaldatei" className="border-y border-border py-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold">Unverändertes Original</h3><p className="mt-1 text-xs text-muted-foreground">{document.originalRef.mediaType === 'application/pdf' ? 'PDF' : 'XML'} · {formatFileSize(document.originalRef.bytes)} · Eingang {formatSourceDate(document.originalRef.uploadedAt)}</p></div><Button variant="outline" disabled={!!busy} onClick={downloadOriginal}>{busy === 'download' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}Original herunterladen</Button></div>
          <details className="mt-3 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-ring">Datei-Prüfsumme (SHA-256)</summary><p className="break-all font-mono">{document.originalRef.sha256}</p></details>
        </section>
        {actionError && <div role="alert" className="mt-4 space-y-2 rounded-md bg-critical-surface p-3 text-sm text-critical-foreground"><p>{actionError}</p><Button variant="outline" disabled={!!busy} onClick={() => setRefresh(value => value + 1)}>Beleg neu laden</Button></div>}
        <div className="flex flex-wrap gap-2 pt-4">
          {document.reviewState === 'REVIEW' && <>
            {document.parseStatus !== 'PARSED' && <Button variant="outline" disabled={!!busy} onClick={() => mutate('retry-parse')}><RotateCcw className={`size-4 ${busy === 'retry-parse' ? 'animate-spin' : ''}`} aria-hidden="true" />Auslesen wiederholen</Button>}
            {!dismissOpen && <Button variant="ghost" disabled={!!busy} onClick={() => setDismissOpen(true)}><ArchiveX className="size-4" aria-hidden="true" />Beleg verwerfen</Button>}
          </>}
          {document.reviewState === 'DISMISSED' && <Button variant="outline" disabled={!!busy} onClick={() => mutate('reopen')}><RotateCcw className={`size-4 ${busy === 'reopen' ? 'animate-spin' : ''}`} aria-hidden="true" />Wieder öffnen</Button>}
          <Button variant="ghost" disabled={!!busy} onClick={() => setRefresh(value => value + 1)}>Neu laden</Button>
        </div>
        {document.dismissalReason && <p className="mt-3 break-words text-sm text-muted-foreground">Verwerfungsgrund: {document.dismissalReason}</p>}
        {dismissOpen && document.reviewState === 'REVIEW' && <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={event => { event.preventDefault(); if (reason.trim()) mutate('dismiss'); }}>
          <Label htmlFor="incoming-dismiss-reason">Warum wird dieser Beleg verworfen?</Label>
          <Input id="incoming-dismiss-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required disabled={!!busy} autoFocus aria-describedby="incoming-dismiss-help" />
          <p id="incoming-dismiss-help" className="text-xs text-muted-foreground">Der Beleg verlässt die offene Prüfung. Original und Vorschau bleiben erhalten; es wird nichts gebucht oder gelöscht.</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={!!busy || !reason.trim()}>{busy === 'dismiss' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Verwerfen bestätigen</Button><Button type="button" variant="ghost" disabled={!!busy} onClick={() => { setDismissOpen(false); setReason(''); title.current?.focus({ preventScroll: true }); }}>Abbrechen</Button></div>
        </form>}
      </>}
    </DialogContent>
  </Dialog>;
}
