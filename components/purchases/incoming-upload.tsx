'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Camera, FileUp, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IncomingDocument } from '@/lib/purchase-documents/types';
import { formatFileSize } from './incoming-document-ui';
import { IncomingUploadQueue, MAX_INCOMING_QUEUE_FILES, sendIncomingOriginal, type UploadRow } from './incoming-upload-queue';

type UploadProps = { onUploaded: (document: IncomingDocument) => void; onOpen: (id: number) => void; onRefresh: () => void };
const stateLabel = { queued: 'Wartend', sending: 'Wird gespeichert…', saved: 'Gespeichert', existing: 'Bereits vorhanden', failed: 'Fehlgeschlagen', unknown: 'Ausgang unklar', cancelled: 'Abgebrochen · nicht gestartet' };

/** Auth identity changes unmount the queue, aborting work and dropping local file references. */
export function IncomingUpload(props: UploadProps) {
  const { data: session, status } = useSession();
  if (status !== 'authenticated' || !session?.user?.id) return null;
  return <IncomingUploadContent key={session.user.id} {...props} />;
}
function IncomingUploadContent({ onUploaded, onOpen, onRefresh }: UploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const rowElements = useRef(new Map<string, HTMLLIElement>());
  const callbacks = useRef({ onUploaded, onRefresh });
  callbacks.current = { onUploaded, onRefresh };
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queue] = useState(() => new IncomingUploadQueue(sendIncomingOriginal, () => {
    setRows(queue.rows()); setBusy(queue.busy);
  }, () => {
    setError('Deine Sitzung ist abgelaufen. Die lokale Auswahl wurde entfernt. Bitte erneut anmelden und gespeicherte Belege prüfen.');
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
    callbacks.current.onRefresh();
  }, result => {
    // Preserve single-photo review; a batch never opens a dialog over a running queue.
    if (result && queue.rows().length === 1) callbacks.current.onUploaded(result.document);
    else callbacks.current.onRefresh();
  }));
  useLayoutEffect(() => () => { queue.dispose(); }, [queue]);

  function selectFiles(files: FileList | null) {
    if (queue.busy) return;
    // Check the count before copying references or inspecting any file contents.
    if (files && files.length > MAX_INCOMING_QUEUE_FILES) { queue.clear(); setError('Bitte höchstens 20 Originale auswählen.'); if (input.current) input.current.value = ''; if (camera.current) camera.current.value = ''; return; }
    const invalid = queue.select(Array.from(files ?? []));
    setError(invalid); setNotice(null);
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
  }
  const queued = rows.filter(row => row.state === 'queued').length;
  const hasUnknown = rows.some(row => row.state === 'unknown');
  const singleRetry = rows.length === 1 && rows[0].retryable && (rows[0].state === 'failed' || rows[0].state === 'unknown');
  const savedCount = rows.filter(row => row.state === 'saved' || row.state === 'existing').length;
  const showPrimary = queued > 0 || rows.length <= 1;
  function focusAfterRemoval(trigger: HTMLElement, target: HTMLElement | null) {
    // Do not steal focus if the user moved elsewhere while a request was pending.
    if (!trigger.isConnected && document.activeElement === document.body) target?.focus({ preventScroll: true });
  }
  async function upload(event: { currentTarget: HTMLButtonElement }) {
    const trigger = event.currentTarget;
    setError(null); setNotice(null);
    if (singleRetry) await queue.retry(rows[0].requestId);
    else await queue.start();
    requestAnimationFrame(() => focusAfterRemoval(trigger, summary.current));
  }
  return <section aria-labelledby="incoming-upload-heading" className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <FileUp className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 id="incoming-upload-heading" className="font-semibold">Original hinzufügen</h2>
        <p id="incoming-file-help" className="mt-1 text-sm text-muted-foreground">JPG/PNG, PDF oder XML · bis zu 20 Dateien, insgesamt 100 MiB</p>
      </div>
    </div>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <input ref={input} id="incoming-file" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.xml,image/jpeg,image/png,application/pdf,application/xml,text/xml" disabled={busy} aria-describedby="incoming-file-help incoming-local-help" className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60" onChange={event => selectFiles(event.target.files)} />
      <label htmlFor="incoming-file" className="sr-only">Foto, PDF- oder XML-Original auswählen</label>
      <input ref={camera} type="file" accept="image/jpeg,image/png" capture="environment" disabled={busy} className="sr-only" tabIndex={-1} aria-label="Kameraaufnahme auswählen" onChange={event => selectFiles(event.target.files)} />
      <Button variant="outline" className="shrink-0" disabled={busy} onClick={() => camera.current?.click()}><Camera className="size-4" aria-hidden="true" />Foto aufnehmen</Button>
      {showPrimary && <Button className="shrink-0" disabled={(!queued && !singleRetry) || busy} onClick={upload}>{busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}{busy ? 'Wird gespeichert…' : singleRetry && rows[0].state === 'unknown' ? 'Mit gleicher Anfrage abgleichen' : queued > 0 && hasUnknown ? 'Verbleibende Originale hochladen' : rows.length > 1 ? 'Auswahl hochladen' : 'Original hochladen'}</Button>}
      {busy && <Button variant="outline" className="shrink-0" onClick={() => { queue.cancel(); setNotice('Neue Uploads gestoppt. Bereits gespeicherte Originale bleiben erhalten. Ungesendete Dateien bitte erneut auswählen.'); onRefresh(); requestAnimationFrame(() => summary.current?.focus({ preventScroll: true })); }}><X aria-hidden="true" className="size-4" />Abbrechen</Button>}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{rows.length > 1 ? 'Stapel: ohne automatische KI-Auswertung. Es wird keine Ausgabe erstellt.' : <>KI-Automatik kann Belege an Ihren Anbieter senden und Kosten verursachen. <a href="/settings#ai-receipt-settings" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">KI-Einstellungen</a></>}</p>
    {queued > 0 && hasUnknown && <p className="mt-3 text-xs text-muted-foreground">Die Warteschlange ist angehalten. Unklaren Beleg abgleichen oder nur die verbleibenden Originale bewusst starten.</p>}
    {rows.length > 0 && <>
      <p ref={summary} tabIndex={-1} role="status" className="mt-3 text-sm text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring">{savedCount} von {rows.length} Originalen gespeichert oder bereits vorhanden · nicht gebucht</p>
      <ul aria-label="Upload-Warteschlange" className="mt-2 divide-y divide-border">
        {rows.map(row => <li key={row.requestId} ref={element => { if (element) rowElements.current.set(row.requestId, element); else rowElements.current.delete(row.requestId); }} tabIndex={-1} className="min-w-0 py-3 outline-none focus-visible:outline-2 focus-visible:outline-ring">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 max-w-full break-all text-sm font-medium">{row.fileName} <span className="font-normal text-muted-foreground">· {formatFileSize(row.size)}</span></p>
            <span className="text-xs text-muted-foreground">{stateLabel[row.state]}</span>
          </div>
          {row.state === 'sending' && <div className="mt-2"><progress aria-label={`Dateiübertragung ${row.fileName}`} max={100} value={row.progress ?? undefined} className="h-1.5 w-full accent-primary" /><p className="text-xs text-muted-foreground">{row.progress === 100 ? 'Übertragen; Speicherbestätigung steht noch aus.' : 'Original wird übertragen…'}</p></div>}
          {row.message && <p role="alert" className="mt-1 break-words text-xs text-muted-foreground">{row.message}</p>}
          {row.documentId !== null && <Button variant="link" className="h-auto min-h-11 px-0" onClick={() => onOpen(row.documentId!)}>{row.state === 'existing' ? 'Vorhandenes Original öffnen' : 'Gespeicherten Beleg prüfen'}</Button>}
          {row.retryable && !singleRetry && <Button variant="outline" className="mt-2" disabled={busy} onClick={async event => { const trigger = event.currentTarget; setNotice(null); await queue.retry(row.requestId); requestAnimationFrame(() => focusAfterRemoval(trigger, rowElements.current.get(row.requestId) ?? summary.current)); }}>{row.state === 'unknown' ? 'Mit gleicher Anfrage abgleichen' : 'Erneut versuchen'}<span className="sr-only">: {row.fileName}</span></Button>}
        </li>)}
      </ul>
      {savedCount > 0 && <Button variant="outline" disabled={busy} onClick={() => { onRefresh(); document.getElementById('incoming-list-heading')?.focus(); }}>Gespeicherte Belege prüfen</Button>}
      {!busy && <Button variant="ghost" onClick={() => { queue.clear(); setError(null); setNotice(null); input.current?.focus(); }}>Auswahl leeren</Button>}
    </>}
    <p id="incoming-local-help" className="mt-3 text-xs text-muted-foreground">Nach Neuladen ungesendete Dateien erneut auswählen; gespeicherte Originale bleiben im Belegeingang.</p>
    <details className="mt-2 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">Dateigrenzen und lokale Auswahl</summary><p>JPG/PNG: 10 MB und 24 MP · PDF: 25 MB · XML: 8 MB. Dateien werden einzeln übertragen; fehlerhafte Dateien bleiben ungeprüft.</p><p className="mt-2">Die Auswahl bleibt nur hier im Arbeitsspeicher. Nach Neuladen, Abmelden oder Kontowechsel ungesendete Dateien erneut auswählen. Gespeicherte Originale finden Sie im Belegeingang wieder. Ein Abbruch macht keine Speicherung rückgängig.</p></details>
    {error && <p role="alert" className="mt-3 rounded-md bg-critical-surface p-3 text-sm text-critical-foreground">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
  </section>;
}
