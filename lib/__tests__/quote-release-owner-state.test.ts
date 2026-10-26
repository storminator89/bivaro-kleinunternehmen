/** Pure body / mocked read-delegate contracts only; not SQL, storage or HTTP evidence. */
import { describe, expect, it, vi } from 'vitest';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import {
  OwnerQuoteReleaseInputError,
  parseOwnerQuoteReleaseCaptureBody,
} from '@/lib/quote-release-owner-contract';

vi.mock('@/lib/prisma', () => { throw new Error('Real Prisma singleton forbidden in owner state tests'); });
vi.mock('@prisma/client', () => ({ Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } } }));
vi.mock('@/lib/upload-path', () => ({
  isSafeStoredFileName: (name: unknown) => typeof name === 'string' && /^[a-f0-9-]{36}\.[a-z0-9]{1,16}$/u.test(name),
}));
import { OwnerQuoteReleaseStateError, readOwnerQuoteReleaseState } from '@/lib/quote-release-owner-state';

const OWNER = 'synthetic-owner';
const CREATED = '2026-10-26T12:00:00.000Z';
const EXPIRES = '2026-11-01T12:00:00.000Z';
const SHA = 'a'.repeat(64);
const uid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
type Authority = { id: string; userId: string; sourceUserId: string | null; sourceInvoiceId: number | null; boundCustomerId: number | null; revision: number; currentReleaseId: string | null };
function sourceQuote() {
  const quote = {
    id: 10, userId: OWNER, type: 'QUOTE', status: 'SENT', customerId: 20 as number | null,
    fileName: 'private-display-name.pdf', storedFileName: `${uid(90)}.pdf`, invoiceNumber: 'AN-SYNTHETIC-1',
    invoiceDate: new Date('2026-10-01T00:00:00.000Z'), validUntil: new Date('2026-12-01T00:00:00.000Z'), totalAmount: 119,
    parsedData: { customer: { name: 'Frozen private customer', email: 'private@example.invalid' }, internalNote: 'Private source context', items: [] },
    quoteCreateRequestId: uid(91) as string | null, quoteCreateFingerprint: null as string | null,
  };
  quote.quoteCreateFingerprint = quoteCreateFingerprintForInvoice(quote);
  return quote;
}
function release(generation: number) {
  return {
    id: uid(generation), userId: OWNER, authorityId: uid(80), generation, snapshotSha256: SHA,
    createdAt: CREATED, expiresAt: EXPIRES, revokedAt: null as string | null, restoredAccessDisabled: 0,
    // Deliberately over-return private fields: the DTO must still redact them.
    originalArchiveName: `${uid(92)}.pdf`, originalSha256: 'b'.repeat(64), originalBytes: 13,
    sourcePayload: '{"private":"frozen context"}', sourceFingerprint: SHA, requestId: uid(93),
  };
}
function response(releaseId: string) {
  return { userId: OWNER, authorityId: uid(80), releaseId, decision: 'ACCEPT', recordedAt: CREATED,
    confirmationText: 'Private confirmation text', responseRequestId: uid(94), snapshotSha256: SHA };
}
function fixture() {
  const quote = sourceQuote();
  const state = {
    quote: quote as ReturnType<typeof sourceQuote> | null,
    receipt: { userId: OWNER, requestId: quote.quoteCreateRequestId!, invoiceUserId: OWNER, invoiceId: quote.id,
      fingerprint: quote.quoteCreateFingerprint!, pdfSha256: 'c'.repeat(64) } as { userId: string; requestId: string; invoiceUserId: string; invoiceId: number; fingerprint: string; pdfSha256: string } | null,
    authority: null as Authority | null, releases: [] as ReturnType<typeof release>[], responses: [] as ReturnType<typeof response>[],
    convertedChildren: 0, customerExists: true,
  };
  const forbidden = vi.fn((access: string): never => { throw new Error(`Read-only state attempted forbidden access: ${access}`); });
  function readOnly<T extends object>(model: string, reads: T): T {
    return new Proxy(reads, { get(target, key, receiver) {
      if (Object.hasOwn(target, key)) return Reflect.get(target, key, receiver);
      return forbidden(`${model}.${String(key)}`);
    } });
  }
  const tx = {
    invoice: readOnly('invoice', {
      findFirst: vi.fn(async () => structuredClone(state.quote)),
      count: vi.fn(async () => state.convertedChildren),
    }),
    quoteReleaseAuthority: readOnly('quoteReleaseAuthority', { findFirst: vi.fn(async () => structuredClone(state.authority)) }),
    quoteRelease: readOnly('quoteRelease', {
      count: vi.fn(async () => state.releases.length),
      // Only simulate Prisma's requested bound; no actual database executes.
      findMany: vi.fn(async ({ take }: { take: number }) => structuredClone(state.releases.slice(0, take))),
    }),
    quoteElectronicResponse: readOnly('quoteElectronicResponse', {
      findMany: vi.fn(async ({ where, take }: { where: { releaseId: { in: string[] } }; take: number }) => structuredClone(state.responses.filter(row => where.releaseId.in.includes(row.releaseId)).slice(0, take))),
    }),
    quoteCreateReceipt: readOnly('quoteCreateReceipt', { findFirst: vi.fn(async () => structuredClone(state.receipt)) }),
    customer: readOnly('customer', { findFirst: vi.fn(async () => state.customerExists ? { id: 20 } : null) }),
  };
  const api = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(readOnly('transaction', tx))) };
  return { state, tx, api, forbidden, client: api as unknown as Parameters<typeof readOwnerQuoteReleaseState>[0] };
}
type Fixture = ReturnType<typeof fixture>;
function addAuthority(f: Fixture, revision = 1) {
  f.state.authority = { id: uid(80), userId: OWNER, sourceUserId: OWNER, sourceInvoiceId: 10, boundCustomerId: 20, revision, currentReleaseId: uid(revision) };
  f.state.releases = [release(revision)];
}
const read = (f: Fixture) => readOwnerQuoteReleaseState(f.client, OWNER, 10);
function body() {
  return { expected: { authorityId: null as string | null, revision: 0, currentReleaseId: null as string | null, sourceFingerprint: SHA }, expiresAt: EXPIRES, reason: '  Explicit owner review  ' };
}

describe('owner release state, read-only mocked delegates', () => {
  it('returns receipt-bound guards without creating authority, audit, files or any other write', async () => {
    const f = fixture(), before = structuredClone(f.state), result = await read(f);
    expect(result).toEqual({ quoteId: 10, expected: { authorityId: null, revision: 0, currentReleaseId: null, sourceFingerprint: f.state.quote!.quoteCreateFingerprint },
      eligibility: 'RECEIPT_BOUND', validUntil: '2026-12-01T00:00:00.000Z', totalVersions: 0, history: [], hasMore: false, publicAccessEnabled: false });
    expect(f.tx.invoice.findFirst).toHaveBeenCalledWith({ where: { id: 10, userId: OWNER, type: 'QUOTE' }, select: expect.any(Object) });
    expect(f.tx.quoteReleaseAuthority.findFirst).toHaveBeenCalledWith({ where: { userId: OWNER, sourceUserId: OWNER, sourceInvoiceId: 10 } });
    expect(f.tx.quoteCreateReceipt.findFirst).toHaveBeenCalledWith({ where: { userId: OWNER, requestId: uid(91), invoiceUserId: OWNER, invoiceId: 10 }, select: expect.any(Object) });
    expect(f.tx.customer.findFirst).toHaveBeenCalledWith({ where: { id: 20, userId: OWNER }, select: { id: true } });
    expect(f.tx.invoice.count).toHaveBeenCalledWith({ where: { convertedFromQuoteId: 10 } });
    expect(f.api.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 5_000 });
    expect(f.tx.quoteRelease.count).not.toHaveBeenCalled(); expect(f.tx.quoteRelease.findMany).not.toHaveBeenCalled(); expect(f.tx.quoteElectronicResponse.findMany).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
  });
  it('returns null for an owner/type-scoped missing quote without reading any history or receipt', async () => {
    const f = fixture(); f.state.quote = null;
    expect(await read(f)).toBeNull();
    expect(f.tx.quoteReleaseAuthority.findFirst).not.toHaveBeenCalled(); expect(f.tx.quoteCreateReceipt.findFirst).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it.each(['userId', 'id', 'type'] as const)('fails closed if the scoped quote delegate returns a mismatched %s', async field => {
    const f = fixture(); Object.assign(f.state.quote!, { [field]: field === 'id' ? 11 : field === 'type' ? 'INVOICE' : 'foreign-owner' });
    await expect(read(f)).rejects.toBeInstanceOf(OwnerQuoteReleaseStateError);
    expect(f.tx.quoteReleaseAuthority.findFirst).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('requests at most 20 newest owner/authority-scoped rows and exposes only the bounded redacted history DTO', async () => {
    const f = fixture(); addAuthority(f, 23);
    f.state.releases = Array.from({ length: 23 }, (_, index) => ({ ...release(23 - index), revokedAt: index ? CREATED : null, restoredAccessDisabled: index === 2 ? 1 : 0 }));
    f.state.responses = [response(uid(22)), response(uid(1))];
    const result = await read(f);
    expect(f.tx.quoteRelease.count).toHaveBeenCalledWith({ where: { userId: OWNER, authorityId: uid(80) } });
    expect(f.tx.quoteRelease.findMany).toHaveBeenCalledWith({ where: { userId: OWNER, authorityId: uid(80) }, orderBy: { generation: 'desc' }, take: 20,
      select: { id: true, userId: true, authorityId: true, generation: true, snapshotSha256: true, createdAt: true, expiresAt: true, revokedAt: true, restoredAccessDisabled: true } });
    expect(result).toMatchObject({ totalVersions: 23, hasMore: true, publicAccessEnabled: false, expected: { authorityId: uid(80), revision: 23, currentReleaseId: uid(23) } });
    expect(result!.history.map(row => row.generation)).toEqual(Array.from({ length: 20 }, (_, index) => 23 - index));
    expect(f.tx.quoteElectronicResponse.findMany).toHaveBeenCalledWith({ where: { userId: OWNER, authorityId: uid(80), releaseId: { in: result!.history.map(row => row.id) } }, take: 20,
      select: { userId: true, authorityId: true, releaseId: true, decision: true, recordedAt: true } });
    expect(Object.keys(result!).sort()).toEqual(['eligibility', 'expected', 'hasMore', 'history', 'publicAccessEnabled', 'quoteId', 'totalVersions', 'validUntil']);
    expect(Object.keys(result!.expected!).sort()).toEqual(['authorityId', 'currentReleaseId', 'revision', 'sourceFingerprint']);
    for (const row of result!.history) expect(Object.keys(row).sort()).toEqual(['createdAt', 'current', 'expiresAt', 'generation', 'id', 'permanentlyClosed', 'response', 'revokedAt', 'snapshotSha256']);
    expect(result!.history[0]).toMatchObject({ current: true, permanentlyClosed: false, response: null });
    expect(result!.history[1].response).toEqual({ decision: 'ACCEPT', recordedAt: CREATED });
    expect(result!.history[2]).toMatchObject({ current: false, permanentlyClosed: true });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it.each([
    ['legacy source', (f: Fixture) => { f.state.quote!.quoteCreateRequestId = null; }],
    ['missing receipt', (f: Fixture) => { f.state.receipt = null; }],
    ['changed source', (f: Fixture) => { f.state.quote!.parsedData.internalNote = 'Changed after modern receipt'; }],
    ['foreign receipt owner', (f: Fixture) => { f.state.receipt!.invoiceUserId = 'foreign-owner'; }],
    ['changed receipt fingerprint', (f: Fixture) => { f.state.receipt!.fingerprint = 'b'.repeat(64); }],
    ['invalid receipt hash', (f: Fixture) => { f.state.receipt!.pdfSha256 = 'not-a-sha256'; }],
    ['converted quote', (f: Fixture) => { f.state.convertedChildren = 1; }],
    ['foreign or missing customer', (f: Fixture) => { f.state.customerExists = false; }],
  ] as const)('keeps retained history visible but makes %s ineligible without writes', async (_label, change) => {
    const f = fixture(); addAuthority(f); change(f);
    expect(await read(f)).toMatchObject({ eligibility: 'UNAVAILABLE', expected: null, totalVersions: 1, history: [{ id: uid(1) }], publicAccessEnabled: false });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('preserves an existing zero-revision preflight clock and later invalidated high-water guard without creating or relinking it', async () => {
    const f = fixture(); addAuthority(f, 0); f.state.authority!.currentReleaseId = null; f.state.releases = [];
    expect(await read(f)).toMatchObject({ expected: { authorityId: uid(80), revision: 0, currentReleaseId: null }, totalVersions: 0 });
    f.state.authority!.revision = 2; f.state.releases = [{ ...release(1), revokedAt: CREATED }];
    expect(await read(f)).toMatchObject({ expected: { authorityId: uid(80), revision: 2, currentReleaseId: null }, totalVersions: 1, history: [{ current: false }] });
    expect(f.state.authority).toMatchObject({ sourceUserId: OWNER, sourceInvoiceId: 10, revision: 2, currentReleaseId: null }); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('allows a receipt-bound customerless quote without consulting live customer data', async () => {
    const f = fixture(); f.state.quote!.customerId = null;
    expect(await read(f)).toMatchObject({ eligibility: 'RECEIPT_BOUND' }); expect(f.tx.customer.findFirst).not.toHaveBeenCalled();
  });
  it.each([
    ['missing current row', (f: Fixture) => { f.state.authority!.currentReleaseId = uid(99); }],
    ['revision/generation mismatch', (f: Fixture) => { f.state.authority!.revision = 2; }],
    ['revoked current row', (f: Fixture) => { f.state.releases[0].revokedAt = CREATED; }],
    ['restored permanently closed current row', (f: Fixture) => { f.state.releases[0].restoredAccessDisabled = 1; }],
    ['detached/foreign source authority', (f: Fixture) => { f.state.authority!.sourceUserId = null; }],
    ['changed customer binding', (f: Fixture) => { f.state.authority!.boundCustomerId = 21; }],
  ] as const)('fails closed on %s instead of producing a capture guard', async (_label, change) => {
    const f = fixture(); addAuthority(f); change(f);
    await expect(read(f)).rejects.toBeInstanceOf(OwnerQuoteReleaseStateError); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it.each([
    ['foreign release owner', (f: Fixture) => { f.state.releases[0].userId = 'foreign-owner'; }],
    ['foreign response association', (f: Fixture) => { f.state.responses = [{ ...response(uid(1)), authorityId: uid(79) }]; }],
    ['duplicate response', (f: Fixture) => { f.state.responses = [response(uid(1)), response(uid(1))]; }],
  ] as const)('rejects %s from a faulty delegate without leaking it', async (_label, change) => {
    const f = fixture(); addAuthority(f); change(f);
    await expect(read(f)).rejects.toBeInstanceOf(OwnerQuoteReleaseStateError); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('rejects invalid owner and quote identity guards before opening any transaction', async () => {
    for (const [owner, quoteId] of [['../foreign', 10], ['', 10], [123 as unknown as string, 10], [OWNER, 0], [OWNER, 1.5], [OWNER, 2147483648]] as const) {
      const f = fixture();
      await expect(readOwnerQuoteReleaseState(f.client, owner, quoteId)).rejects.toBeInstanceOf(OwnerQuoteReleaseStateError);
      expect(f.api.$transaction).not.toHaveBeenCalled();
    }
  });
});

describe('owner capture body, closed pure transport contract', () => {
  it('copies and freezes only explicit revision/pointer/fingerprint guards and trims the owner reason', () => {
    const input = body(), result = parseOwnerQuoteReleaseCaptureBody(input);
    expect(result).toEqual({ ...input, reason: 'Explicit owner review' });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.expected)).toBe(true);
    input.expected.sourceFingerprint = 'b'.repeat(64); input.reason = 'Caller changed';
    expect(result.expected.sourceFingerprint).toBe(SHA); expect(result.reason).toBe('Explicit owner review');
    const replacement = body(); replacement.expected = { authorityId: uid(80), revision: 2, currentReleaseId: uid(2), sourceFingerprint: SHA };
    expect(parseOwnerQuoteReleaseCaptureBody(replacement).expected).toEqual(replacement.expected);
  });
  it('rejects unknown owner/quote/body keys, nested fields, inherited data, symbols and accessors without invoking them', () => {
    const getter = vi.fn(() => 'No getter should run');
    const accessor = body(); Object.defineProperty(accessor, 'reason', { enumerable: true, get: getter });
    const hidden = body(); Object.defineProperty(hidden, 'reason', { value: 'Hidden', enumerable: false });
    const inherited = Object.assign(Object.create({ userId: OWNER }), body());
    const inputs = [{ ...body(), userId: OWNER }, { ...body(), quoteId: 10 }, { ...body(), enablePublicAccess: true },
      { ...body(), expected: { ...body().expected, userId: OWNER } }, { ...body(), expected: { ...body().expected, staleRetry: true } },
      { ...body(), [Symbol('owner')]: OWNER }, accessor, hidden, inherited];
    for (const input of inputs) expect(() => parseOwnerQuoteReleaseCaptureBody(input)).toThrow(OwnerQuoteReleaseInputError);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects invalid or reserved revisions and absent-authority pointer combinations, without coercion', () => {
    for (const expected of [{ ...body().expected, revision: -1 }, { ...body().expected, revision: 0.5 }, { ...body().expected, revision: '0' },
      { ...body().expected, authorityId: uid(80), revision: 2147483646 }, { ...body().expected, revision: 1 }, { ...body().expected, currentReleaseId: uid(1) }]) {
      expect(() => parseOwnerQuoteReleaseCaptureBody({ ...body(), expected })).toThrow(OwnerQuoteReleaseInputError);
    }
    expect(parseOwnerQuoteReleaseCaptureBody({ ...body(), expected: { ...body().expected, authorityId: uid(80), revision: 2147483645 } }).expected.revision).toBe(2147483645);
  });
  it('requires canonical UUID4/hash/UTC fields and a bounded explicit reason', () => {
    for (const input of [
      { ...body(), expected: { ...body().expected, authorityId: uid(80).replace('-4111-', '-5111-') } },
      { ...body(), expected: { ...body().expected, sourceFingerprint: SHA.toUpperCase() } },
      { ...body(), expiresAt: '2026-11-01T13:00:00.000+01:00' }, { ...body(), expiresAt: '2026-02-30T12:00:00.000Z' },
      { ...body(), reason: ' ' }, { ...body(), reason: 'reason\nwith control' }, { ...body(), reason: 'x'.repeat(501) },
    ]) expect(() => parseOwnerQuoteReleaseCaptureBody(input)).toThrow(OwnerQuoteReleaseInputError);
    expect(parseOwnerQuoteReleaseCaptureBody({ ...body(), reason: 'x'.repeat(500) }).reason).toHaveLength(500);
  });
});
