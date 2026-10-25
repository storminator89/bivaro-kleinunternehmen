'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import type { ManualFinancialRecordDto, ManualFinancialRecordKind, ManualFinancialRecordMutation } from '@/lib/manual-financial-record-contract';
import { createReviewTraversalGuard, reviewNavigationDispatcher, reviewPopDispatcher, reviewSessionKey } from '@/components/purchases/incoming-review-history';
import type { IncomingNavigationGuard } from '@/components/purchases/incoming-review-queue';
import { correctionAmount, createDraftClock, forgetCommand, hasConfirmedMutation, isUnchangedCorrection, loadManualRecord, ManualRecordRequestError, pendingIdentity, readPendingIdentity, recordStorageKey, rememberCommand, rememberedCommand, saveManualRecord, type PendingIdentity } from './manual-record-client';
import { manualRecordStateLabel } from './manual-record-status';
import styles from './manual-record.module.css';

type Selection = { kind: ManualFinancialRecordKind; id: number; opener: HTMLButtonElement };
type Props = { selection: Selection; onClose: () => void; onRecord: (record: ManualFinancialRecordDto) => void; onRefresh: () => Promise<void> };
type Preview = { command: ManualFinancialRecordMutation; generation: number };
type ExitIntent = { proceed: () => void; stay: () => void };
const amountDisplay = (value: string | null) => value === null ? 'Nicht sicher darstellbar' : `${correctionAmount(value).replace('.', ',')} EUR`;
const message = (failure: unknown) => failure instanceof Error ? failure.message : 'Die Anfrage konnte nicht verlässlich bestätigt werden.';

/** One fresh-read workspace, mounted only after a deliberate row action. */
export function ManualRecordDialog({ selection, onClose, onRecord, onRefresh }: Props) {
  const { data: session, status } = useSession();
  const sessionKey = reviewSessionKey(session, status);
  const sourceSession = useRef(sessionKey);
  const currentSession = useRef(sessionKey); currentSession.current = sessionKey;
  const storageKey = recordStorageKey(sourceSession.current, selection.kind, selection.id);
  const [record, setRecord] = useState<ManualFinancialRecordDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [posting, setPosting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checkedUncertain, setCheckedUncertain] = useState(false);
  const [abandonReview, setAbandonReview] = useState<{ mutationId: string; revision: number; fingerprint: string } | null>(null);
  const [abandonConfirmed, setAbandonConfirmed] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exitIntent, setExitIntent] = useState<ExitIntent | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const clock = useRef(createDraftClock());
  const active = useRef(false);
  const writeLock = useRef(false);
  const readLock = useRef(false);
  const pending = useRef<PendingIdentity | null>(null);
  const submittedGeneration = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose, onRecord, onRefresh }); callbacks.current = { onClose, onRecord, onRefresh };
  const guard = useRef<IncomingNavigationGuard | null>(null);
  const traversal = useRef<ReturnType<typeof createReviewTraversalGuard> | null>(null);
  const isCurrent = useCallback(() => active.current && currentSession.current === sourceSession.current, []);

  const clearPending = useCallback(() => {
    pending.current = null; forgetCommand(storageKey);
    try { sessionStorage.removeItem(storageKey); } catch { /* in-memory command is already resolved */ }
    setUncertain(false); setCheckedUncertain(false); setAbandonReview(null); setAbandonConfirmed(false);
  }, [storageKey]);
  const refreshLists = useCallback(async () => {
    setRefreshing(true); setRefreshError(false);
    try { await callbacks.current.onRefresh(); }
    catch { if (isCurrent()) setRefreshError(true); }
    finally { if (isCurrent()) setRefreshing(false); }
  }, [isCurrent]);
  const acceptSaved = useCallback(async (next: ManualFinancialRecordDto, generation: number | null) => {
    if (!isCurrent()) return;
    clearPending(); setRecord(next); callbacks.current.onRecord(next);
    const clean = generation !== null && clock.current.markClean(generation);
    if (clean) { setAmount(next.effectiveAmount ?? ''); setReason(''); setLegacy(false); }
    setPreview(null); setConfirmed(false); setError(null); setLoadError(null);
    setSaved(clean || !clock.current.isDirty() ? 'Gespeichert. Original und vollständiger Verlauf bleiben erhalten.' : 'Gespeichert. Ihre neueren Eingaben sind noch nicht gespeichert und bleiben erhalten.');
    await refreshLists();
  }, [clearPending, isCurrent, refreshLists]);
  const readDetails = useCallback(async (): Promise<ManualFinancialRecordDto | null> => {
    if (writeLock.current || readLock.current || !isCurrent()) return null;
    readLock.current = true; setLoading(true); setLoadError(null); setCheckedUncertain(false); setAbandonReview(null); setAbandonConfirmed(false);
    const startedAt = clock.current.snapshot();
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    try {
      const next = await loadManualRecord(selection.kind, selection.id, request.signal);
      if (!isCurrent() || request.signal.aborted) return null;
      setRecord(next); callbacks.current.onRecord(next);
      if (clock.current.canAdopt(startedAt)) { setAmount(next.effectiveAmount ?? ''); setReason(''); setLegacy(false); }
      if (pending.current && hasConfirmedMutation(next, pending.current)) {
        await acceptSaved(next, submittedGeneration.current ?? (clock.current.isDirty() ? null : startedAt));
      } else if (pending.current) { setUncertain(true); setCheckedUncertain(true); }
      return next;
    } catch (failure) {
      if (isCurrent() && !request.signal.aborted) setLoadError(message(failure));
      return null;
    } finally { if (controller.current === request) { readLock.current = false; if (isCurrent() && !request.signal.aborted) setLoading(false); } }
  }, [acceptSaved, isCurrent, selection.id, selection.kind]);

  useLayoutEffect(() => {
    active.current = true;
    const requestNavigation = (proceed: () => void, stay: () => void = () => {}) => {
      if (!isCurrent()) return;
      if (clock.current.isDirty() || writeLock.current || pending.current) setExitIntent({ proceed, stay });
      else proceed();
    };
    guard.current = { get blocked() { return clock.current.isDirty() || writeLock.current || pending.current !== null; }, request: requestNavigation };
    const unregisterNavigation = reviewNavigationDispatcher.register(action => requestNavigation(() => { callbacks.current.onClose(); action(); }));
    const navigation = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation;
    const handler = createReviewTraversalGuard({
      getIndex: () => navigation?.currentEntry?.index,
      go: delta => window.history.go(delta),
      getGuard: () => guard.current,
      onReplay: () => callbacks.current.onClose(),
      onUnprotectedTraversal: () => { if (!guard.current?.blocked) callbacks.current.onClose(); },
    });
    traversal.current = handler;
    const unregisterPop = reviewPopDispatcher.register(handler);
    const unload = (event: BeforeUnloadEvent) => { if (guard.current?.blocked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => {
      active.current = false; controller.current?.abort(); readLock.current = false; guard.current = null; traversal.current = null;
      unregisterNavigation(); unregisterPop(); window.removeEventListener('beforeunload', unload);
    };
  }, [isCurrent]);
  useEffect(() => {
    if (sessionKey !== sourceSession.current || status !== 'authenticated') { controller.current?.abort(); forgetCommand(storageKey); callbacks.current.onClose(); }
  }, [sessionKey, status, storageKey]);
  useEffect(() => {
    try { pending.current = readPendingIdentity(sessionStorage.getItem(storageKey)); } catch { /* memory-only identity is checked below */ }
    const remembered = rememberedCommand(storageKey);
    if (remembered) pending.current = pendingIdentity(remembered);
    if (pending.current) setUncertain(true);
    void readDetails();
  }, [readDetails, storageKey]);
  useEffect(() => { if (error || loadError) errorRef.current?.focus(); }, [error, loadError]);
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [saved]);
  useEffect(() => { if (exitIntent) exitRef.current?.focus(); }, [exitIntent]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);

  function edit(update: () => void) {
    clock.current.edit(); update(); setPreview(null); setConfirmed(false); setSaved(null); setError(null);
  }
  function close() { guard.current?.request(() => callbacks.current.onClose(), () => {}); }
  function prepare() {
    if (!record || loading || writeLock.current || pending.current) return;
    setError(null); setSaved(null);
    const operation = record.state === 'FINALIZED' ? 'CORRECT_AMOUNT' : 'FINALIZE';
    if ((operation === 'FINALIZE' && !record.canFinalize) || (operation === 'CORRECT_AMOUNT' && !record.canCorrectAmount)) return;
    try {
      if (record.requiresLegacyDeclaration && !legacy) throw new Error('Bitte bestätigen Sie ausdrücklich, dass dies ein einzelner manueller Altbestand ist.');
      const command: ManualFinancialRecordMutation = { kind: selection.kind, id: selection.id, operation, expectedRevision: record.revision, fingerprint: record.fingerprint, mutationId: crypto.randomUUID() };
      if (operation === 'CORRECT_AMOUNT') {
        command.amount = correctionAmount(amount); command.reason = reason.trim();
        if (!command.reason || command.reason.length > 1000) throw new Error('Bitte einen nachvollziehbaren Grund mit 1 bis 1000 Zeichen eingeben.');
        if (isUnchangedCorrection(command.amount, record.effectiveAmount)) throw new Error('Der neue Betrag muss vom aktuell wirksamen Betrag abweichen.');
      } else if (record.requiresLegacyDeclaration) command.legacyManualDeclaration = true;
      setPreview({ command, generation: clock.current.snapshot() }); setConfirmed(false);
    } catch (failure) { setError(message(failure)); }
  }
  async function send(command: ManualFinancialRecordMutation, generation: number | null) {
    if (writeLock.current || readLock.current || !isCurrent()) return;
    writeLock.current = true; setPosting(true); setError(null); setSaved(null); setCheckedUncertain(false);
    pending.current = pendingIdentity(command); submittedGeneration.current = generation;
    rememberCommand(storageKey, command);
    // Only opaque request/precondition metadata persists. No reason, amount or PII.
    try { sessionStorage.setItem(storageKey, JSON.stringify(pendingIdentity(command))); } catch { /* in-memory same-key recovery remains available */ }
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    let needsRecovery = false;
    try {
      const next = await saveManualRecord(command, request.signal);
      if (isCurrent() && !request.signal.aborted) await acceptSaved(next, generation);
    } catch (failure) {
      if (!isCurrent() || request.signal.aborted) return;
      const definitive = failure instanceof ManualRecordRequestError && failure.status < 500 && failure.code !== 'MANUAL_RECORD_MUTATION_CONFLICT';
      if (definitive) {
        clearPending(); setPreview(null); setConfirmed(false); setRecord(null); needsRecovery = true;
      } else { setUncertain(true); setPreview(null); setConfirmed(false); needsRecovery = true; }
      setError(message(failure));
    } finally {
      writeLock.current = false;
      if (isCurrent() && !request.signal.aborted) { setPosting(false); if (needsRecovery) void readDetails(); }
    }
  }
  async function retrySameCommand() {
    if (writeLock.current || readLock.current || !checkedUncertain) return;
    // Always read immediately before a user-authorized identical replay.
    const next = await readDetails();
    if (!next || !isCurrent() || !pending.current) return;
    const command = rememberedCommand(storageKey);
    if (!command || command.mutationId !== pending.current.mutationId) return;
    await send(command, submittedGeneration.current);
  }
  async function prepareAbandonment() {
    if (writeLock.current || readLock.current) return;
    const next = await readDetails();
    if (!next || !isCurrent() || !pending.current || hasConfirmedMutation(next, pending.current)) return;
    // Complete fresh history found no accepted mutation. We abandon only the
    // local intent, never claim rollback. A later command uses this fresh CAS.
    setAbandonReview({ mutationId: pending.current.mutationId, revision: next.revision, fingerprint: next.fingerprint });
    setAbandonConfirmed(false);
  }
  function abandonLocalIntent() {
    if (!abandonConfirmed || !abandonReview || !record || writeLock.current || readLock.current || pending.current?.mutationId !== abandonReview.mutationId || record.revision !== abandonReview.revision || record.fingerprint !== abandonReview.fingerprint) return;
    clearPending(); setPreview(null); setConfirmed(false); setError(null);
    setSaved('Nur der lokale unbestätigte Versuch wurde verworfen. Es wurde nichts zurückgebucht und keine neue Anfrage gesendet. Angaben erneut prüfen; eine eventuell verspätete alte Anfrage kann weiterhin gespeichert werden.');
  }
  if (sessionKey !== sourceSession.current) return null;
  const canAct = record && (record.state === 'FINALIZED' ? record.canCorrectAmount : record.canFinalize);
  const originalAmount = record?.history.find(entry => entry.operation === 'FINALIZE')?.amount ?? null;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className={styles.dialog} showCloseButton={false} onEscapeKeyDown={event => { event.preventDefault(); if (exitIntent) { exitIntent.stay(); setExitIntent(null); } else close(); }} onInteractOutside={event => { event.preventDefault(); if (!exitIntent) close(); }} onCloseAutoFocus={event => { event.preventDefault(); if (selection.opener.isConnected) selection.opener.focus(); }}>
      <DialogHeader>
        <DialogTitle>{selection.kind === 'income' ? 'Einnahme' : 'Ausgabe'}: Status, Original und Verlauf</DialogTitle>
        <DialogDescription>Einzelner manueller EUR-Datensatz. Bestehende Beträge sind bereits in den Auswertungen berücksichtigt.</DialogDescription>
      </DialogHeader>
      <div className={styles.stack}>
        {exitIntent ? <div ref={exitRef} tabIndex={-1} role="alertdialog" aria-label="Ungespeicherte Eingaben oder ungeklärte Anfrage" className={styles.warning}>
          <h3 className="font-semibold">Dialog wirklich verlassen?</h3>
          <p>Ungespeicherte Eingaben gehen beim Verlassen verloren. {posting || uncertain ? 'Eine laufende oder unklare Anfrage kann bereits gespeichert sein. Das Beenden des Wartens macht einen angenommenen Serverauftrag nicht rückgängig. Die Anfragekennung bleibt für eine spätere Nachweisprüfung erhalten.' : 'Original und gespeicherter Verlauf werden nicht gelöscht.'}</p>
          <div className={styles.actions}><Button variant="outline" onClick={() => { exitIntent.stay(); setExitIntent(null); }}>Hier bleiben</Button><Button variant="outline" onClick={() => { const intent = exitIntent; setExitIntent(null); controller.current?.abort(); intent.proceed(); }}>Trotzdem verlassen</Button></div>
        </div> : null}
        {(error || loadError) && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}{error && loadError ? ' ' : ''}{loadError}</div>}
        {saved && <div ref={savedRef} tabIndex={-1} role="status" className={styles.notice}>{saved}</div>}
        {refreshError && <div role="alert" className={styles.warning}><p>Änderung gespeichert; Listen oder Kennzahlen konnten nicht vollständig aktualisiert werden. Keine erneute Speicherung nötig.</p><Button variant="outline" disabled={refreshing} onClick={() => void refreshLists()}>Nur Listen erneut laden</Button></div>}
        {loading && <p role="status">Aktuelle Details und vollständigen Verlauf laden …</p>}
        {uncertain && <div className={styles.warning} role="status"><h3 className="font-semibold">Speicherstatus noch ungeklärt</h3><p>Keine neue Korrektur anlegen. Zuerst den aktuellen Verlauf auf die gespeicherte Anfragekennung prüfen. Eine fehlende Antwort oder ein abgebrochenes Warten bedeutet nicht, dass die Änderung zurückgerollt wurde.</p>
          <p className={styles.hash}>Anfrage: {pending.current?.mutationId}</p>
          <div className={styles.actions}><Button variant="outline" disabled={loading || posting} onClick={() => void readDetails()}>Nachweis erneut prüfen</Button>{rememberedCommand(storageKey) && checkedUncertain && <Button variant="outline" disabled={loading || posting} onClick={() => void retrySameCommand()}>Dieselbe bestätigte Anfrage wiederholen</Button>}</div>
          {!rememberedCommand(storageKey) && <p>Nach einem Neuladen ist der ursprüngliche Eingabetext nicht mehr im Arbeitsspeicher. Eine identische Wiederholung kann nicht rekonstruiert werden.</p>}
          {checkedUncertain && <Button variant="outline" disabled={loading || posting} onClick={() => void prepareAbandonment()}>Lokalen Versuch nach frischer Prüfung verwerfen …</Button>}
          {abandonReview && <div className={styles.stack}><p>Der vollständig frisch geladene Verlauf enthält diese Anfragekennung nicht. Geprüfter Stand: Revision {abandonReview.revision}. Ein alter Auftrag kann trotzdem verspätet eintreffen; konkurrierende Änderungen desselben Stands werden vom Server abgewiesen. Verwerfen beendet ausschließlich den lokalen Versuch, nicht einen Serverauftrag.</p><p className={styles.hash}>Geprüfter Fingerabdruck: {abandonReview.fingerprint}</p><label className={styles.check}><input type="checkbox" checked={abandonConfirmed} onChange={event => setAbandonConfirmed(event.target.checked)} />Ich verstehe: kein Rückgängigmachen, keine neue Speicherung. Ich werde die frischen Angaben vor einem neuen Auftrag erneut prüfen.</label><Button variant="outline" disabled={!abandonConfirmed || loading || posting} onClick={abandonLocalIntent}>Nur lokalen Versuch verwerfen</Button></div>}

        </div>}
        {record && <>
          <section aria-label="Aktuelle Datensatzdetails" className={styles.stack}>
            <h3 className="font-semibold">{manualRecordStateLabel(record.state)}</h3>
            <dl className={styles.facts}><div><dt>Beschreibung</dt><dd>{record.description}</dd></div><div><dt>Unverändertes Zahlungsdatum</dt><dd>{formatBusinessDateDisplay(record.paymentDate)}</dd></div><div><dt>Aktuell wirksamer Betrag</dt><dd>{amountDisplay(record.effectiveAmount)}</dd></div><div><dt>Ursprünglich festgeschriebener Betrag</dt><dd>{originalAmount === null ? 'Noch nicht festgeschrieben' : amountDisplay(originalAmount)}</dd></div><div><dt>Herkunft</dt><dd>{record.origin}</dd></div><div><dt>Stand</dt><dd>Revision {record.revision}</dd></div></dl>
            {record.readOnlyReason && <p className={styles.warning}>{record.readOnlyReason}</p>}
          </section>
          <section aria-label="Originalnachweis" className={styles.stack}><h3 className="font-semibold">Originalnachweis</h3>
            {record.original.status === 'NONE' ? <p className="text-sm">Kein Original angehängt. Es wird kein fehlender Beleg erfunden.</p> : <><p className="text-sm">{record.original.fileName || 'Originaldatei'} · {record.original.status === 'ARCHIVED' ? 'Unverändert archiviert' : 'Original nicht verifiziert'}</p><p className={styles.hash}>SHA-256: {record.original.sha256 || 'Nicht bestätigt'}<br />Dateigröße: {record.original.byteCount === null ? 'Nicht bestätigt' : `${record.original.byteCount} Bytes`}</p></>}
            <p className="text-xs text-muted-foreground">Eine externe Belegadresse allein bestätigt keine archivierten Originalbytes.</p>
          </section>
          {canAct && !uncertain && <form className={styles.stack} onSubmit={event => { event.preventDefault(); prepare(); }} aria-label={record.state === 'FINALIZED' ? 'Betrag korrigieren' : 'Festschreibung vorbereiten'}>
            {record.state === 'FINALIZED' ? <><h3 className="font-semibold">Nur den Betrag korrigieren</h3><p className={styles.notice}>Der neue Betrag ersetzt genau einen wirksamen Betrag. 100 → 80 EUR ergibt 80 EUR, nicht 180 EUR. Dies erfasst keine spätere Rückzahlung oder Auszahlung. Zahlungsdatum, Kunde, Steuerangaben, Kategorie, AfA und Datei bleiben unverändert.</p><label htmlFor="manual-record-amount">Neuer wirksamer Betrag (EUR)<input id="manual-record-amount" inputMode="decimal" autoComplete="off" value={amount} maxLength={18} onChange={event => edit(() => setAmount(event.target.value))} /></label><label htmlFor="manual-record-reason">Nachvollziehbarer Korrekturgrund<textarea id="manual-record-reason" rows={3} maxLength={1000} value={reason} onChange={event => edit(() => setReason(event.target.value))} /></label></> : <><h3 className="font-semibold">Bewusst festschreiben</h3><p className={styles.notice}>Dieser Datensatz ist bereits in den Summen enthalten. Die Festschreibung verändert den Betrag und das Zahlungsdatum nicht und löst keine zweite Buchung aus. Danach sind allgemeines Bearbeiten, Löschen und Duplizieren hier gesperrt.</p>{record.requiresLegacyDeclaration && <label className={styles.check}><input type="checkbox" checked={legacy} onChange={event => edit(() => setLegacy(event.target.checked))} />Ich bestätige: Dies ist ein einzelner manueller Altbestand in EUR, kein Rechnungs-/Journal-, Kassen-, Serien- oder AfA-Vorgang. Eine frühere Prüfung wird damit nicht behauptet.</label>}</>}
            <div className={styles.actions}><Button type="submit" variant="outline" disabled={loading || posting}>{record.state === 'FINALIZED' ? 'Betragskorrektur prüfen' : 'Festschreibung prüfen'}</Button></div>
          </form>}
          {preview && !uncertain && <section ref={previewRef} tabIndex={-1} aria-label="Verbindliche Änderungsvorschau" className={`${styles.warning} ${styles.stack}`}>
            <h3 className="font-semibold">{preview.command.operation === 'FINALIZE' ? 'Festschreibung bestätigen' : 'Betragskorrektur bestätigen'}</h3>
            <p>{record.description} · Zahlungsdatum {formatBusinessDateDisplay(record.paymentDate)}</p>
            <p>Aktuell {amountDisplay(record.effectiveAmount)}{preview.command.operation === 'CORRECT_AMOUNT' ? ` → neu ${amountDisplay(preview.command.amount ?? null)}` : ' · Betrag unverändert'}</p>
            {preview.command.reason && <p>Grund: {preview.command.reason}</p>}
            <p className={styles.hash}>Original-Hash: {record.original.sha256 || (record.original.status === 'NONE' ? 'Kein Original angehängt' : 'Nicht bestätigt')}</p>
            <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={posting} onChange={event => setConfirmed(event.target.checked)} />Ich habe die frischen Angaben geprüft: bereits berücksichtigt, keine zweite Buchung. {preview.command.operation === 'CORRECT_AMOUNT' ? 'Nur der Betrag wird mit diesem Grund ersetzt; das Original bleibt erhalten.' : 'Allgemeine Änderungen werden anschließend gesperrt.'}</label>
            <div className={styles.actions}><Button variant="outline" disabled={posting} onClick={() => { setPreview(null); setConfirmed(false); }}>Vorschau abbrechen</Button><Button disabled={!confirmed || posting || loading} onClick={() => void send(preview.command, preview.generation)}>{posting ? 'Speicherbestätigung abwarten …' : preview.command.operation === 'FINALIZE' ? 'Jetzt ausdrücklich festschreiben' : 'Betragskorrektur speichern'}</Button></div>
          </section>}
          <section aria-label="Vollständiger Änderungsverlauf"><h3 className="font-semibold">Original und Änderungsverlauf</h3>{record.history.length ? <ol className={styles.history}>{record.history.map(entry => <li key={entry.id}><p className="font-semibold">{entry.operation === 'FINALIZE' ? 'Original festgeschrieben' : 'Betrag korrigiert'} · {amountDisplay(entry.amount)}</p><p>Aufgezeichnet: {entry.createdAt} · Zahlungsdatum: {formatBusinessDateDisplay(entry.paymentDate)}</p><p>Ursprünglicher Betrag: {amountDisplay(entry.originalAmount)}</p>{entry.reason && <p>Grund: {entry.reason}</p>}<p className={styles.hash}>SHA-256: {entry.hash}</p></li>)}</ol> : <p className="text-sm text-muted-foreground">Noch keine Festschreibung. Der bestehende Betrag wird trotzdem bereits berücksichtigt.</p>}</section>
        </>}
        {posting && <p role="status" className={styles.notice}>Die Anfrage läuft. Eingaben dürfen weiter bearbeitet werden; sie ändern nicht den bereits bestätigten Auftrag. Schließen, Zurück/Vorwärts oder Neuladen kann eine angenommene Änderung nicht rückgängig machen.</p>}
        <div className={styles.actions}>{!uncertain && <Button variant="outline" disabled={loading || posting} onClick={() => { setPreview(null); setConfirmed(false); void readDetails(); }}>Details frisch laden</Button>}<Button variant="outline" onClick={close}>{posting ? 'Warten beenden / schließen …' : 'Schließen'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
