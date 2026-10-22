'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileText, Inbox, Loader2, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IncomingDocument, IncomingDocumentList, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { IncomingUpload } from './incoming-upload';
import { IncomingDocumentReview } from './incoming-document-review';
import { captureReviewNavigationSource, createReviewNavigationIntents, createReviewTraversalGuard } from './incoming-review-history';
import { nextReviewDocument, reviewQueueSnapshot, type IncomingNavigationGuard } from './incoming-review-queue';
import { documentIdFromQuery, errorMessage, extractionLabel, formatSourceAmount, formatSourceDate, incomingJson, INCOMING_PAGE_SIZE, reviewLabel, type IncomingFilter } from './incoming-document-ui';

export function IncomingDocumentRow({ document, onOpen }: { document: IncomingDocument; onOpen: (id: number, trigger: HTMLButtonElement) => void }) {
  return <li className="border-t border-border first:border-t-0">
    <button type="button" data-incoming-document-id={document.id} onClick={event => onOpen(document.id, event.currentTarget)} className="grid min-h-24 w-full grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-4 text-left hover:bg-secondary focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.65fr)_minmax(9rem,0.6fr)] sm:items-center sm:px-5">
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
  const { replace } = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = documentIdFromQuery(params.get('document'));
  const queryString = params.toString();
  const [activeId, setActiveId] = useState(selectedId);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const acceptedQuery = useRef(queryString);
  const navigationGuard = useRef<IncomingNavigationGuard | null>(null);
  const navigationIntents = useRef(createReviewNavigationIntents(() => window.location.href));
  const historyGuard = useRef<ReturnType<typeof createReviewTraversalGuard> | null>(null);
  const registerNavigationGuard = useCallback((guard: IncomingNavigationGuard | null) => { navigationGuard.current = guard; }, []);
  const [queue, setQueue] = useState<readonly number[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const queueRequest = useRef<AbortController | null>(null);
  const queueMoving = useRef(false);
  const listScroll = useRef<number | null>(null);
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
  const selectedIdRef = activeIdRef;
  const returnTarget = useRef<HTMLElement | null>(null);
  const returnDocumentId = useRef<number | null>(null);
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

  useEffect(() => {
    // Router snapshots can lag behind the actual destination. No route effect
    // compensates by replacing history: explicit actions are guarded BEFORE navigation.
    if (queryString !== new URLSearchParams(window.location.search).toString() || queryString === acceptedQuery.current) return;
    acceptedQuery.current = queryString;
    navigationIntents.current.invalidate();
    queueRequest.current?.abort(); queueMoving.current = false; setQueueBusy(false); setQueueMessage(null);
    setActiveId(selectedId);
  }, [queryString, selectedId]);
  useLayoutEffect(() => {
    // Traversals cannot be cancelled. Restore/replay their exact index instead
    // of replacing entries (which would silently destroy Back/Forward history).
    const intents = navigationIntents.current;
    const navigation = (window as Window & { navigation?: EventTarget & { currentEntry?: { index: number } } }).navigation;
    const handlePop = createReviewTraversalGuard({
      getIndex: () => navigation?.currentEntry?.index,
      go: delta => window.history.go(delta),
      getGuard: () => navigationGuard.current,
      onReplay: () => {},
    });
    const onPop = (event: PopStateEvent) => {
      intents.invalidate();
      navigationGuard.current?.cancelPending?.();
      queueRequest.current?.abort(); queueMoving.current = false; setQueueBusy(false);
      handlePop(event);
    };
    // The router can publish history after a component's layout effects. Read
    // the actual source at Navigation API's precommit boundary; restorations
    // and deliberate replay keep their controller-owned indexes unchanged.
    const stopCapturingSource = captureReviewNavigationSource(navigation, handlePop);
    historyGuard.current = handlePop;
    window.addEventListener('popstate', onPop, true);
    return () => { window.removeEventListener('popstate', onPop, true); stopCapturingSource(); intents.invalidate(); historyGuard.current = null; };
  }, []);
  useLayoutEffect(() => { historyGuard.current?.syncIndex(); }, [activeId, queryString]);
  useEffect(() => () => queueRequest.current?.abort(), []);
  useEffect(() => {
    if (!queue.length && data && activeId !== null) {
      const snapshot = reviewQueueSnapshot(data);
      if (snapshot.includes(activeId)) setQueue(snapshot);
    }
  }, [queue.length, data, activeId]);

  async function moveInQueue(direction: -1 | 1) {
    if (queueMoving.current || activeIdRef.current === null) return;
    const sourceId = activeIdRef.current; const sourceLocation = window.location.href;
    const controller = new AbortController();
    queueRequest.current?.abort(); queueRequest.current = controller;
    queueMoving.current = true; setQueueBusy(true); setQueueMessage(null);
    try {
      const next = await nextReviewDocument(queue, activeIdRef.current, direction, async id => {
        const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${id}`, { signal: controller.signal });
        return result.document;
      }, controller.signal);
      if (controller.signal.aborted || activeIdRef.current !== sourceId || window.location.href !== sourceLocation) return;
      if (next !== null) commitQuery({ document: String(next) });
      else setQueueMessage(direction === 1 ? 'Ende dieser Prüffolge. Weitere offene Belege findest du in der Liste.' : 'Keine weiteren offenen Belege vor diesem Beleg.');
    } catch (error) { if (!controller.signal.aborted) setQueueMessage(`${errorMessage(error)} Du bleibst bei diesem Beleg; Navigation erneut versuchen.`); }
    finally { if (!controller.signal.aborted) { queueMoving.current = false; setQueueBusy(false); } }
  }

  function requestNavigation(action: () => void) {
    const intent = navigationIntents.current.prepare(action);
    if (activeIdRef.current !== null && navigationGuard.current) navigationGuard.current.request(intent.proceed, intent.stay);
    else intent.proceed();
  }
  function updateQuery(values: Record<string, string | null>) { requestNavigation(() => commitQuery(values)); }
  function prepareNextAfterSave() {
    const sourceId = activeIdRef.current;
    return navigationIntents.current.prepare(() => { if (sourceId !== null && activeIdRef.current === sourceId) void moveInQueue(1); }).proceed;
  }
  function commitQuery(values: Record<string, string | null>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
    replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  function openDocument(id: number, trigger?: HTMLElement) {
    if (trigger) { returnTarget.current = trigger; returnDocumentId.current = id; listScroll.current = window.scrollY; setQueue(data ? reviewQueueSnapshot(data) : []); setQueueMessage(null); }
    else if (!activeId && window.document.activeElement instanceof HTMLElement) { returnTarget.current = window.document.activeElement; listScroll.current = window.scrollY; setQueue([]); }
    updateQuery({ document: String(id) });
  }
  function uploaded(document: IncomingDocument) { setQueue([]); refreshList(); openDocument(document.id); }
  function restoreFocus() {
    if (selectedIdRef.current !== null) return;
    const replacement = returnDocumentId.current === null ? null : window.document.querySelector<HTMLElement>(`[data-incoming-document-id="${returnDocumentId.current}"]`);
    const target = returnTarget.current?.isConnected ? returnTarget.current : replacement ?? listHeading.current;
    target?.focus({ preventScroll: true });
    if (listScroll.current !== null) window.scrollTo({ top: listScroll.current, behavior: 'instant' });
  }
  return <div className="space-y-6">
    <PageHeader title="Belegeingang" />
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
        <Inbox className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">{search ? 'Keine passenden Belege' : filter === 'DISMISSED' ? 'Keine verworfenen Belege' : filter === 'ALL' ? 'Noch keine Eingangsbelege' : 'Keine Belege zur Prüfung'}</h3>{search && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Suche oder Prüfstatus ändern.</p>}
        {search && <Button variant="link" className="mt-2" onClick={() => updateQuery({ search: null, page: null })}>Suche zurücksetzen</Button>}
      </div>}
      {!loading && !loadError && data && (data.total > INCOMING_PAGE_SIZE || page > 1) && <nav aria-label="Belegseiten" className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5"><Button variant="outline" size="icon" aria-label="Vorherige Belegseite" disabled={page <= 1} onClick={() => updateQuery({ page: page === 2 ? null : String(page - 1) })}><ChevronLeft className="size-4" /></Button><p className="text-xs text-muted-foreground">Seite {page} von {Math.max(1, Math.ceil(data.total / data.limit))}</p><Button variant="outline" size="icon" aria-label="Nächste Belegseite" disabled={page * data.limit >= data.total} onClick={() => updateQuery({ page: String(page + 1) })}><ChevronRight className="size-4" /></Button></nav>}
    </section>

    {activeId !== null && <IncomingDocumentReview key={`${session?.user?.id ?? 'signed-out'}:${activeId}`} id={activeId} registerNavigationGuard={registerNavigationGuard} sequence={queue.includes(activeId) ? { position: queue.indexOf(activeId) + 1, count: queue.length, busy: queueBusy, message: queueMessage, canPrevious: queue.indexOf(activeId) > 0, canNext: queue.indexOf(activeId) < queue.length - 1, move: direction => requestNavigation(() => { void moveInQueue(direction); }), prepareNextAfterSave } : undefined} onClose={() => updateQuery({ document: null })} onChanged={() => { setSavedChange(true); refreshList(); }} onOpen={openDocument} returnFocus={restoreFocus} />}
  </div>;
}
