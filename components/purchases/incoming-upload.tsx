'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, FileUp, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IncomingDocument, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { errorMessage, formatFileSize, IncomingRequestError, incomingResponseError, validateIncomingFile } from './incoming-document-ui';

export function IncomingUpload({ onUploaded, onOpen, onRefresh }: { onUploaded: (document: IncomingDocument) => void; onOpen: (id: number) => void; onRefresh: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const activeRequest = useRef<XMLHttpRequest | null>(null);
  const requestId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => () => { activeRequest.current?.abort(); }, []);

  function selectFile(next: File | null) {
    if (busyRef.current) return;
    requestId.current = null;
    setDuplicateId(null); setNotice(null);
    const invalid = next ? validateIncomingFile(next) : null;
    setError(invalid); setFile(invalid ? null : next);
  }
  async function upload() {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setProgress(0); setError(null); setNotice(null); setDuplicateId(null);
    requestId.current ??= crypto.randomUUID();
    const form = new FormData();
    form.append('file', file); form.append('uploadRequestId', requestId.current);
    try {
      const result = await new Promise<IncomingDocumentResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeRequest.current = xhr;
        xhr.open('POST', '/api/purchase-documents');
        xhr.timeout = 120_000;
        xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
        xhr.upload.onload = () => setProgress(100);
        xhr.onload = () => {
          let body: unknown;
          try { body = JSON.parse(xhr.responseText); } catch { body = null; }
          if (xhr.status < 200 || xhr.status >= 300) reject(incomingResponseError(xhr.status, body));
          else if (body && typeof body === 'object' && 'document' in body) resolve(body as IncomingDocumentResponse);
          else reject(new IncomingRequestError('Die Antwort konnte nicht gelesen werden. Bitte den Belegeingang aktualisieren und erneut versuchen.'));
        };
        xhr.onerror = () => reject(new IncomingRequestError('Die Verbindung ist unterbrochen. Bitte den Belegeingang aktualisieren oder dieselbe Datei erneut übertragen.'));
        xhr.ontimeout = () => reject(new IncomingRequestError('Die Antwort dauert zu lange. Bitte den Belegeingang aktualisieren oder dieselbe Datei erneut übertragen.'));
        xhr.onabort = () => reject(new DOMException('Upload canceled', 'AbortError'));
        xhr.send(form);
      });
      setFile(null); requestId.current = null;
      if (input.current) input.current.value = '';
      if (camera.current) camera.current.value = '';
      onUploaded(result.document);
      setNotice(result.replayed ? 'Bereits gespeichertes Original geöffnet. Es wurde keine Ausgabe erstellt.' : 'Original gespeichert. Es wurde keine Ausgabe erstellt.');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setNotice('Übertragung abgebrochen. Falls das Original bereits angekommen ist, bleibt es erhalten. Bitte den Belegeingang aktualisieren.');
        onRefresh();
      } else {
        setError(errorMessage(caught));
        setDuplicateId(caught instanceof IncomingRequestError ? caught.existingDocumentId : null);
      }
    } finally { activeRequest.current = null; busyRef.current = false; setBusy(false); setProgress(null); }
  }
  return <section aria-labelledby="incoming-upload-heading" className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <FileUp className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 id="incoming-upload-heading" className="font-semibold">Original hinzufügen</h2>
        <p id="incoming-file-help" className="mt-1 text-sm text-muted-foreground">JPG/PNG, PDF oder XML</p>
      </div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">KI-Automatik kann Belege an Ihren Anbieter senden und Kosten verursachen. <a href="/settings#ai-receipt-settings" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">KI-Einstellungen</a></p>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <input ref={input} id="incoming-file" type="file" accept=".jpg,.jpeg,.png,.pdf,.xml,image/jpeg,image/png,application/pdf,application/xml,text/xml" disabled={busy} aria-describedby="incoming-file-help" className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60" onChange={event => selectFile(event.target.files?.[0] ?? null)} />
      <label htmlFor="incoming-file" className="sr-only">Foto, PDF- oder XML-Original auswählen</label>
      <input ref={camera} type="file" accept="image/jpeg,image/png" capture="environment" disabled={busy} className="sr-only" tabIndex={-1} aria-label="Kameraaufnahme auswählen" onChange={event => selectFile(event.target.files?.[0] ?? null)} />
      <Button variant="outline" className="shrink-0" disabled={busy} onClick={() => camera.current?.click()}><Camera className="size-4" aria-hidden="true" />Foto aufnehmen</Button>
      <Button className="shrink-0" disabled={!file || busy} onClick={upload}>{busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}{busy ? 'Wird gespeichert…' : 'Original hochladen'}</Button>
      {busy && <Button variant="outline" className="shrink-0" onClick={() => activeRequest.current?.abort()}><X aria-hidden="true" className="size-4" />Abbrechen</Button>}
    </div>
    <details className="mt-2 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">Dateigrenzen</summary><p>JPG/PNG: 10 MB und 24 MP · PDF: 25 MB · XML: 8 MB · Eine Datei je Upload.</p></details>
    {file && !busy && <p className="mt-2 break-all text-xs text-muted-foreground">{file.name} · {formatFileSize(file.size)}</p>}
    {busy && <div className="mt-3 space-y-1" role="status" aria-live="polite">
      <p className="text-sm">{progress === 100 ? 'Original angekommen. Belegstatus wird vorbereitet…' : 'Original wird übertragen…'}</p>
      <progress aria-label="Dateiübertragung" max={100} value={progress ?? undefined} className="h-1.5 w-full accent-primary" />
      <p className="text-xs text-muted-foreground">Das Auslesen erstellt keine Ausgabe.</p>
    </div>}
    {error && <div role="alert" className="mt-3 rounded-md bg-critical-surface p-3 text-sm text-critical-foreground"><p>{error}</p>{duplicateId && <Button variant="link" className="h-auto min-h-11 px-0 text-inherit" onClick={() => onOpen(duplicateId)}>Vorhandenes Original öffnen</Button>}</div>}
    {notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
  </section>;
}
