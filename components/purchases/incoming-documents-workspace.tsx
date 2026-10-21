'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileText, Inbox, Loader2, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IncomingDocument, IncomingDocumentList } from '@/lib/purchase-documents/types';
import { IncomingUpload } from './incoming-upload';
import { IncomingDocumentReview } from './incoming-document-review';
import { documentIdFromQuery, errorMessage, extractionLabel, formatSourceAmount, formatSourceDate, incomingJson, INCOMING_PAGE_SIZE, reviewLabel, type IncomingFilter } from './incoming-document-ui';

export function IncomingDocumentRow({ document, onOpen }: { document: IncomingDocument; onOpen: (id: number, trigger: HTMLButtonElement) => void }) {
  return <li className="border-t border-border first:border-t-0">
    <button type="button" onClick={event => onOpen(document.id, event.currentTarget)} className="grid min-h-24 w-full grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-4 text-left hover:bg-secondary focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.65fr)_minmax(9rem,0.6fr)] sm:items-center sm:px-5">
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="break-words font-medium">{document.supplierName || (document.reviewDraft?.supplierName ? `Entwurf: ${document.reviewDraft.supplierName}` : 'Lieferant nicht ausgelesen')}</p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><FileText className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{document.originalRef.fileName}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{document.invoiceNumber ? `Nr. ${document.invoiceNumber}` : document.reviewDraft?.invoiceNumber ? `Entwurf Nr. ${document.reviewDraft.invoiceNumber}` : 'Ohne Rechnungsnummer'} · {document.invoiceDate ? formatSourceDate(document.invoiceDate) : document.reviewDraft?.invoiceDate ? `Entwurfsdatum ${formatSourceDate(document.reviewDraft.invoiceDate)}` : 'Datum nicht ausgelesen'}</p>
      </div>
      <div className="min-w-0 text-xs sm:text-sm"><p className="font-medium">{reviewLabel(document)}</p>{document.reviewDraftSavedAt && <p className="mt-1 font-medium text-primary">Prüfentwurf gespeichert</p>}<p className="mt-1 text-muted-foreground">{extractionLabel(document.parseStatus)}{document.parserWarnings.some(warning => warning.code !== 'NOT_VALIDATED') ? ' · Prüfhinweise' : ''}</p></div>
      <div className="min-w-0 text-right"><p className="break-words text-sm font-semibold tabular-nums">{formatSourceAmount(document.totalAmount, document.currency)}</p><span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">Prüfen <ChevronRight className="size-3.5" aria-hidden="true" /></span></div>
    </button>
  </li>;
}

export function IncomingDocumentsWorkspace() {
  const { data: session } = useSession();
  return <IncomingDocumentsWorkspaceContent key={session?.user?.id ?? 'signed-out'} />;
}
function IncomingDocumentsWorkspaceContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = documentIdFromQuery(params.get('document'));
  const reviewParam = params.get('reviewStatus');
  const filter: IncomingFilter = reviewParam === 'BOOKED' ? 'BOOKED' : reviewParam === 'DISMISSED' ? 'DISMISSED' : reviewParam === 'ALL' ? 'ALL' : 'REVIEW';
  const pageParam = params.get('page');
  const page = pageParam && /^\d+$/.test(pageParam) && Number(pageParam) > 0 && Number(pageParam) <= 100_000 ? Number(pageParam) : 1;
  const search = (params.get('search') ?? '').slice(0, 200);
  const [searchDraft, setSearchDraft] = useState(search);
  const [data, setData] = useState<IncomingDocumentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [savedChange, setSavedChange] = useState(false);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const returnTarget = useRef<HTMLElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const refreshList = () => setRefresh(value => value + 1);
  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: String(INCOMING_PAGE_SIZE) });
    if (filter !== 'ALL') query.set('reviewStatus', filter);
    if (search) query.set('search', search);
    setLoading(true); setLoadError(null);
    incomingJson<IncomingDocumentList>(`/api/purchase-documents?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setData(result); setSavedChange(false); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, filter, search, refresh]);

  function updateQuery(values: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  function openDocument(id: number, trigger?: HTMLElement) {
    if (trigger) returnTarget.current = trigger;
    else if (!selectedId && window.document.activeElement instanceof HTMLElement) returnTarget.current = window.document.activeElement;
    updateQuery({ document: String(id) });
  }
  function uploaded(document: IncomingDocument) { refreshList(); openDocument(document.id); }
  function restoreFocus() {
    if (selectedIdRef.current !== null) return;
    const target = returnTarget.current?.isConnected ? returnTarget.current : listHeading.current;
    target?.focus({ preventScroll: true });
  }
  return <div className="space-y-6">
    <PageHeader section="Einkauf" title="Belegeingang" description="Eingehende Originale sammeln und prüfen. Getrennt von deinen Ausgangsrechnungen — ohne automatische Buchung." />
    <IncomingUpload onUploaded={uploaded} onOpen={openDocument} onRefresh={refreshList} />
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="incoming-list-heading" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div><h2 ref={listHeading} tabIndex={-1} id="incoming-list-heading" className="font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">{filter === 'REVIEW' ? 'Offene Prüfung' : filter === 'BOOKED' ? 'Als Ausgabe erfasste Belege' : filter === 'DISMISSED' ? 'Verworfene Belege' : 'Alle Eingangsbelege'}</h2><p className="mt-1 text-xs text-muted-foreground">{loading ? 'Belege werden geladen…' : loadError ? 'Belege konnten nicht geladen werden' : `${data?.total ?? 0} Belege${search ? ' zur Suche' : ''}`} · neueste zuerst</p></div>
        <Button variant="outline" size="icon" disabled={loading} onClick={refreshList} aria-label="Belegeingang aktualisieren"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></Button>
      </div>
      <form className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-end sm:px-5" role="search" aria-label="Eingangsbelege durchsuchen" onSubmit={event => { event.preventDefault(); updateQuery({ search: searchDraft.trim() || null, page: null, document: null }); }}>
        <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="incoming-search">Lieferant, Rechnungsnummer oder Dateiname</Label><div className="flex gap-2"><Input id="incoming-search" type="search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} maxLength={200} placeholder="Belege durchsuchen" /><Button variant="outline" type="submit" aria-label="Belege suchen"><Search className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Suchen</span></Button></div></div>
        <div className="space-y-2"><Label htmlFor="incoming-filter">Prüfstatus</Label><select id="incoming-filter" value={filter} onChange={event => updateQuery({ reviewStatus: event.target.value === 'REVIEW' ? null : event.target.value, page: null, document: null })} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-48"><option value="REVIEW">Zu prüfen</option><option value="BOOKED">Als Ausgabe erfasst</option><option value="DISMISSED">Verworfen</option><option value="ALL">Alle Belege</option></select></div>
      </form>
      {loading ? <p role="status" className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Belege werden geladen…</p> : loadError ? <div role="alert" className="space-y-3 p-5"><p className="text-sm text-critical-foreground">{savedChange ? `Die Änderung wurde gespeichert, aber die Belegliste konnte nicht aktualisiert werden. Keine erneute Buchung starten. ${loadError}` : loadError}</p><Button variant="outline" onClick={refreshList}>Erneut versuchen</Button></div> : data?.documents.length ? <ul aria-label="Eingangsbelege">{data.documents.map(document => <IncomingDocumentRow key={document.id} document={document} onOpen={openDocument} />)}</ul> : <div className="px-5 py-10 text-center">
        <Inbox className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">{search ? 'Keine passenden Belege' : filter === 'DISMISSED' ? 'Keine verworfenen Belege' : filter === 'ALL' ? 'Dein Belegeingang ist noch leer' : 'Keine Belege zur Prüfung'}</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{search ? 'Bitte den Suchbegriff oder Prüfstatus ändern. Gesucht wird nach Lieferant, Rechnungsnummer und Dateiname.' : 'Lade oben ein Foto-, PDF- oder XML-Original hoch. Es bleibt unverändert erhalten und wird nicht automatisch als Ausgabe erfasst.'}</p>
        {search && <Button variant="link" className="mt-2" onClick={() => updateQuery({ search: null, page: null })}>Suche zurücksetzen</Button>}
      </div>}
      {!loading && !loadError && data && (data.total > INCOMING_PAGE_SIZE || page > 1) && <nav aria-label="Belegseiten" className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5"><Button variant="outline" size="icon" aria-label="Vorherige Belegseite" disabled={page <= 1} onClick={() => updateQuery({ page: page === 2 ? null : String(page - 1) })}><ChevronLeft className="size-4" /></Button><p className="text-xs text-muted-foreground">Seite {page} von {Math.max(1, Math.ceil(data.total / data.limit))}</p><Button variant="outline" size="icon" aria-label="Nächste Belegseite" disabled={page * data.limit >= data.total} onClick={() => updateQuery({ page: String(page + 1) })}><ChevronRight className="size-4" /></Button></nav>}
    </section>
    <p className="text-xs text-muted-foreground">Dieser Belegeingang zeigt Originale und ungeprüfte Extraktionsdaten. Keine Konformitätsprüfung, keine Zahlung und keine automatische Übernahme in die Buchhaltung.</p>
    {selectedId !== null && <IncomingDocumentReview key={`${session?.user?.id ?? 'signed-out'}:${selectedId}`} id={selectedId} onClose={() => updateQuery({ document: null })} onChanged={() => { setSavedChange(true); refreshList(); }} onOpen={openDocument} returnFocus={restoreFocus} />}
  </div>;
}
