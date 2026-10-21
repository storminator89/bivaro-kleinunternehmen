import type { IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { errorMessage, IncomingRequestError, incomingResponseError, validateIncomingFile } from './incoming-document-ui';

export const MAX_INCOMING_QUEUE_FILES = 20;
export const MAX_INCOMING_QUEUE_BYTES = 100 * 1024 * 1024;
export type UploadState = 'queued' | 'sending' | 'saved' | 'existing' | 'failed' | 'unknown' | 'cancelled';
export type UploadRow = {
  requestId: string; fileName: string; size: number; state: UploadState;
  progress: number | null; message: string | null; documentId: number | null; retryable: boolean;
};
type Entry = UploadRow & { file: File | null };
export type UploadTransport = (file: File, requestId: string, signal: AbortSignal, progress: (value: number) => void, manual: boolean) => Promise<IncomingDocumentResponse>;

export function validateIncomingSelection(files: readonly Pick<File, 'size'>[]): string | null {
  if (files.length > MAX_INCOMING_QUEUE_FILES) return 'Bitte höchstens 20 Originale auswählen.';
  if (files.reduce((total, file) => total + file.size, 0) > MAX_INCOMING_QUEUE_BYTES) return 'Die gesamte Auswahl darf höchstens 100 MiB groß sein.';
  return null;
}

/** In-memory, sequential single-file requests. Never persists bytes or retries automatically. */
export class IncomingUploadQueue {
  private entries: Entry[] = [];
  private generation = 0;
  private active: AbortController | null = null;
  private running = false;
  private manualBatch = false;
  constructor(private readonly transport: UploadTransport, private readonly changed: () => void, private readonly sessionExpired: () => void, private readonly saved: (result?: IncomingDocumentResponse) => void) {}
  get busy() { return this.running; }
  rows(): UploadRow[] { return this.entries.map(({ file: _file, ...row }) => row); }
  select(files: readonly File[]): string | null {
    if (this.running) return 'Bitte die laufende Übertragung zuerst stoppen.';
    const error = validateIncomingSelection(files);
    if (error) { this.clear(); return error; }
    this.generation++;
    this.manualBatch = files.length > 1;
    this.entries = files.map(file => {
      const message = validateIncomingFile(file);
      return { requestId: crypto.randomUUID(), fileName: file.name, size: file.size, file: message ? null : file,
        state: message ? 'failed' : 'queued', progress: null, message, documentId: null, retryable: false };
    });
    this.changed();
    return null;
  }
  async start(): Promise<void> {
    if (this.running) return;
    await this.run(this.entries.filter(entry => entry.state === 'queued'));
  }
  async retry(requestId: string): Promise<void> {
    if (this.running) return;
    const entry = this.entries.find(row => row.requestId === requestId);
    if (!entry?.file || !entry.retryable || (entry.state !== 'failed' && entry.state !== 'unknown')) return;
    await this.run([entry]);
  }
  cancel(): void {
    this.generation++;
    this.running = false;
    for (const entry of this.entries) {
      if (entry.state === 'queued') { entry.state = 'cancelled'; entry.file = null; }
      else if (entry.state === 'sending') {
        entry.state = 'unknown'; entry.retryable = true;
        entry.message = 'Ausgang unklar. Ein angekommenes Original bleibt gespeichert. Belege aktualisieren oder mit derselben Anfrage abgleichen.';
      }
    }
    this.active?.abort(); this.active = null;
    this.changed();
  }
  clear(): void { this.dispose(); this.changed(); }
  /** Synchronous identity/unmount invalidation; never notifies an unmounted view. */
  dispose(): void {
    this.generation++; this.running = false;
    this.active?.abort(); this.active = null; this.entries = [];
  }
  private async run(entries: Entry[]): Promise<void> {
    if (!entries.length) return;
    const generation = ++this.generation;
    this.running = true; this.changed();
    try {
      for (const entry of entries) {
        if (generation !== this.generation) return;
        if (!entry.file) continue;
        entry.state = 'sending'; entry.progress = 0; entry.message = null; entry.retryable = false;
        const controller = new AbortController(); this.active = controller; this.changed();
        try {
          const result = await this.transport(entry.file, entry.requestId, controller.signal, value => {
            if (generation !== this.generation) return;
            entry.progress = Math.max(0, Math.min(100, Math.round(value))); this.changed();
          }, this.manualBatch);
          if (generation !== this.generation) return;
          entry.state = result.replayed ? 'existing' : 'saved'; entry.documentId = result.document.id;
          entry.file = null; entry.progress = null; this.changed(); this.saved(result);
        } catch (error) {
          if (generation !== this.generation) return;
          if (error instanceof IncomingRequestError && error.status === 401) {
            this.clear(); this.sessionExpired(); return;
          }
          const duplicateId = error instanceof IncomingRequestError ? error.existingDocumentId : null;
          if (duplicateId) {
            entry.state = 'existing'; entry.documentId = duplicateId; entry.file = null; entry.progress = null; this.saved();
          } else {
            // A 5xx, unreadable success, timeout or network failure can follow a committed original.
            entry.state = !(error instanceof IncomingRequestError) || error.status === 0 || error.status >= 500 ? 'unknown' : 'failed';
            entry.retryable = true;
          }
          entry.message = errorMessage(error); this.changed();
          // Stop after an ambiguous outcome: no additional unattended requests.
          if (entry.state === 'unknown') return;
        }
      }
    } finally {
      if (generation === this.generation) { this.running = false; this.active = null; this.changed(); }
    }
  }
}

/** Existing endpoint, exactly one file and stable request ID. Manual batch cannot enqueue AI. */
export const sendIncomingOriginal: UploadTransport = (file, requestId, signal, progress, manual) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  const abort = () => xhr.abort();
  const settle = (callback: () => void) => { signal.removeEventListener('abort', abort); callback(); };
  xhr.open('POST', '/api/purchase-documents'); xhr.timeout = 120_000;
  xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total * 100); };
  xhr.upload.onload = () => progress(100);
  xhr.onload = () => settle(() => {
    let body: unknown;
    try { body = JSON.parse(xhr.responseText); } catch { body = null; }
    if (xhr.status < 200 || xhr.status >= 300) { reject(incomingResponseError(xhr.status, body)); return; }
    const document = body && typeof body === 'object' && 'document' in body ? body.document : null;
    if (document && typeof document === 'object' && 'id' in document && typeof document.id === 'number' && Number.isSafeInteger(document.id) && document.id > 0) resolve(body as IncomingDocumentResponse);
    else reject(new IncomingRequestError('Die Antwort konnte nicht gelesen werden. Bitte gespeicherte Belege prüfen oder dieselbe Anfrage abgleichen.'));
  });
  xhr.onerror = () => settle(() => reject(new IncomingRequestError('Die Verbindung ist unterbrochen. Der Ausgang ist unklar; bitte gespeicherte Belege prüfen oder dieselbe Anfrage abgleichen.')));
  xhr.ontimeout = () => settle(() => reject(new IncomingRequestError('Die Antwort dauert zu lange. Der Ausgang ist unklar; bitte gespeicherte Belege prüfen oder dieselbe Anfrage abgleichen.')));
  xhr.onabort = () => settle(() => reject(new DOMException('Upload cancelled', 'AbortError')));
  if (signal.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }
  signal.addEventListener('abort', abort, { once: true });
  const form = new FormData(); form.append('file', file); form.append('uploadRequestId', requestId); if (manual) form.append('analysisMode', 'manual');
  xhr.send(form);
});

