import { describe, expect, it, vi } from 'vitest';
import { IncomingUploadQueue, MAX_INCOMING_QUEUE_BYTES, sendIncomingOriginal, validateIncomingSelection, type UploadTransport } from '@/components/purchases/incoming-upload-queue';
import { IncomingRequestError } from '@/components/purchases/incoming-document-ui';
import type { IncomingDocumentResponse } from '@/lib/purchase-documents/types';

const file = (name = 'synthetic.xml') => new File(['<synthetic/>'], name, { type: 'application/xml' });
const saved = (id: number, replayed = false) => ({ document: { id }, replayed }) as IncomingDocumentResponse;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(transport: UploadTransport) {
  const changed = vi.fn(), expired = vi.fn(), refreshed = vi.fn();
  const queue = new IncomingUploadQueue(transport, changed, expired, refreshed);
  return { queue, changed, expired, refreshed };
}

describe('bounded in-memory original queue', () => {
  it('checks aggregate limits without reading bytes, retaining no rejected selection', () => {
    expect(validateIncomingSelection(Array.from({ length: 21 }, () => ({ size: 1 })))).toContain('20');
    expect(validateIncomingSelection([{ size: MAX_INCOMING_QUEUE_BYTES }, { size: 1 }])).toContain('100 MiB');
    expect(validateIncomingSelection([{ size: MAX_INCOMING_QUEUE_BYTES }])).toBeNull();
    const { queue } = fixture(vi.fn()); queue.select([file()]);
    expect(queue.select(Array.from({ length: 21 }, () => file()))).toContain('20'); expect(queue.rows()).toEqual([]);
  });
  it('retains mixed per-file errors but sends valid originals only after explicit start', async () => {
    const transport = vi.fn<UploadTransport>().mockResolvedValue(saved(1));
    const { queue } = fixture(transport);
    queue.select([file('valid.xml'), file('not-supported.zip'), new File([], 'empty.pdf')]);
    expect(transport).not.toHaveBeenCalled();
    expect(queue.rows().map(row => row.state)).toEqual(['queued', 'failed', 'failed']);
    expect(queue.rows().slice(1).every(row => !row.retryable)).toBe(true);
    await queue.start(); expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][4]).toBe(true); // A mixed batch never inherits paid automation.
    expect(queue.rows()[0]).toMatchObject({ state: 'saved', documentId: 1 });
    expect('file' in queue.rows()[0]).toBe(false);
  });
  it('preserves lower individual bounds and does not read file bytes during selection', () => {
    const { queue } = fixture(vi.fn());
    const oversized = { name: 'photo.png', size: 10 * 1024 * 1024 + 1, arrayBuffer: vi.fn() } as unknown as File;
    queue.select([oversized]); expect(queue.rows()[0]).toMatchObject({ state: 'failed', retryable: false });
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  });
  it('runs at most one request, ignores repeated start and never resends successes', async () => {
    const gate = deferred<IncomingDocumentResponse>();
    const transport = vi.fn<UploadTransport>().mockReturnValueOnce(gate.promise).mockResolvedValue(saved(2));
    const { queue } = fixture(transport); queue.select([file('one.xml'), file('two.xml')]);
    const work = queue.start(); await queue.start();
    expect(transport).toHaveBeenCalledTimes(1); expect(queue.busy).toBe(true);
    expect(queue.select([file('new.xml')])).toContain('stoppen');
    gate.resolve(saved(1)); await work;
    expect(transport).toHaveBeenCalledTimes(2); expect(queue.busy).toBe(false);
    await queue.start(); await queue.retry(queue.rows()[0].requestId);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(call => call[4])).toEqual([true, true]);
  });
  it('preserves existing single-file opt-in policy rather than granting new AI consent', async () => {
    const transport = vi.fn<UploadTransport>().mockResolvedValue(saved(1)); const { queue } = fixture(transport);
    queue.select([file()]); await queue.start(); expect(transport.mock.calls[0][4]).toBe(false);
  });
  it('maps exact SHA duplicate and request replay to existing records without retry', async () => {
    const transport = vi.fn<UploadTransport>().mockRejectedValueOnce(new IncomingRequestError('already archived', 409, 7)).mockResolvedValueOnce(saved(8, true));
    const { queue } = fixture(transport); queue.select([file('renamed.xml'), file('replayed.xml')]); await queue.start();
    expect(queue.rows().map(row => [row.state, row.documentId, row.retryable])).toEqual([['existing', 7, false], ['existing', 8, false]]);
    await queue.retry(queue.rows()[0].requestId); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('continues after a known failure and retries only the selected failure with the same UUID', async () => {
    const transport = vi.fn<UploadTransport>().mockResolvedValueOnce(saved(1)).mockRejectedValueOnce(new IncomingRequestError('busy', 429)).mockResolvedValueOnce(saved(3)).mockResolvedValueOnce(saved(2));
    const { queue } = fixture(transport); queue.select([file('one.xml'), file('two.xml'), file('three.xml')]); await queue.start();
    expect(queue.rows().map(row => row.state)).toEqual(['saved', 'failed', 'saved']);
    const id = queue.rows()[1].requestId; await queue.retry(id);
    expect(transport.mock.calls.map(call => call[1])).toEqual([queue.rows()[0].requestId, id, queue.rows()[2].requestId, id]);
    expect(queue.rows().every(row => row.state === 'saved')).toBe(true);
  });
  it.each([new IncomingRequestError('network'), new IncomingRequestError('server', 500), new Error('unreadable response')])('stops on uncertain commit and reconciles deliberately with stable identity (%s)', async error => {
    const transport = vi.fn<UploadTransport>().mockRejectedValueOnce(error).mockResolvedValueOnce(saved(1, true)).mockResolvedValueOnce(saved(2));
    const { queue } = fixture(transport); queue.select([file('unclear.xml'), file('waiting.xml')]);
    const id = queue.rows()[0].requestId; await queue.start();
    expect(queue.rows().map(row => row.state)).toEqual(['unknown', 'queued']); expect(queue.busy).toBe(false);
    await queue.retry(id); expect(transport.mock.calls[1][1]).toBe(id);
    expect(queue.rows().map(row => row.state)).toEqual(['existing', 'queued']);
    await queue.start(); expect(queue.rows()[1].state).toBe('saved');
  });
  it('clears all tenant/file details after session expiry following partial success; starts no fourth file', async () => {
    const transport = vi.fn<UploadTransport>().mockResolvedValueOnce(saved(1)).mockResolvedValueOnce(saved(2)).mockRejectedValueOnce(new IncomingRequestError('session', 401));
    const { queue, expired } = fixture(transport); queue.select([file('one.xml'), file('two.xml'), file('three.xml'), file('four.xml')]);
    await queue.start(); expect(transport).toHaveBeenCalledTimes(3); expect(expired).toHaveBeenCalledOnce();
    expect(queue.rows()).toEqual([]); expect(queue.busy).toBe(false);
  });
  it('cancel prevents new starts, preserves saved results, and never claims rollback of an in-flight commit', async () => {
    const gate = deferred<IncomingDocumentResponse>();
    const transport = vi.fn<UploadTransport>().mockResolvedValueOnce(saved(1)).mockReturnValueOnce(gate.promise);
    const { queue } = fixture(transport); queue.select([file('saved.xml'), file('unclear.xml'), file('not-started.xml')]);
    const work = queue.start(); await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const lateProgress = transport.mock.calls[1][3]; queue.cancel();
    expect(transport.mock.calls[1][2].aborted).toBe(true);
    expect(queue.rows().map(row => row.state)).toEqual(['saved', 'unknown', 'cancelled']);
    lateProgress(100); gate.resolve(saved(2)); await work;
    expect(queue.rows().map(row => row.state)).toEqual(['saved', 'unknown', 'cancelled']);
    await queue.start(); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('synchronous dispose aborts, clears silently and blocks a deferred result from starting the next file or notifying the unmounted owner', async () => {
    const gate = deferred<IncomingDocumentResponse>(); const transport = vi.fn<UploadTransport>().mockReturnValue(gate.promise);
    const { queue, changed, expired, refreshed } = fixture(transport);
    queue.select([file('old-account.xml'), file('must-not-start.xml')]); const work = queue.start();
    const notifications = changed.mock.calls.length; queue.dispose();
    expect(transport.mock.calls[0][2].aborted).toBe(true); expect(queue.rows()).toEqual([]); expect(changed).toHaveBeenCalledTimes(notifications);
    transport.mock.calls[0][3](100); gate.resolve(saved(9)); await work;
    expect(transport).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(notifications);
    expect(refreshed).not.toHaveBeenCalled(); expect(expired).not.toHaveBeenCalled(); expect(queue.busy).toBe(false);
    queue.clear(); expect(changed).toHaveBeenCalledTimes(notifications + 1); // Normal user clear still notifies.
  });
  it('discard/account switch suppresses late responses and progress; the new selection is never auto-started', async () => {
    const gate = deferred<IncomingDocumentResponse>(); const transport = vi.fn<UploadTransport>().mockReturnValue(gate.promise);
    const { queue, refreshed } = fixture(transport); queue.select([file('old-account.xml')]); const work = queue.start();
    queue.clear(); queue.select([file('new-account.xml')]); transport.mock.calls[0][3](100); gate.resolve(saved(9)); await work;
    expect(queue.rows()).toMatchObject([{ fileName: 'new-account.xml', state: 'queued', progress: null }]);
    expect(refreshed).not.toHaveBeenCalled(); expect(queue.busy).toBe(false);
  });
});

describe('single-file queue HTTP boundary', () => {
  it('sends a single file, stable key and manual opt-out only for a batch; treats malformed success as unknown', async () => {
    const requests: FakeXhr[] = [];
    class FakeXhr {
      upload = {}; status = 201; responseText = JSON.stringify(saved(3)); timeout = 0;
      onload!: () => void; onerror!: () => void; ontimeout!: () => void; onabort!: () => void;
      form!: FormData; open = vi.fn(); abort = vi.fn(() => this.onabort());
      send = (form: FormData) => { this.form = form; requests.push(this); };
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    try {
      const progress = vi.fn(); const controller = new AbortController(); const original = file();
      const work = sendIncomingOriginal(original, 'stable-key', controller.signal, progress, true);
      const request = requests[0]; expect(request.form.getAll('file')).toHaveLength(1);
      expect(request.form.get('uploadRequestId')).toBe('stable-key'); expect(request.form.get('analysisMode')).toBe('manual');
      request.onload(); await expect(work).resolves.toMatchObject({ document: { id: 3 } });
      controller.abort(); expect(request.abort).not.toHaveBeenCalled(); // Settled request removes its listener.
      const invalid = sendIncomingOriginal(original, 'another-key', new AbortController().signal, progress, false);
      expect(requests[1].form.has('analysisMode')).toBe(false); requests[1].responseText = '{invalid'; requests[1].onload();
      await expect(invalid).rejects.toMatchObject({ status: 0 });
    } finally { vi.unstubAllGlobals(); }
  });
});
