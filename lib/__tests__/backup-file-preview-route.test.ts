import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authorized: true, invalidGraph: false, preview: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get() { throw new Error('Database access is forbidden in the mocked preview-route suite'); } }) }));
vi.mock('@/lib/request-security', () => ({ protectMutation: (handler: unknown) => handler }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.authorized) throw new UnauthorizedError(); return 'synthetic-preview-owner'; }, unauthorizedResponse: () => Response.json({ error: 'Nicht angemeldet' }, { status: 401 }) };
});
vi.mock('@/lib/audit-log', () => ({ auditSecurityEvent: state.audit }));
vi.mock('@/lib/backup-preview', () => ({ createBackupPreview: (backup: { manifest?: unknown }) => { state.preview(); if (state.invalidGraph) throw new Error('Synthetic graph rejected'); return { version: '3.0', type: 'full', totalRecords: 1, manifest: backup.manifest }; } }));

import { POST } from '@/app/api/backup/full/preview/route';
const original = Buffer.from('synthetic-original');
const fileEntry = { kind: 'invoice', sourceName: 'invoice.pdf', zipPath: 'invoices/invoice.pdf', bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') };
async function request({ type = 'full', includeOriginal = true, originalBytes = original } = {}) {
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify({ version: '3.0', type, data: { invoices: [{ id: 1, storedFileName: 'invoice.pdf' }] }, manifest: { fileManifest: [fileEntry] } }));
  if (includeOriginal) zip.file('invoices/invoice.pdf', originalBytes);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  expect(bytes.length).toBeLessThan(10 * 1024);
  const form = new FormData(); form.append('file', new File([bytes], 'synthetic.zip', { type: 'application/zip' }));
  return new NextRequest('http://localhost/api/backup/full/preview', { method: 'POST', body: form });
}

beforeEach(() => { state.authorized = true; state.invalidGraph = false; state.preview.mockClear(); state.audit.mockReset().mockResolvedValue(undefined); });

describe('full preview route file-inspection boundary (mocked auth/graph/audit; no DB)', () => {
  it('returns a visible verified file report only after graph and actual ZIP-byte checks', async () => {
    const response = await POST(await request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preview: { fileCount: 1, fileInspection: { status: 'MANIFEST_VERIFIED', referencedFiles: 1, checkedFiles: 1, verifiedFiles: 1, unlistedFiles: 0 } } });
    expect(state.preview).toHaveBeenCalledTimes(1);
    expect(state.audit).toHaveBeenCalledExactlyOnceWith('synthetic-preview-owner', expect.objectContaining({ event: 'BACKUP_RESTORE_PREVIEW', outcome: 'success' }));
  });

  it.each([
    ['missing', { includeOriginal: false }],
    ['tampered', { originalBytes: Buffer.from('synthetic-tampered') }],
  ] as const)('never returns or audits a successful preview for %s originals', async (_name, options) => {
    const response = await POST(await request(options));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/fehlt im ZIP|Größe|SHA-256/u);
    expect(body).not.toHaveProperty('preview');
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('preserves authentication and shape-validation gates before inspection', async () => {
    state.authorized = false;
    expect((await POST(await request())).status).toBe(401);
    expect(state.preview).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
    state.authorized = true; state.invalidGraph = true;
    const response = await POST(await request());
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Synthetic graph rejected' });
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('rejects concurrent same-owner inspection with 429 and releases its existing processing slot on success and failure', async () => {
    let entered!: () => void, release!: () => void;
    const enteredAudit = new Promise<void>(resolve => { entered = resolve; });
    const releasedAudit = new Promise<void>(resolve => { release = resolve; });
    state.audit.mockImplementationOnce(async () => { entered(); await releasedAudit; });
    const pending = POST(await request());
    await enteredAudit;
    try {
      const blocked = await POST(await request());
      expect(blocked.status).toBe(429); expect(blocked.headers.get('Retry-After')).toBe('1');
      expect(await blocked.json()).toMatchObject({ code: 'PROCESSING_BUSY' });
    } finally { release(); }
    expect((await pending).status).toBe(200);
    expect((await POST(await request({ includeOriginal: false }))).status).toBe(400);
    expect((await POST(await request())).status).toBe(200);
  });

  it('rejects non-file multipart values and JSON-only data packaged as a full ZIP', async () => {
    const form = new FormData(); form.append('file', 'not a File');
    const invalid = await POST(new NextRequest('http://localhost/api/backup/full/preview', { method: 'POST', body: form }));
    expect(invalid.status).toBe(400);
    expect((await POST(await request({ type: 'json' }))).status).toBe(400);
    expect(state.preview).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
});
