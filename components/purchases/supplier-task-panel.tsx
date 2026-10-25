'use client';

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IncomingDocument, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { errorMessage, formatSourceDate, incomingJson, IncomingRequestError } from './incoming-document-ui';
import styles from './supplier-tasks.module.css';

type Task = NonNullable<IncomingDocument['supplierTask']>;
type TaskInput = Pick<Task, 'kind' | 'followUpDate'>;
type TaskDraft = { kind: Task['kind'] | ''; followUpDate: string };
export type SupplierTaskHandle = { save: () => Promise<boolean> };
export const SUPPLIER_TASK_LABELS = { PAYMENT_CHECK: 'Zahlung prüfen', DIRECT_DEBIT_WAIT: 'Abbuchung abwarten', CLARIFY: 'Sachverhalt klären' } as const;
const asDraft = (task: Task | null | undefined): TaskDraft => ({ kind: task?.kind ?? '', followUpDate: task?.followUpDate ?? '' });
const sameTask = (left: TaskInput | null | undefined, right: TaskInput | null | undefined) => (left?.kind ?? '') === (right?.kind ?? '') && (left?.followUpDate ?? '') === (right?.followUpDate ?? '');
const asInput = (draft: TaskDraft): TaskInput | null => draft.kind ? { kind: draft.kind, followUpDate: draft.followUpDate || null } : null;
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9999-12-31') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Internal reminder only: never shares an input or mutation with payment/booking. */
export function SupplierTaskPanel({ document, onSaved, onDirtyChange, onBusyChange, locked = false, saveRef }: { document: IncomingDocument; onSaved: (value: IncomingDocument) => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void; locked?: boolean; saveRef?: Ref<SupplierTaskHandle> }) {
  const [draft, setDraft] = useState<TaskDraft>(() => asDraft(document.supplierTask));
  const currentDraft = useRef(draft);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const editGeneration = useRef(0);
  // Only an accepted exact generation or explicit cancellation marks local
  // intent clean. Equality with an old server value is not evidence of this.
  const cleanGeneration = useRef(0);
  const serverDocument = useRef(document);
  serverDocument.current = document;
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = useRef<{ revision: number; task: TaskInput | null } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = !sameTask(asInput(draft), document.supplierTask);
  useImperativeHandle(saveRef, () => ({ save }));
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    // A review-level reload may deliver its fresh document after remounting the
    // panel. Never infer clean intent from value equality: a newer keyboard edit
    // may deliberately return to the previous confirmed kind/date while saving.
    if (busyRef.current || pending.current || editGeneration.current !== cleanGeneration.current) return;
    const next = asDraft(document.supplierTask); currentDraft.current = next; setDraft(next);
  }, [document.supplierTask]);
  useLayoutEffect(() => { onDirtyChange(dirty || !!pending.current); return () => onDirtyChange(false); }, [dirty, onDirtyChange, busy]);
  useEffect(() => {
    if (!dirty && !pending.current) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function edit(next: TaskDraft) {
    editGeneration.current++;
    currentDraft.current = next; setDraft(next); setSaved(false);
    onDirtyChange(!sameTask(asInput(next), serverDocument.current.supplierTask) || !!pending.current);
  }
  function accept(updated: IncomingDocument, snapshot: number) {
    if (updated.revision < serverDocument.current.revision) {
      setConflict(true); setSaved(false);
      setError('Eine neuere Belegrevision ist bereits bekannt. Die verspätete Antwort ersetzt weder den neueren Serverstand noch deine Eingaben. Bitte den aktuellen Serverstand laden.');
      return false;
    }
    serverDocument.current = updated;
    // An older successful response may confirm the older write, not replace a
    // newer keyboard edit made while that response was delayed.
    if (editGeneration.current === snapshot) {
      cleanGeneration.current = snapshot;
      const next = asDraft(updated.supplierTask); currentDraft.current = next; setDraft(next);
      onDirtyChange(false);
    }
    onSaved(updated);
    setSaved(editGeneration.current === snapshot);
    return true;
  }
  async function save(): Promise<boolean> {
    if (busyRef.current || locked || conflict || document.reviewState !== 'REVIEW') return false;
    const snapshot = editGeneration.current;
    const target = asInput(currentDraft.current);
    if (target?.followUpDate && !validDay(target.followUpDate)) { setError('Bitte einen echten Kalendertag im Format JJJJ-MM-TT wählen.'); return false; }
    setError(null); setSaved(false);
    const controller = new AbortController(); request.current = controller;
    busyRef.current = true; setBusy(true); onBusyChange(true);
    try {
      if (pending.current) {
        const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${document.id}`, { signal: controller.signal });
        if (!alive.current) return false;
        const previous = pending.current;
        if (result.document.id !== document.id) throw new IncomingRequestError('Der Serverstand konnte diesem Beleg nicht sicher zugeordnet werden.');
        if (result.document.revision === previous.revision + 1 && result.document.reviewState === 'REVIEW' && !result.document.supplierTask?.confirmationRequired && sameTask(result.document.supplierTask, previous.task)) {
          pending.current = null;
          const accepted = accept(result.document, sameTask(target, previous.task) ? snapshot : -1);
          if (accepted && !sameTask(target, previous.task)) setError('Die frühere Speicherung ist bestätigt. Deine neueren Eingaben bleiben erhalten; diese bitte gesondert speichern.');
          return accepted && sameTask(target, previous.task);
        }
        if (result.document.revision !== previous.revision || result.document.reviewState !== 'REVIEW') throw new IncomingRequestError('Der Beleg wurde inzwischen geändert. Bitte den Serverstand ausdrücklich laden; deine Eingaben bleiben erhalten.', 409);
        // The read proved that the prior revision is unchanged. Only now may
        // the same CAS revision be used for another explicit write.
        serverDocument.current = result.document;
        pending.current = null;
      }
      const source = serverDocument.current;
      pending.current = { revision: source.revision, task: target };
      const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${document.id}/supplier-task`, { signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: source.revision, task: target }) });
      if (!alive.current) return false;
      if (result.document.id !== document.id || result.document.revision !== source.revision + 1 || result.document.reviewState !== 'REVIEW' || result.document.linkedExpenseId !== null || result.document.supplierTask?.confirmationRequired || !sameTask(result.document.supplierTask, target)) throw new IncomingRequestError('Die Antwort bestätigt nicht die angefragte Vormerkung. Bitte erst den Belegstatus abgleichen.');
      pending.current = null; const accepted = accept(result.document, snapshot);
      return accepted && editGeneration.current === snapshot;
    } catch (caught) {
      if (alive.current) {
        if (caught instanceof IncomingRequestError && caught.status === 409) { setConflict(true); pending.current = null; }
        setError(`${errorMessage(caught)} ${caught instanceof IncomingRequestError && caught.status === 409 ? 'Deine Eingaben wurden nicht überschrieben. Aktuellen Serverstand bewusst laden und neu prüfen.' : 'Speicherung nicht bestätigt. Die Vormerkung kann serverseitig bereits gespeichert sein. Eingaben bleiben erhalten; „Status abgleichen / erneut speichern“ liest zuerst den Serverstand.'}`);
      }
      return false;
    } finally { busyRef.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  async function reloadServer() {
    if (busyRef.current || locked) return;
    if ((dirty || pending.current) && !window.confirm('Eigene ungespeicherte Vormerkung verwerfen und bestätigten Serverstand laden?')) return;
    const controller = new AbortController(); request.current = controller;
    busyRef.current = true; setBusy(true); onBusyChange(true); setError(null);
    const snapshot = editGeneration.current;
    try {
      const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${document.id}`, { signal: controller.signal });
      if (!alive.current) return;
      if (result.document.id !== document.id) throw new IncomingRequestError('Der Serverstand konnte diesem Beleg nicht sicher zugeordnet werden.');
      pending.current = null; setConflict(false); accept(result.document, snapshot);
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    } catch (caught) { if (alive.current) setError(`${errorMessage(caught)} Deine Eingaben bleiben erhalten.`); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  function cancel() {
    if (busyRef.current || pending.current) return;
    editGeneration.current++; cleanGeneration.current = editGeneration.current;
    const next = asDraft(serverDocument.current.supplierTask); currentDraft.current = next; setDraft(next);
    setError(conflict ? 'Eigene Änderungen verworfen. Nach dem Konflikt bitte den aktuellen Serverstand laden.' : null); setSaved(false); onDirtyChange(false); heading.current?.focus({ preventScroll: true });
  }
  const active = document.reviewState === 'REVIEW' && !document.supplierTask?.confirmationRequired;
  const sourceDay = document.preview?.dueDate?.slice(0, 10) ?? '';
  return <section aria-labelledby="supplier-task-heading" className={styles.panel}>
    <h3 ref={heading} tabIndex={-1} id="supplier-task-heading">Lieferantenaufgabe · interne Vormerkung</h3>
    <p className={styles.help}>Keine Zahlung, keine Buchung und keine Benachrichtigung. „Abbuchung abwarten“ bedeutet ausdrücklich nicht bezahlt / nicht bankgeprüft.</p>
    {document.reviewState !== 'REVIEW' ? <>
      <p className={styles.notice}>{document.supplierTask ? `${SUPPLIER_TASK_LABELS[document.supplierTask.kind]} · ${document.supplierTask.followUpDate ? `Wiedervorlage ${formatSourceDate(document.supplierTask.followUpDate)}` : 'Ohne Datum'} · inaktiv` : 'Keine Lieferantenaufgabe gespeichert.'}</p>
      {document.supplierTask && <p className={styles.help}>Gespeicherte Vormerkung bleibt nachvollziehbar, erscheint aber nicht als aktive Aufgabe. Wiederöffnen erfordert erneute Bestätigung oder Entfernung.</p>}
    </> : <>
      {document.supplierTask?.confirmationRequired && <p role="status" className={styles.notice}>Nach dem Wiederöffnen noch inaktiv. Die frühere Vormerkung ausdrücklich erneut bestätigen oder entfernen; sie wurde nicht automatisch reaktiviert.</p>}
      {locked && <p role="status" className={styles.notice}>Vormerkung vorübergehend gesperrt: zuerst die andere offene Belegaktion speichern oder abbrechen.</p>}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className={styles.fields}>
          <div className={styles.field}><Label htmlFor="supplier-task-kind">Aufgabenart</Label><select id="supplier-task-kind" className={styles.select} value={draft.kind} disabled={locked} onChange={event => edit({ ...currentDraft.current, kind: event.target.value as TaskDraft['kind'], ...(event.target.value ? {} : { followUpDate: '' }) })}><option value="">Keine Vormerkung</option>{Object.entries(SUPPLIER_TASK_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></div>
          <div className={styles.field}><Label htmlFor="supplier-task-date">Wiedervorlagetag (optional)</Label><Input id="supplier-task-date" type="date" min="0001-01-01" max="9999-12-31" value={draft.followUpDate} disabled={locked || !draft.kind} aria-describedby="supplier-task-date-help" onChange={event => edit({ ...currentDraft.current, followUpDate: event.target.value })} /></div>
        </div>
        <p id="supplier-task-date-help" className={styles.help}>Kalendertag für die interne Aufgabe · getrennt vom tatsächlichen Zahlungsdatum. Ohne Tag bleibt die Aufgabe „Ohne Datum“.</p>
        <p className={styles.help}>Fällig laut Original · ungeprüft: {sourceDay && validDay(sourceDay) ? formatSourceDate(sourceDay) : 'Nicht bekannt'}. Keine automatische Übernahme.</p>
        {sourceDay && validDay(sourceDay) && <div className={styles.actions}><Button type="button" variant="outline" disabled={locked || !draft.kind} onClick={() => edit({ ...currentDraft.current, followUpDate: sourceDay })}>Als Wiedervorlage übernehmen</Button></div>}
        {error && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <Button type="submit" disabled={locked || busy || conflict || (!dirty && !pending.current && !document.supplierTask?.confirmationRequired)}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{pending.current ? 'Status abgleichen / erneut speichern' : !draft.kind ? 'Vormerkung entfernen' : document.supplierTask?.confirmationRequired ? 'Vormerkung erneut bestätigen' : 'Vormerkung speichern'}</Button>
          {busy && <Button type="button" variant="outline" onClick={() => request.current?.abort()}>Warten abbrechen</Button>}
          {(dirty || conflict) && !pending.current && <Button type="button" variant="ghost" disabled={locked || busy} onClick={cancel}>Vormerkung abbrechen</Button>}
          {(conflict || !!pending.current) && <Button type="button" variant="outline" disabled={locked || busy} onClick={() => void reloadServer()}>Aktuellen Serverstand laden</Button>}
        </div>
        {busy && <p className={styles.help}>„Warten abbrechen“ beendet nur das Warten auf die Antwort, macht keine serverseitige Speicherung rückgängig und erlaubt keine blinde Wiederholung. Danach zuerst den Status abgleichen.</p>}
        <p role="status" className={styles.status}>{busy ? 'Serverstand wird geprüft…' : dirty ? 'Ungespeicherte Vormerkung' : pending.current ? 'Speicherausgang ungeklärt · vor Wiederholung abgleichen' : saved ? 'Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung' : document.supplierTask ? active ? 'Bestätigte interne Aufgabe · keine Zahlungsbestätigung' : 'Frühere Vormerkung · Bestätigung ausstehend' : 'Keine Vormerkung · Beleg unverändert'}</p>
      </form>
    </>}
  </section>;
}
