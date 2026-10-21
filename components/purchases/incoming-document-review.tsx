'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertTriangle, ArchiveX, Download, FileText, Info, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ParsedEInvoiceParty } from '@/lib/e-invoice-parser';
import type { IncomingDocument, IncomingDocumentResponse, PurchaseExpenseApprovalResponse } from '@/lib/purchase-documents/types';
import { IncomingAiExtraction } from './incoming-ai-extraction';
import { IncomingPhotoPreview } from './incoming-photo-preview';
import { IncomingReviewDraft, IncomingSavedDraft } from './incoming-review-draft';
import { SupplierContactPanel } from './supplier-contact-panel';
import { PurchaseExpenseApproval } from './purchase-expense-approval';
import { approvalBlockedReason, hasApprovalIdentity } from './purchase-expense-ui';
import { errorMessage, extractionLabel, formatFileSize, formatSourceAmount, formatSourceDate, incomingJson, incomingResponseError, isReviewMutationBlocked, reviewLabel, type ReviewAction } from './incoming-document-ui';

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
    <p className="border-b border-border pb-4 text-xs text-muted-foreground">Ausgelesene Angaben am Original prüfen.</p>
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
    {document.parseStatus !== 'PARSED' && <div className="mb-4 flex gap-2 rounded-md bg-caution-surface p-3 text-sm text-caution-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>{document.originalRef.mediaType.startsWith('image/') ? 'Foto gespeichert. Angaben im Prüfentwurf ergänzen; anschließend Original und Zahlung bestätigen.' : document.parseStatus === 'PENDING' ? 'Das Auslesen ist noch ausstehend. Bitte neu laden oder das Auslesen erneut starten.' : document.parseErrorCode === 'NO_EMBEDDED_XML' ? 'Kein eingebettetes XML. Original erhalten; manuell prüfen oder KI nutzen.' : 'Die Rechnungsdaten konnten nicht ausgelesen werden. Das Original bleibt erhalten; bitte manuell prüfen.'}</p></div>}
    {document.parserWarnings.length > 0 && <section aria-labelledby="incoming-warning-heading" className="mb-4 border-l-2 border-caution pl-3">
      <h3 id="incoming-warning-heading" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 shrink-0 text-caution" aria-hidden="true" />Prüfhinweise</h3>
      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">{document.parserWarnings.map((warning, index) => <li key={`${warning.code}-${index}`} className="break-words">{warning.message}</li>)}</ul>
    </section>}
    {document.businessDuplicates.length > 0 && <section className="mb-4" aria-label="Mögliche fachliche Dubletten">
      <h3 className="text-sm font-semibold">Ähnliche Belege prüfen</h3><p className="mt-1 text-xs text-muted-foreground">Lieferant und Rechnungsnummer stimmen überein; mögliche Dublette.</p>
      <ul className="mt-2 divide-y divide-border">{document.businessDuplicates.map(duplicate => <li key={duplicate.id}><Button variant="link" className="h-auto min-h-11 max-w-full justify-start whitespace-normal px-0 text-left" onClick={() => onOpen(duplicate.id)}>Beleg #{duplicate.id} · {duplicate.invoiceNumber || 'Ohne Rechnungsnummer'} · {formatSourceAmount(duplicate.totalAmount, duplicate.currency)}</Button></li>)}</ul>
    </section>}
    <section className="border-t border-border py-4 text-sm" aria-label="Nächster Schritt">
      <h3 className="font-semibold">{document.reviewState === 'DISMISSED' ? 'Original aufbewahrt' : document.linkedExpenseId !== null ? 'Mit Ausgabe verknüpft' : 'Prüfen, nicht automatisch buchen'}</h3>
      <p className="mt-1 text-muted-foreground">{document.reviewState === 'DISMISSED' ? 'Der Beleg ist aus der offenen Prüfung genommen. Das Original bleibt unverändert erhalten. Wieder öffnen startet keine Buchung.' : document.linkedExpenseId !== null ? `Dieser Beleg ist mit Ausgabe #${document.linkedExpenseId} verknüpft. Keine zweite Buchung starten.` : 'Original, Empfänger und vollständige Zahlung prüfen. Erst danach als Ausgabe bestätigen.'}</p>
      {document.linkedExpenseId !== null && <Link className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" href={`/expenses/${document.linkedExpenseId}`}>Gespeicherte Ausgabe #{document.linkedExpenseId} ansehen</Link>}
      {!document.approvalSupported && document.reviewState === 'REVIEW' && <p className="mt-2 text-caution-foreground">{approvalBlockedReason(document)}</p>}
    </section>
  </>;
}

export function IncomingDocumentReview({ id, onClose, onChanged, onOpen, returnFocus }: { id: number; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void; returnFocus: () => void }) {
  const { data: session } = useSession();
  const tenantId = session?.user?.id;
  const [document, setDocument] = useState<IncomingDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<ReviewAction | 'download' | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [view, setView] = useState<'source' | 'supplier' | 'approval'>('source');
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const [hasPending, setHasPending] = useState(false);
  const [approved, setApproved] = useState<PurchaseExpenseApprovalResponse | null>(null);
  const contactTrigger = useRef<HTMLButtonElement>(null);
  const approvalTrigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const reviewError = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (loadError || actionError) reviewError.current?.focus(); }, [loadError, actionError]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null); setActionError(null);
    incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${id}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setDocument(result.document);
        try {
          if (result.document.linkedExpenseId !== null) setHasPending(false);
          else if (tenantId && hasApprovalIdentity(sessionStorage, tenantId, id)) setHasPending(true);
        } catch { /* Storage may be unavailable; approval will explain before sending. */ }
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, refresh, tenantId]);
  async function mutate(action: ReviewAction) {
    if (!document || isReviewMutationBlocked({ busy: busyRef.current || aiBusy, draftDirty, draftBusy, hasPending })) return;
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
  function returnToSource(target: 'supplier' | 'approval') {
    setView('source');
    requestAnimationFrame(() => { const trigger = target === 'supplier' ? contactTrigger.current : approvalTrigger.current; if (trigger && !trigger.disabled) trigger.focus(); else title.current?.focus(); });
  }
  function didApprove(result: PurchaseExpenseApprovalResponse) {
    if (!alive.current) return;
    setDocument(result.document); setApproved(result); setHasPending(false); setView('source'); onChanged();
    requestAnimationFrame(() => title.current?.focus());
  }
  const mutationBlocked = isReviewMutationBlocked({ busy: !!busy || aiBusy, draftDirty, draftBusy, hasPending });
  return <Dialog open onOpenChange={open => { if (!open && !approvalBusy && !draftBusy && !busy && (!draftDirty || window.confirm('Ungespeicherte Prüfnotizen verwerfen? Es wird nichts still gespeichert.'))) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-5 sm:max-w-2xl sm:p-6" showCloseButton={!approvalBusy && !draftBusy && !busy} onEscapeKeyDown={event => { if (approvalBusy || draftBusy || busy) event.preventDefault(); }} onInteractOutside={event => { if (approvalBusy || draftBusy || busy) event.preventDefault(); }} onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus({ preventScroll: true }); }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}>
      <DialogHeader className="mb-5 min-w-0 pr-9 text-left">
        <DialogTitle ref={title} tabIndex={-1} className="flex items-center gap-2 leading-snug outline-none"><FileText className="size-5 shrink-0" aria-hidden="true" />Eingangsbeleg prüfen</DialogTitle>
        <DialogDescription className="break-all">{document?.originalRef.fileName ?? `Beleg #${id}`}</DialogDescription>
      </DialogHeader>
      {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Beleg wird geladen…</p> : loadError ? <div ref={reviewError} tabIndex={-1} role="alert" className="space-y-3 py-4"><p>{loadError}</p><Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Erneut laden</Button></div> : document && <>
        {view === 'source' && <>
          {hasPending && <div role="status" className="mb-4 space-y-2 border-l-2 border-caution pl-3 text-sm"><p>Eine frühere Buchungsanfrage könnte ungeklärt sein. Angezeigt ist der neu abgefragte Belegstatus. Nicht parallel manuell buchen; Angaben zur sicheren Wiederholung erneut bewusst prüfen.</p><Button variant="outline" onClick={() => setView('approval')}>Buchungsangaben erneut prüfen / sicher wiederholen</Button></div>}
          {approved && <div role="status" className="mb-4 border-l-2 border-primary pl-3 text-sm"><p className="font-semibold">Ausgabe #{approved.expense.id} gespeichert · keine erneute Buchung nötig.</p><p className="mt-1">Erfasstes Zahlungsdatum: {formatSourceDate(typeof approved.expense.date === 'string' ? approved.expense.date : approved.expense.date.toISOString())}. Die Belegliste wird aktualisiert; ein Ladefehler macht die Buchung nicht rückgängig.</p><Link href={`/expenses/${approved.expense.id}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">Gespeicherte Ausgabe ansehen</Link></div>}
          {document.originalRef.mediaType.startsWith('image/') && <IncomingPhotoPreview document={document} />}
          {document.reviewedSourceSnapshot && <section aria-label="Bestätigte manuelle Foto-Originalprüfung" className="mb-5 rounded-lg border border-primary/40 p-4 text-sm"><h3 className="font-semibold">Bestätigte manuelle Foto-Originalprüfung · keine automatische Buchung</h3><p className="mt-2">{document.reviewedSourceSnapshot.supplierName} · Rechnung {document.reviewedSourceSnapshot.invoiceNumber} vom {formatSourceDate(document.reviewedSourceSnapshot.invoiceDate)}</p><p className="mt-2">{formatSourceAmount(document.reviewedSourceSnapshot.grossAmount, 'EUR')} · tatsächliches Zahlungsdatum {formatSourceDate(document.reviewedSourceSnapshot.paymentDate)}</p><p className="mt-2 break-words">Käufer: {document.reviewedSourceSnapshot.buyerName}. Betrieblicher Zweck: {document.reviewedSourceSnapshot.businessPurpose}.</p><p className="mt-2 text-xs text-muted-foreground">Unveränderlicher bestätigter Quellen-Snapshot. Keine Bank-, Identitäts- oder steuerliche Konformitätsprüfung. Die verknüpfte Ausgabe ist die einzige Buchung.</p></section>}
          {document.reviewState !== 'REVIEW' && document.reviewDraft && <IncomingSavedDraft document={document} />}
          <IncomingAiExtraction document={document} locked={draftDirty || draftBusy || !!busy || approvalBusy || dismissOpen || hasPending} onBusyChange={setAiBusy} onDocument={updated => { setDocument(updated); setDraftGeneration(value => value + 1); onChanged(); }} onRefresh={() => { if (!draftDirty && !draftBusy) { setDraftGeneration(value => value + 1); setRefresh(value => value + 1); } }} />
          {document.reviewState === 'REVIEW' && <details open={document.originalRef.mediaType.startsWith('image/') || Boolean(document.reviewDraftSavedAt)} className="mb-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Prüfentwurf</summary><IncomingReviewDraft key={draftGeneration} document={document} locked={dismissOpen || !!busy || aiBusy || approvalBusy || hasPending} onSaved={saved => { setDocument(saved); setDraftDirty(false); onChanged(); }} onDirtyChange={setDraftDirty} onBusyChange={setDraftBusy} /></details>}
          <SourcePreview document={document} onOpen={target => { if (!draftBusy && (!draftDirty || window.confirm('Ungespeicherten Prüfentwurf verwerfen?'))) onOpen(target); }} />
          <section aria-label="Gewählter Lieferantenkontakt" className="border-t border-border py-4 text-sm"><h3 className="font-semibold">Lieferantenkontakt</h3>{document.selectedSupplierSnapshot ? <><p className="mt-2 break-words font-medium">{document.selectedSupplierSnapshot.name}</p><p className="mt-1 break-words text-muted-foreground">{[document.selectedSupplierSnapshot.address, document.selectedSupplierSnapshot.postalCode, document.selectedSupplierSnapshot.city, document.selectedSupplierSnapshot.country].filter(Boolean).join(' · ')}</p><p className="mt-2 text-xs text-muted-foreground">Für diesen Beleg gespeichert; Identität und Empfänger ungeprüft.</p></> : <p className="mt-2 text-muted-foreground">Noch nicht zugeordnet.</p>}{document.reviewState === 'REVIEW' && <Button ref={contactTrigger} variant="outline" className="mt-3" disabled={dismissOpen || mutationBlocked} onClick={() => setView('supplier')}>{document.supplierId ? 'Kontakt wechseln / verwalten' : 'Kontakt auswählen / anlegen'}</Button>}</section>
          {document.reviewState === 'REVIEW' && <section className="border-t border-border py-4 text-sm"><h3 className="font-semibold">Vollständig bezahlt und geprüft?</h3><p className="mt-1 text-muted-foreground">Nur bei vollständiger Zahlung als Ausgabe erfassen.</p><Button ref={approvalTrigger} className="mt-3" disabled={dismissOpen || mutationBlocked || !!approvalBlockedReason(document)} onClick={() => setView('approval')}>Als Ausgabe erfassen</Button>{approvalBlockedReason(document) && <p className="mt-2 text-caution-foreground">{approvalBlockedReason(document)}</p>}</section>}
        </>}
        {view === 'supplier' && <SupplierContactPanel document={document} onSelected={selected => { setDocument(selected); onChanged(); returnToSource('supplier'); }} onBack={() => returnToSource('supplier')} />}
        {view === 'approval' && <PurchaseExpenseApproval document={document} onApproved={didApprove} onBack={() => returnToSource('approval')} onReload={() => { setView('source'); setRefresh(value => value + 1); requestAnimationFrame(() => title.current?.focus()); }} onOpenDuplicate={onOpen} onBusyChange={setApprovalBusy} onPendingChange={setHasPending} />}
        <section aria-label="Originaldatei" className="border-y border-border py-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold">Unverändertes Original</h3><p className="mt-1 text-xs text-muted-foreground">{document.originalRef.mediaType === 'image/jpeg' ? 'JPG' : document.originalRef.mediaType === 'image/png' ? 'PNG' : document.originalRef.mediaType === 'application/pdf' ? 'PDF' : 'XML'} · {formatFileSize(document.originalRef.bytes)} · Eingang {formatSourceDate(document.originalRef.uploadedAt)}</p></div><Button variant="outline" disabled={!!busy || draftBusy || approvalBusy} onClick={downloadOriginal}>{busy === 'download' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}Original herunterladen</Button></div>
          <details className="mt-3 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-ring">Datei-Prüfsumme (SHA-256)</summary><p className="break-all font-mono">{document.originalRef.sha256}</p></details>
        </section>
        {actionError && <div ref={reviewError} tabIndex={-1} role="alert" className="mt-4 space-y-2 rounded-md bg-critical-surface p-3 text-sm text-critical-foreground"><p>{actionError}</p><Button variant="outline" disabled={!!busy || draftBusy} onClick={() => { if (!draftDirty || window.confirm('Ungespeicherten Prüfentwurf verwerfen und Beleg neu laden?')) setRefresh(value => value + 1); }}>Beleg neu laden</Button></div>}
        {view === 'source' && <><div className="flex flex-wrap gap-2 pt-4">
          {document.reviewState === 'REVIEW' && <>
            {!document.originalRef.mediaType.startsWith('image/') && document.parseStatus !== 'PARSED' && <Button variant="outline" disabled={!!busy || aiBusy || draftBusy || draftDirty || hasPending} onClick={() => mutate('retry-parse')}><RotateCcw className={`size-4 ${busy === 'retry-parse' ? 'animate-spin' : ''}`} aria-hidden="true" />Auslesen wiederholen</Button>}
            {!dismissOpen && <Button variant="ghost" disabled={!!busy || aiBusy || draftBusy || draftDirty || hasPending} onClick={() => setDismissOpen(true)}><ArchiveX className="size-4" aria-hidden="true" />Beleg verwerfen</Button>}
          </>}
          {document.reviewState === 'DISMISSED' && <Button variant="outline" disabled={!!busy || aiBusy || draftBusy || draftDirty || hasPending} onClick={() => mutate('reopen')}><RotateCcw className={`size-4 ${busy === 'reopen' ? 'animate-spin' : ''}`} aria-hidden="true" />Wieder öffnen</Button>}
          <Button variant="ghost" disabled={!!busy || aiBusy || draftBusy} onClick={() => { if (!draftDirty || window.confirm('Ungespeicherten Prüfentwurf verwerfen und Beleg neu laden?')) setRefresh(value => value + 1); }}>Neu laden</Button>
        </div>
        {document.dismissalReason && <p className="mt-3 break-words text-sm text-muted-foreground">Verwerfungsgrund: {document.dismissalReason}</p>}
        {dismissOpen && document.reviewState === 'REVIEW' && <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={event => { event.preventDefault(); if (!mutationBlocked && reason.trim()) mutate('dismiss'); }}>
          <Label htmlFor="incoming-dismiss-reason">Warum wird dieser Beleg verworfen?</Label>
          <Input id="incoming-dismiss-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required disabled={mutationBlocked} autoFocus aria-describedby="incoming-dismiss-help" />
          <p id="incoming-dismiss-help" className="text-xs text-muted-foreground">Der Beleg verlässt die offene Prüfung. Original, Vorschau und bereits gespeicherter Prüfentwurf bleiben erhalten; es wird nichts gebucht oder gelöscht. Zum Bearbeiten des Entwurfs zuerst Abbrechen wählen.</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={mutationBlocked || !reason.trim()}>{busy === 'dismiss' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Verwerfen bestätigen</Button><Button type="button" variant="ghost" disabled={!!busy} onClick={() => { setDismissOpen(false); setReason(''); title.current?.focus({ preventScroll: true }); }}>Abbrechen</Button></div>
        </form>}</>}
      </>}
    </DialogContent>
  </Dialog>;
}
