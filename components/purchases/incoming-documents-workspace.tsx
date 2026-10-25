'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileText, FileUp, Inbox, Loader2, RefreshCw, Search } from 'lucide-react';
import styles from './document-workspace.module.css';
import taskStyles from './supplier-tasks.module.css';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IncomingDocument, IncomingDocumentList, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { IncomingUpload } from './incoming-upload';
import { IncomingDocumentReview } from './incoming-document-review';
import { SUPPLIER_TASK_LABELS } from './supplier-task-panel';
import { bindReviewGuardIntents, createReviewNavigationIntents, createReviewTraversalGuard, reviewNavigationDispatcher, reviewPopDispatcher, reviewSessionKey } from './incoming-review-history';
import { nextReviewDocument, reviewQueueSnapshot, type IncomingNavigationGuard } from './incoming-review-queue';
import { documentIdFromQuery, errorMessage, extractionLabel, formatSourceAmount, formatSourceDate, incomingJson, INCOMING_PAGE_SIZE, reviewLabel, type IncomingFilter } from './incoming-document-ui';

export function IncomingDocumentRow({ document, onOpen }: { document: IncomingDocument; onOpen: (id: number, trigger: HTMLButtonElement) => void }) {
  return <li className={styles.record}>
    <button type="button" data-incoming-document-id={document.id} onClick={event => onOpen(document.id, event.currentTarget)} className={styles.recordButton}>
      <div className={styles.identity}>
        <p className="break-words font-medium">{document.supplierName || (document.reviewDraft?.supplierName ? `Entwurf: ${document.reviewDraft.supplierName}` : 'Lieferant nicht ausgelesen')}</p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><FileText className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{document.originalRef.fileName}</span></p>
        <p className={styles.recordMeta}><span>{document.invoiceNumber ? `Nr. ${document.invoiceNumber}` : document.reviewDraft?.invoiceNumber ? `Entwurf Nr. ${document.reviewDraft.invoiceNumber}` : 'Ohne Rechnungsnummer'}</span><span>{document.invoiceDate ? formatSourceDate(document.invoiceDate) : document.reviewDraft?.invoiceDate ? `Entwurfsdatum ${formatSourceDate(document.reviewDraft.invoiceDate)}` : 'Datum nicht ausgelesen'}</span></p>
      </div>
      <div className={styles.reviewState}><p className="font-medium">{reviewLabel(document)}</p>{document.reviewDraftSavedAt && <p className="mt-1 font-medium text-primary">Prüfentwurf gespeichert</p>}<p className="mt-1 text-muted-foreground">{extractionLabel(document.parseStatus)}{document.parserWarnings.some(warning => warning.code !== 'NOT_VALIDATED') ? ' · Prüfhinweise' : ''}</p>{document.supplierTask && <p className={taskStyles.summary}>{SUPPLIER_TASK_LABELS[document.supplierTask.kind]} · {document.supplierTask.followUpDate ? `Wiedervorlage ${formatSourceDate(document.supplierTask.followUpDate)}` : 'Ohne Datum'}{document.reviewState !== 'REVIEW' ? ' · inaktiv' : document.supplierTask.confirmationRequired ? ' · erneut bestätigen' : ''}</p>}</div>
      <div className={styles.recordAmount}><p className="break-words text-sm font-semibold tabular-nums">{formatSourceAmount(document.totalAmount, document.currency)}</p>{document.totalAmount !== null && <p className="mt-1 text-xs text-muted-foreground">Laut Original · ungeprüft</p>}<span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">Prüfen <ChevronRight className="size-3.5" aria-hidden="true" /></span></div>
    </button>
  </li>;
}

export function IncomingDocumentsWorkspace() {
  const { data: session, status } = useSession();
  return <IncomingDocumentsWorkspaceContent key={reviewSessionKey(session, status)} />;
}
function IncomingDocumentsWorkspaceContent() {
  const { data: session, status } = useSession();
  const sessionKey = reviewSessionKey(session, status);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const alive = useRef(false);
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
  const navigationIntents = useRef(createReviewNavigationIntents(() => window.location.href, () => alive.current && currentSession.current === sessionKey));
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
  const taskKindParam = params.get('taskKind');
  const taskKind = taskKindParam && ['any', 'PAYMENT_CHECK', 'DIRECT_DEBIT_WAIT', 'CLARIFY'].includes(taskKindParam) ? taskKindParam : 'all';
  const taskDueParam = params.get('taskDue');
  const taskDue = taskDueParam && ['due', 'later', 'undated'].includes(taskDueParam) ? taskDueParam : 'any';
  const tasksFiltered = taskKind !== 'all' || taskDue !== 'any';
  const [searchDraft, setSearchDraft] = useState(search);
  const [data, setData] = useState<IncomingDocumentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [savedChange, setSavedChange] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const selectedIdRef = activeIdRef;
  const returnTarget = useRef<HTMLElement | null>(null);
  const returnDocumentId = useRef<number | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const refreshList = () => setRefresh(value => value + 1);
  const requestNavigation = useCallback((action: () => void) => {
    const sourceId = activeIdRef.current;
    const intent = navigationIntents.current.prepare(() => { if (activeIdRef.current === sourceId) action(); });
    if (activeIdRef.current !== null && navigationGuard.current) navigationGuard.current.request(intent.proceed, intent.stay);
    else intent.proceed();
  }, []);
  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: String(INCOMING_PAGE_SIZE) });
    if (filter !== 'ALL') query.set('reviewStatus', filter);
    if (search) query.set('search', search);
    if (taskKind !== 'all') query.set('taskKind', taskKind);
    if (taskDue !== 'any') query.set('taskDue', taskDue);
    setLoading(true); setLoadError(null);
    incomingJson<IncomingDocumentList>(`/api/purchase-documents?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setData(result); setSavedChange(false); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, filter, search, taskKind, taskDue, refresh]);

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
    alive.current = true;
    const intents = navigationIntents.current;
    const unregisterNavigation = reviewNavigationDispatcher.register(requestNavigation);
    const navigation = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation;
    const handlePop = createReviewTraversalGuard({
      getIndex: () => navigation?.currentEntry?.index,
      go: delta => window.history.go(delta),
      getGuard: () => bindReviewGuardIntents(navigationGuard.current, intents),
      onReplay: () => {},
    });
    const onPop = (event: PopStateEvent) => {
      intents.invalidate();
      navigationGuard.current?.cancelPending?.();
      queueRequest.current?.abort(); queueMoving.current = false; setQueueBusy(false);
      handlePop(event);
    };
    historyGuard.current = handlePop;
    // Root's stable listener precedes Next's router listener. A route-owned
    // listener can otherwise be removed by synchronous router teardown before
    // its callback runs, losing the dirty review before a choice is possible.
    const unregisterPop = reviewPopDispatcher.register(onPop);
    return () => { alive.current = false; unregisterNavigation(); unregisterPop(); intents.invalidate(); historyGuard.current = null; };
  }, [requestNavigation]);
  useLayoutEffect(() => { historyGuard.current?.syncIndex(); }, [activeId, queryString]);
  useEffect(() => () => queueRequest.current?.abort(), []);
  useEffect(() => {
    if (!queue.length && data && activeId !== null) {
      const snapshot = reviewQueueSnapshot(data);
      if (snapshot.includes(activeId)) setQueue(snapshot);
    }
  }, [queue.length, data, activeId]);

  function requestQueueMove(direction: -1 | 1) {
    // A second click can precede the disabled-state commit. It is not a new
    // intent: preparing it would invalidate the request already in flight.
    if (queueMoving.current) return;
    requestNavigation(() => { void moveInQueue(direction); });
  }
  async function moveInQueue(direction: -1 | 1) {
    if (queueMoving.current || activeIdRef.current === null) return;
    const sourceId = activeIdRef.current; const sourceLocation = window.location.href;
    const stillCurrent = navigationIntents.current.checkpoint();
    const controller = new AbortController();
    queueRequest.current?.abort(); queueRequest.current = controller;
    queueMoving.current = true; setQueueBusy(true); setQueueMessage(null);
    try {
      const next = await nextReviewDocument(queue, activeIdRef.current, direction, async id => {
        const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${id}`, { signal: controller.signal });
        return result.document;
      }, controller.signal);
      if (controller.signal.aborted || !stillCurrent() || activeIdRef.current !== sourceId || window.location.href !== sourceLocation) return;
      if (next !== null) commitQuery({ document: String(next) });
      else setQueueMessage(direction === 1 ? 'Ende dieser Prüffolge. Weitere offene Belege findest du in der Liste.' : 'Keine weiteren offenen Belege vor diesem Beleg.');
    } catch (error) { if (!controller.signal.aborted && stillCurrent()) setQueueMessage(`${errorMessage(error)} Du bleibst bei diesem Beleg; Navigation erneut versuchen.`); }
    finally { if (!controller.signal.aborted) { queueMoving.current = false; setQueueBusy(false); } }
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
  return <div className={styles.workspace}>
    <PageHeader title="Belegeingang" actions={<Button disabled={uploadBusy} aria-expanded={uploadOpen} aria-controls="incoming-upload-panel" onClick={() => setUploadOpen(open => !open)}><FileUp className="size-4" aria-hidden="true" />{uploadBusy ? 'Originale werden gespeichert…' : uploadOpen ? 'Upload ausblenden' : 'Original hinzufügen'}</Button>} />
    <div id="incoming-upload-panel" hidden={!uploadOpen}>
      <IncomingUpload onUploaded={uploaded} onOpen={openDocument} onRefresh={refreshList} onBusyChange={setUploadBusy} />
    </div>
    <section className={styles.panel} aria-labelledby="incoming-list-heading" aria-busy={loading}>
      <div className={styles.listHeading}>
        <div><h2 ref={listHeading} tabIndex={-1} id="incoming-list-heading" className="font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">{tasksFiltered ? 'Vorgemerkte Lieferantenaufgaben' : filter === 'REVIEW' ? 'Offene Prüfung' : filter === 'BOOKED' ? 'Als Ausgabe erfasste Belege' : filter === 'DISMISSED' ? 'Verworfene Belege' : 'Alle Eingangsbelege'}</h2><p className="mt-1 text-xs text-muted-foreground">{loading ? 'Belege werden geladen…' : loadError ? 'Belege konnten nicht geladen werden' : `${data?.total ?? 0} Belege${search ? ' zur Suche' : ''}`} <span className={styles.sortNote}>{tasksFiltered ? 'Wiedervorlagetag zuerst · ohne Datum zuletzt' : 'Neueste zuerst'}</span></p></div>
        <Button variant="outline" size="icon" disabled={loading} onClick={refreshList} aria-label="Belegeingang aktualisieren"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></Button>
      </div>
      <form className={styles.toolbar} role="search" aria-label="Eingangsbelege durchsuchen" onSubmit={event => { event.preventDefault(); updateQuery({ search: searchDraft.trim() || null, page: null, document: null }); }}>
        <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="incoming-search">Lieferant, Rechnungsnummer oder Dateiname</Label><div className="flex gap-2"><Input id="incoming-search" type="search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} maxLength={200} placeholder="Belege durchsuchen" /><Button variant="outline" type="submit" aria-label="Belege suchen"><Search className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Suchen</span></Button></div></div>
        <div className="space-y-2"><Label htmlFor="incoming-filter">Prüfstatus</Label><select id="incoming-filter" value={filter} onChange={event => updateQuery({ reviewStatus: event.target.value === 'REVIEW' ? null : event.target.value, taskKind: null, taskDue: null, page: null, document: null })} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-48"><option value="REVIEW">Zu prüfen</option><option value="BOOKED">Als Ausgabe erfasst</option><option value="DISMISSED">Verworfen</option><option value="ALL">Alle Belege</option></select></div>
      </form>
      <div className={taskStyles.filters} aria-label="Lieferantenaufgaben filtern">
        <div className={taskStyles.field}><Label htmlFor="incoming-task-kind">Aufgabenart filtern</Label><select id="incoming-task-kind" className={taskStyles.select} value={taskKind} onChange={event => updateQuery({ taskKind: event.target.value === 'all' ? null : event.target.value, reviewStatus: null, page: null, document: null })}><option value="all">Kein Aufgabenartfilter</option><option value="any">Alle aktiven Aufgaben</option>{Object.entries(SUPPLIER_TASK_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></div>
        <div className={taskStyles.field}><Label htmlFor="incoming-task-due">Wiedervorlage filtern</Label><select id="incoming-task-due" className={taskStyles.select} value={taskDue} onChange={event => updateQuery({ taskDue: event.target.value === 'any' ? null : event.target.value, reviewStatus: null, page: null, document: null })}><option value="any">Alle Wiedervorlagetage</option><option value="due">Heute/fällig</option><option value="later">Später</option><option value="undated">Ohne Datum</option></select></div>
        <p className={taskStyles.filterHelp}>{tasksFiltered ? `Nur ausdrücklich bestätigte Aufgaben an offenen REVIEW-Belegen. Heute/fällig umfasst überfällige Tage. Server-Kalendertag Europe/Berlin: ${data?.supplierTaskToday ? formatSourceDate(data.supplierTaskToday) : 'wird geladen'}.` : 'Interne Vormerkungen, keine Zahlungszustände. Aufgabenfilter zeigen nur bestätigte offene Aufgaben; keine automatische Aufgabe aus einem ungezahlten Beleg.'}</p>
      </div>
      {loading ? <p role="status" className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Belege werden geladen…</p> : loadError ? <div role="alert" className="space-y-3 p-5"><p className="text-sm text-critical-foreground">{savedChange ? `Die Änderung wurde gespeichert, aber die Belegliste konnte nicht aktualisiert werden. Keine erneute Buchung starten. ${loadError}` : loadError}</p><Button variant="outline" onClick={refreshList}>Erneut versuchen</Button></div> : data?.documents.length ? <><div className={styles.columnHeadings} aria-hidden="true"><span>Beleg / Lieferant</span><span>Prüfstatus</span><span>Betrag</span></div><ul aria-label="Eingangsbelege">{data.documents.map(document => <IncomingDocumentRow key={document.id} document={document} onOpen={openDocument} />)}</ul></> : <div className={styles.empty}>
        <Inbox className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">{tasksFiltered ? 'Keine passenden aktiven Aufgaben' : search ? 'Keine passenden Belege' : filter === 'DISMISSED' ? 'Keine verworfenen Belege' : filter === 'ALL' ? 'Noch keine Eingangsbelege' : filter === 'BOOKED' ? 'Keine als Ausgabe erfassten Belege' : 'Keine Belege zur Prüfung'}</h3>{(search || tasksFiltered) && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Suche, Aufgabenfilter oder Prüfstatus ändern. Aufgaben ohne Datum bleiben separat.</p>}
        {tasksFiltered && <Button variant="link" className="mt-2" onClick={() => updateQuery({ taskKind: null, taskDue: null, page: null })}>Aufgabenfilter zurücksetzen</Button>}
        {search && <Button variant="link" className="mt-2" onClick={() => updateQuery({ search: null, page: null })}>Suche zurücksetzen</Button>}
      </div>}
      {!loading && !loadError && data && (data.total > INCOMING_PAGE_SIZE || page > 1) && <nav aria-label="Belegseiten" className={styles.pagination}><Button variant="outline" size="icon" aria-label="Vorherige Belegseite" disabled={page <= 1} onClick={() => updateQuery({ page: page === 2 ? null : String(page - 1) })}><ChevronLeft className="size-4" /></Button><p className="text-xs text-muted-foreground">Seite {page} von {Math.max(1, Math.ceil(data.total / data.limit))}</p><Button variant="outline" size="icon" aria-label="Nächste Belegseite" disabled={page * data.limit >= data.total} onClick={() => updateQuery({ page: String(page + 1) })}><ChevronRight className="size-4" /></Button></nav>}
    </section>

    {activeId !== null && <IncomingDocumentReview key={`${session?.user?.id ?? 'signed-out'}:${activeId}`} id={activeId} registerNavigationGuard={registerNavigationGuard} sequence={queue.includes(activeId) ? { position: queue.indexOf(activeId) + 1, count: queue.length, busy: queueBusy, message: queueMessage, canPrevious: queue.indexOf(activeId) > 0, canNext: queue.indexOf(activeId) < queue.length - 1, move: requestQueueMove, prepareNextAfterSave } : undefined} onClose={() => updateQuery({ document: null })} onChanged={() => { setSavedChange(true); refreshList(); }} onOpen={openDocument} returnFocus={restoreFocus} />}
  </div>;
}
