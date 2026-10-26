/** Mocked service/delegate contract only: no SQL, transaction or filesystem proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import { createQuoteReleaseSnapshot } from '@/lib/quote-release-contract';

const mocks = vi.hoisted(() => ({ audit: vi.fn(), read: vi.fn(), version: vi.fn(), stage: vi.fn(), lstat: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/prisma', () => { throw new Error('Real Prisma singleton forbidden in mocked owner capture tests'); });
vi.mock('@prisma/client', () => ({ Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' }, sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }) } }));
vi.mock('@/lib/audit-log', () => ({ createFinancialAuditLog: mocks.audit }));
vi.mock('@/lib/quote-release-original', () => ({ readQuoteReleaseOriginal: mocks.read, quoteReleaseOriginalVersion: mocks.version, stageQuoteReleaseOriginal: mocks.stage }));
vi.mock('node:fs/promises', () => ({ lstat: mocks.lstat }));
vi.mock('@/lib/upload-path', () => ({
  deleteTenantFile: mocks.remove,
  getTenantUploadPath: (owner: string, name: string) => `/mock-only/${owner}/${name}`,
  isSafeStoredFileName: (name: unknown) => typeof name === 'string' && /^[a-f0-9-]{36}\.[a-z0-9]{1,16}$/u.test(name),
}));
import { captureOwnerQuoteRelease, type OwnerQuoteCaptureCommand } from '@/lib/quote-release-owner-capture';

type Row = Record<string, unknown>;
type Authority = { id: string; userId: string; sourceUserId: string | null; sourceInvoiceId: number | null; boundCustomerId: number | null; revision: number; currentReleaseId: string | null };
type File = { bytes: Buffer; version: string };
const OWNER = 'synthetic-owner';
const NOW = '2026-10-26T12:00:00.000Z';
const EXPIRES = '2026-11-01T12:00:00.000Z';
const uid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const SOURCE_NAME = `${uid(91)}.pdf`;
const ORIGINAL = Buffer.from('%PDF-1.7\nSYN\n'); // 13 synthetic bytes, not a valid-PDF assertion.
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function sourceQuote() {
  const quote = { id: 10, userId: OWNER, type: 'QUOTE', status: 'SENT', customerId: 20 as number | null, fileName: 'synthetic.pdf', storedFileName: SOURCE_NAME,
    invoiceNumber: 'AN-SYNTHETIC-1', invoiceDate: new Date('2026-10-01T00:00:00.000Z'), validUntil: new Date('2026-12-01T00:00:00.000Z'), totalAmount: 119,
    parsedData: { company: { name: 'Synthetic company' }, customer: { name: 'Frozen quote customer' }, items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 100 }] },
    quoteCreateRequestId: uid(90) as string | null, quoteCreateFingerprint: null as string | null };
  quote.quoteCreateFingerprint = quoteCreateFingerprintForInvoice(quote);
  return quote;
}

/** Independent simulated rollback/advance behavior, deliberately not a SQL emulator. */
function fixture() {
  const quote = sourceQuote();
  const state = {
    quote, receipt: { userId: OWNER, invoiceUserId: OWNER, invoiceId: quote.id, requestId: quote.quoteCreateRequestId!, fingerprint: quote.quoteCreateFingerprint!, pdfSha256: hash(ORIGINAL), createdAt: new Date('2026-10-01T00:00:00.000Z') } as Row | null,
    authority: null as Authority | null, releases: [] as Row[], audits: [] as Row[], convertedChildren: 0, customerExists: true,
    failAuditOperation: '', referenceFamily: '', advanceOnCreate: true,
    afterStage: undefined as undefined | ((name: string) => void), afterRelease: undefined as undefined | (() => void),
  };
  const files = new Map<string, File>([[SOURCE_NAME, { bytes: Buffer.from(ORIGINAL), version: 'source-v1' }]]);
  let archiveName = '';
  const reference = (family: string) => vi.fn(async () => state.referenceFamily === family ? 1 : 0);
  const invoice = { findFirst: vi.fn(async () => structuredClone(state.quote)), count: vi.fn(async ({ where }: { where: Row }) => Object.hasOwn(where, 'convertedFromQuoteId') ? state.convertedChildren : state.referenceFamily === 'invoice' ? 1 : 0) };
  const quoteRelease = {
    count: reference('quoteRelease'),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(state.releases.find(row => row.id === where.id) ?? null)),
  };
  const executeRaw = vi.fn(async (query: { strings: string[]; values: unknown[] }) => {
      expect(query.strings.join('?')).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      expect(query.values).toHaveLength(13);
      const keys = ['id','userId','authorityId','generation','previousReleaseId','version','sourceFingerprint','originalSha256','originalBytes','snapshotSha256','originalArchiveName','sourcePayload','expiresAt'];
      const data: Row = Object.fromEntries(keys.map((key, index) => [key, query.values[index]]));
      data.restoredAccessDisabled = 0;
      const row = { ...data, createdAt: NOW, revokedAt: null };
      state.releases.push(row);
      if (state.advanceOnCreate) {
        const authority = state.authority!;
        const previous = state.releases.find(release => release.id === authority.currentReleaseId);
        if (previous) previous.revokedAt = NOW;
        authority.revision = Number(data.generation); authority.currentReleaseId = String(data.id);
      }
      state.afterRelease?.();
      return 1;
    });
  const tx = {
    invoice, quoteRelease, $executeRaw: executeRaw,
    customer: { findFirst: vi.fn(async () => state.customerExists ? { id: 20 } : null) },
    quoteCreateReceipt: { findFirst: vi.fn(async () => structuredClone(state.receipt)) },
    quoteReleaseAuthority: {
      findFirst: vi.fn(async () => state.authority?.sourceUserId === OWNER && state.authority.sourceInvoiceId === quote.id ? structuredClone(state.authority) : null),
      findUnique: vi.fn(async () => structuredClone(state.authority)),
      create: vi.fn(async ({ data }: { data: Omit<Authority, 'revision' | 'currentReleaseId'> }) => { state.authority = { ...data, revision: 0, currentReleaseId: null }; return structuredClone(state.authority); }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Row }) => { state.audits.push(structuredClone(data)); if ((data.metadata as Row).operation === state.failAuditOperation) throw new Error('synthetic mandatory audit failure'); }) },
  };
  const api = {
    invoice, quoteRelease, purchaseDocument: { count: reference('purchaseDocument') }, expense: { count: reference('expense') }, settings: { count: reference('settings') }, emailOutbox: { count: reference('emailOutbox') },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const before = structuredClone({ authority: state.authority, releases: state.releases, audits: state.audits });
      try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
    }),
  };
  mocks.audit.mockImplementation(async (data: Row, client: typeof tx) => client.auditLog.create({ data }));
  mocks.lstat.mockImplementation(async (path: string) => {
    const file = files.get(path.slice(path.lastIndexOf('/') + 1));
    if (!file) throw new Error('synthetic missing file');
    return { size: file.bytes.byteLength, isFile: () => true };
  });
  mocks.read.mockImplementation(async (owner: string, binding: { originalArchiveName: string; originalSha256: string; originalBytes: number }) => {
    const file = files.get(binding.originalArchiveName);
    if (owner !== OWNER || !file || file.bytes.byteLength !== binding.originalBytes || hash(file.bytes) !== binding.originalSha256) throw new Error('synthetic original binding failure');
    return { path: `/mock-only/${owner}/${binding.originalArchiveName}`, bytes: Buffer.from(file.bytes), sourceVersion: file.version };
  });
  mocks.version.mockImplementation(async (owner: string, name: string) => {
    const file = files.get(name); if (owner !== OWNER || !file) throw new Error('synthetic missing version'); return file.version;
  });
  mocks.stage.mockImplementation(async (owner: string, binding: { originalArchiveName: string }, bytes: Uint8Array, onCreated: (name: string) => void) => {
    archiveName = binding.originalArchiveName;
    if (owner !== OWNER || files.has(archiveName)) throw new Error('synthetic exclusive collision');
    files.set(archiveName, { bytes: Buffer.from(bytes), version: 'archive-v1' }); onCreated(archiveName);
    state.afterStage?.(archiveName);
    return { path: `/mock-only/${owner}/${archiveName}`, bytes: Buffer.from(bytes), sourceVersion: 'archive-v1' };
  });
  mocks.remove.mockImplementation(async (owner: string, name: string) => { if (owner !== OWNER) throw new Error('wrong cleanup owner'); files.delete(name); });
  const command = (): OwnerQuoteCaptureCommand => ({ userId: OWNER, quoteId: quote.id,
    expected: { authorityId: state.authority?.id ?? null, revision: state.authority?.revision ?? 0, currentReleaseId: state.authority?.currentReleaseId ?? null, sourceFingerprint: quote.quoteCreateFingerprint! },
    expiresAt: EXPIRES, reason: '  Explicit synthetic owner intent  ' });
  return { state, files, tx, api, client: api as unknown as Parameters<typeof captureOwnerQuoteRelease>[0], command, archive: () => archiveName };
}
type Fixture = ReturnType<typeof fixture>;
const operations = (f: Fixture) => f.state.audits.map(row => (row.metadata as Row).operation);
const capture = (f: Fixture, input = f.command()) => captureOwnerQuoteRelease(f.client, input);
function assertSourceUntouched(f: Fixture) { expect(f.files.get(SOURCE_NAME)).toEqual({ bytes: ORIGINAL, version: 'source-v1' }); expect(mocks.remove).not.toHaveBeenCalledWith(OWNER, SOURCE_NAME); }
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('internal owner quote capture, pure mocked delegates and files only', () => {
  it('captures modern owned receipt-bound exact bytes, with frozen customer context and two mandatory audit phases', async () => {
    const f = fixture(), expected = createQuoteReleaseSnapshot(f.state.quote, ORIGINAL), result = await capture(f);
    expect(ORIGINAL.byteLength).toBe(13);
    expect(result).toMatchObject({ ...expected, revision: 1, createdAt: NOW, expiresAt: EXPIRES });
    expect(Object.isFrozen(result)).toBe(true);
    expect(operations(f)).toEqual(['quote.release.authority.preflight', 'quote.release.capture']);
    expect(f.state.authority).toMatchObject({ userId: OWNER, sourceUserId: OWNER, sourceInvoiceId: 10, boundCustomerId: 20, revision: 1, currentReleaseId: result.releaseId });
    expect(f.state.releases[0]).toMatchObject({ restoredAccessDisabled: 0, previousReleaseId: null, originalBytes: 13, originalArchiveName: f.archive() });
    expect(f.tx.$executeRaw.mock.calls[0][0].values).not.toContain(NOW); // Clock comes from SQL, not a bound application timestamp.
    expect(JSON.parse(String(f.state.releases[0].sourcePayload)).document.parsedData.customer).toEqual({ name: 'Frozen quote customer' });
    expect(f.tx.customer.findFirst).toHaveBeenCalledWith({ where: { id: 20, userId: OWNER }, select: { id: true } });
    expect(f.api.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.stage.mock.calls[0][2]).toEqual(ORIGINAL);
    expect(f.files.get(f.archive())?.bytes).toEqual(ORIGINAL);
    assertSourceUntouched(f);
  });
  it.each([
    ['legacy marker', (f: Fixture) => { f.state.quote.quoteCreateRequestId = null; }, 'SOURCE_UNAVAILABLE'],
    ['missing receipt', (f: Fixture) => { f.state.receipt = null; }, 'SOURCE_INVALID'],
    ['foreign receipt', (f: Fixture) => { f.state.receipt!.invoiceUserId = 'foreign'; }, 'SOURCE_INVALID'],
    ['receipt/source fingerprint mismatch', (f: Fixture) => { f.state.receipt!.fingerprint = 'a'.repeat(64); }, 'SOURCE_INVALID'],
    ['stored source fingerprint mismatch', (f: Fixture) => { f.state.quote.quoteCreateFingerprint = 'b'.repeat(64); }, 'SOURCE_INVALID'],
    ['receipt/original hash mismatch', (f: Fixture) => { f.state.receipt!.pdfSha256 = 'c'.repeat(64); }, 'ORIGINAL_UNAVAILABLE'],
    ['converted source', (f: Fixture) => { f.state.convertedChildren = 1; }, 'SOURCE_UNAVAILABLE'],
    ['expired source validity', (f: Fixture) => { f.state.quote.validUntil = new Date('2026-10-30T00:00:00.000Z'); f.state.quote.quoteCreateFingerprint = quoteCreateFingerprintForInvoice(f.state.quote); f.state.receipt!.fingerprint = f.state.quote.quoteCreateFingerprint; }, 'SOURCE_INVALID'],
  ] as const)('rejects %s without creating a release', async (_label, change, code) => {
    const f = fixture(); change(f);
    await expect(capture(f)).rejects.toMatchObject({ code });
    expect(f.state.releases).toEqual([]); expect(mocks.stage).not.toHaveBeenCalled(); assertSourceUntouched(f);
  });
  it('rolls back an initial authority if its mandatory preflight audit fails before any file work', async () => {
    const f = fixture(); f.state.failAuditOperation = 'quote.release.authority.preflight';
    await expect(capture(f)).rejects.toThrow('synthetic mandatory audit failure');
    expect(f.state.authority).toBeNull(); expect(f.state.audits).toEqual([]); expect(mocks.lstat).not.toHaveBeenCalled();
  });
  it('deliberately retains initial authority clock and its audit after a later original-read failure', async () => {
    const f = fixture(); mocks.read.mockRejectedValueOnce(new Error('synthetic unreadable source'));
    await expect(capture(f)).rejects.toMatchObject({ code: 'ORIGINAL_UNAVAILABLE' });
    expect(f.state.authority).toMatchObject({ revision: 0, currentReleaseId: null, sourceInvoiceId: 10 });
    expect(operations(f)).toEqual(['quote.release.authority.preflight']); expect(f.state.releases).toEqual([]); assertSourceUntouched(f);
  });
  it('rolls back only final release/CAS/audit and cleans only the verified unreferenced new stage after final audit failure', async () => {
    const f = fixture(); f.state.failAuditOperation = 'quote.release.capture';
    await expect(capture(f)).rejects.toThrow('synthetic mandatory audit failure');
    expect(f.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(f.state.authority).toMatchObject({ revision: 0, currentReleaseId: null }); expect(f.state.releases).toEqual([]);
    expect(operations(f)).toEqual(['quote.release.authority.preflight']);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(OWNER, f.archive()); expect(f.files.has(f.archive())).toBe(false); assertSourceUntouched(f);
  });
  it('explicit same-content replacement retains prior immutable history/original and failure restores its prior pointer/revocation', async () => {
    const f = fixture(), first = await capture(f), firstArchive = f.archive();
    const prior = f.files.get(firstArchive)!, oldFile = { bytes: Buffer.from(prior.bytes), version: prior.version }, oldGraph = structuredClone({ authority: f.state.authority, releases: f.state.releases, audits: f.state.audits });
    f.state.failAuditOperation = 'quote.release.replace';
    await expect(capture(f)).rejects.toThrow('synthetic mandatory audit failure');
    expect({ authority: f.state.authority, releases: f.state.releases, audits: f.state.audits }).toEqual(oldGraph);
    expect(f.files.get(firstArchive)).toEqual(oldFile); expect(mocks.remove).not.toHaveBeenCalledWith(OWNER, firstArchive);
    f.state.failAuditOperation = '';
    const second = await capture(f);
    expect(second.releaseId).not.toBe(first.releaseId); expect(second.snapshotSha256).toBe(first.snapshotSha256); expect(second.revision).toBe(2);
    expect(f.state.releases).toHaveLength(2); expect(f.state.releases[0]).toMatchObject({ id: first.releaseId, revokedAt: NOW });
    expect(f.state.releases[1]).toMatchObject({ previousReleaseId: first.releaseId, revokedAt: null });
    expect(f.files.get(firstArchive)).toEqual(oldFile); expect(operations(f)).toEqual(['quote.release.authority.preflight', 'quote.release.capture', 'quote.release.replace']); assertSourceUntouched(f);
  });
  it('rejects ABA/high-water drift even when source fingerprint and pointer return to the exact same values', async () => {
    const f = fixture(), fingerprint = f.state.quote.quoteCreateFingerprint;
    f.state.afterStage = () => { f.state.authority!.revision += 2; };
    await expect(capture(f)).rejects.toMatchObject({ code: 'STALE_CAPTURE' });
    expect(f.state.quote.quoteCreateFingerprint).toBe(fingerprint); expect(f.state.authority).toMatchObject({ revision: 2, currentReleaseId: null });
    expect(f.tx.$executeRaw).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('cannot reset or relink a restored detached authority supplied as the expected identity', async () => {
    const f = fixture(); f.state.authority = { id: uid(1), userId: OWNER, sourceUserId: null, sourceInvoiceId: null, boundCustomerId: null, revision: 7, currentReleaseId: null };
    const before = structuredClone(f.state.authority);
    await expect(capture(f)).rejects.toMatchObject({ code: 'STALE_CAPTURE' });
    expect(f.state.authority).toEqual(before); expect(f.tx.quoteReleaseAuthority.create).not.toHaveBeenCalled(); expect(mocks.lstat).not.toHaveBeenCalled();
  });
  it.each(['storage identity', 'receipt timestamp'] as const)('rejects same-fingerprint %s drift instead of capturing a newly rebound original', async field => {
    const f = fixture(); f.state.afterStage = () => { if (field === 'storage identity') f.state.quote.storedFileName = `${uid(92)}.pdf`; else f.state.receipt!.createdAt = new Date('2026-10-02T00:00:00.000Z'); };
    await expect(capture(f)).rejects.toMatchObject({ code: 'STALE_CAPTURE' });
    expect(f.tx.$executeRaw).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce(); assertSourceUntouched(f);
  });
  it.each(['source-before-create', 'source-after-create', 'archive-after-create'] as const)('fails closed for %s version drift', async phase => {
    const f = fixture();
    const drift = () => { f.files.get(phase === 'archive-after-create' ? f.archive() : SOURCE_NAME)!.version = 'changed'; };
    if (phase === 'source-before-create') f.state.afterStage = drift; else f.state.afterRelease = drift;
    await expect(capture(f)).rejects.toMatchObject({ code: 'ORIGINAL_UNAVAILABLE' });
    expect(f.state.releases).toEqual([]); expect(f.state.authority).toMatchObject({ revision: 0, currentReleaseId: null });
    expect(operations(f)).toEqual(['quote.release.authority.preflight']);
    if (phase === 'archive-after-create') { expect(mocks.remove).not.toHaveBeenCalled(); expect(f.files.has(f.archive())).toBe(true); }
    else expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(OWNER, f.archive());
    expect(mocks.remove).not.toHaveBeenCalledWith(OWNER, SOURCE_NAME);
  });
  it.each(['missing', 'partial', 'changed', 'referenced', 'uncertain'] as const)('retains %s stages rather than deleting uncertain or referenced evidence', async scenario => {
    const f = fixture(), failure = new Error('synthetic stage failure');
    if (scenario === 'missing') mocks.stage.mockRejectedValueOnce(failure);
    else if (scenario === 'partial') mocks.stage.mockImplementationOnce(async (_owner: string, binding: { originalArchiveName: string }, _bytes: Uint8Array, onCreated: (name: string) => void) => { f.files.set(binding.originalArchiveName, { bytes: Buffer.from('partial'), version: 'partial' }); onCreated(binding.originalArchiveName); throw failure; });
    else {
      f.state.failAuditOperation = 'quote.release.capture';
      if (scenario === 'referenced') f.state.referenceFamily = 'settings';
      if (scenario === 'changed') f.state.afterRelease = () => { f.files.get(f.archive())!.version = 'changed'; };
      if (scenario === 'uncertain') f.state.afterRelease = () => { mocks.version.mockImplementation(async (_owner: string, name: string) => { if (name === f.archive()) throw failure; return 'source-v1'; }); };
    }
    await expect(capture(f)).rejects.toBeDefined();
    expect(f.state.releases).toEqual([]); expect(operations(f)).toEqual(['quote.release.authority.preflight']);
    expect(mocks.remove).not.toHaveBeenCalled();
    if (scenario !== 'missing') expect(f.files.size).toBe(2); assertSourceUntouched(f);
  });
  it('requires the simulated SQL advance and rolls back a release whose authoritative slot did not advance', async () => {
    const f = fixture(); f.state.advanceOnCreate = false;
    await expect(capture(f)).rejects.toMatchObject({ code: 'CAPTURE_INVARIANT' });
    expect(f.state.releases).toEqual([]); expect(f.state.authority).toMatchObject({ revision: 0, currentReleaseId: null }); expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('snapshots caller scalar guards before awaited work, including nested expected guards and audit reason', async () => {
    const f = fixture(), input = f.command();
    f.state.afterStage = () => { Object.assign(input, { userId: 'foreign', quoteId: 999, expiresAt: '2099-01-01T00:00:00.000Z', reason: 'Changed caller reason' }); Object.assign(input.expected, { authorityId: uid(999), revision: 99, currentReleaseId: uid(998), sourceFingerprint: 'a'.repeat(64) }); };
    const result = await capture(f, input);
    expect(result).toMatchObject({ revision: 1, expiresAt: EXPIRES }); expect(f.state.authority).toMatchObject({ userId: OWNER, sourceInvoiceId: 10 });
    for (const entry of f.state.audits) expect(entry.metadata).toMatchObject({ actorId: OWNER, tenantId: OWNER, reason: 'Explicit synthetic owner intent' });
    assertSourceUntouched(f);
  });
  it('rejects accessor command guards without evaluating them or starting a transaction', async () => {
    const f = fixture(); let reads = 0;
    const input = Object.defineProperty(f.command(), 'expected', { enumerable: true, get() { reads++; return f.command().expected; } });
    await expect(capture(f, input)).rejects.toMatchObject({ code: 'INVALID_COMMAND' }); expect(reads).toBe(0); expect(f.api.$transaction).not.toHaveBeenCalled();
  });
});
