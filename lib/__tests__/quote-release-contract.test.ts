import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import {
  createQuoteReleaseSnapshot, MAX_QUOTE_RELEASE_METADATA_BYTES,
  parseQuoteReleaseSnapshot, parseQuoteResponseCommand, planQuoteResponse,
  type QuoteResponseCommand, type QuoteResponseReceipt, type QuoteResponseRelease,
} from '@/lib/quote-release-contract';

const original = () => new TextEncoder().encode('%PDF-SYNTHETIC-NOT-A-CONFORMITY-FIXTURE\nA');
const source = () => ({
  type: 'QUOTE', fileName: 'Angebot-SYNTHETIC.pdf', invoiceNumber: 'AN-SYNTHETIC-1',
  invoiceDate: '2026-10-01T00:00:00.000Z', validUntil: '2026-11-01T00:00:00.000Z',
  totalAmount: 119, parsedData: { createdBy: 'bivaro', currency: 'EUR', company: { name: 'Synthetischer Anbieter' }, customer: { name: 'Synthetischer Empfänger' }, items: [{ description: 'Synthetische Leistung', quantity: 1, unitPrice: 100 }], taxMode: 'standard' },
});
const snapshot = () => createQuoteReleaseSnapshot(source(), original());
const releaseId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const now = '2026-10-26T06:00:00.000Z';
const release = (): QuoteResponseRelease => ({ releaseId, snapshotSha256: snapshot().snapshotSha256, createdAt: '2026-10-01T10:00:00.000Z', expiresAt: '2026-11-01T10:00:00.000Z', revokedAt: null, restoredAccessDisabled: false });
const command = (): QuoteResponseCommand => ({ version: 1, requestId, releaseId, snapshotSha256: snapshot().snapshotSha256, decision: 'ACCEPT', comment: null });
const receipt = (): QuoteResponseReceipt => ({ ...command(), recordedAt: '2026-10-25T12:00:00.000Z' });
const plan = (changes: Partial<Parameters<typeof planQuoteResponse>[0]> = {}) => planQuoteResponse({ release: release(), currentReleaseId: releaseId, currentSnapshotSha256: snapshot().snapshotSha256, command: command(), previous: null, now, ...changes });

describe('quote release exact-original snapshot identity, no I/O', () => {
  it('uses existing portable semantic identity plus exact bytes and a distinct version domain', () => {
    const result = snapshot();
    expect(result.sourceFingerprint).toBe(quoteCreateFingerprintForInvoice(source()));
    expect(result.originalSha256).toBe(createHash('sha256').update(original()).digest('hex'));
    expect(result.originalBytes).toBe(original().byteLength);
    expect(result.snapshotSha256).not.toBe(result.sourceFingerprint);
    expect(result.snapshotSha256).not.toBe(result.originalSha256);
    // Independently derived with Python hashlib and canonical UTF-8 JSON.
    expect(result).toEqual({ version: 1, sourceFingerprint: 'f48f3c11038addb4f3eeb3e64eca08955c976df65c830e1916be8a83a36725d8', originalSha256: 'b53653511d0c1a2b182d51d97269f3b06edfcde49e9f5854f99abbb8c34f87d5', originalBytes: 41, snapshotSha256: 'f57d1f6fb9d370ff177a0a658b4d6072059145bfbafafdcf4849d76ef3f34eb8' });
    expect(parseQuoteReleaseSnapshot(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['originalBytes', 'originalSha256', 'snapshotSha256', 'sourceFingerprint', 'version']);
  });
  it('canonicalizes reordered parsed JSON without normalizing content', () => {
    const row = source();
    const reordered = { ...row, parsedData: Object.fromEntries(Object.entries(row.parsedData).reverse()) };
    expect(createQuoteReleaseSnapshot(reordered, original())).toEqual(snapshot());
    expect(createQuoteReleaseSnapshot({ ...row, parsedData: { ...row.parsedData, company: { name: 'Synthetischer Anbieter ' } } }, original()).snapshotSha256).not.toBe(snapshot().snapshotSha256);
  });
  it('changes identity when even one original byte changes despite equal semantic metadata', () => {
    const changed = original(); changed[changed.length - 1] = 66;
    const result = createQuoteReleaseSnapshot(source(), changed);
    expect(result.sourceFingerprint).toBe(snapshot().sourceFingerprint);
    expect(result.originalBytes).toBe(snapshot().originalBytes);
    expect(result.snapshotSha256).not.toBe(snapshot().snapshotSha256);
  });
  it.each([
    { invoiceNumber: 'AN-SYNTHETIC-2' }, { fileName: 'other.pdf' }, { invoiceDate: '2026-10-02T00:00:00.000Z' },
    { validUntil: null }, { totalAmount: 120 }, { parsedData: { currency: 'EUR', items: [] } },
  ])('invalidates the snapshot for changed fixed source content %j', change => {
    expect(createQuoteReleaseSnapshot({ ...source(), ...change }, original()).snapshotSha256).not.toBe(snapshot().snapshotSha256);
  });
  it('does not reinterpret manual follow-up, status, tenant-local IDs or storage names as content', () => {
    expect(createQuoteReleaseSnapshot({ ...source(), userId: 'other-local-owner', customerId: 999, storedFileName: 'remapped.pdf', status: 'ACCEPTED', quoteResponseNote: 'Manual only', quoteFollowUpOn: '2026-10-30' }, original())).toEqual(snapshot());
  });
  it('accepts existing Date rows and is independent of a mutable original input after hashing', () => {
    const bytes = original(), row = source();
    const result = createQuoteReleaseSnapshot({ ...row, invoiceDate: new Date(row.invoiceDate), validUntil: new Date(row.validUntil) }, bytes);
    bytes.fill(0); row.parsedData.company.name = 'Changed after capture';
    expect(result).toEqual(snapshot());
  });
  it.each([
    { type: 'INVOICE' }, { type: 'CREDIT_NOTE' }, { invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: '\nAN-1' },
    { fileName: '' }, { fileName: 'a'.repeat(256) }, { totalAmount: null }, { totalAmount: Infinity }, { totalAmount: -1 }, { totalAmount: -0 },
    { invoiceDate: '2026-02-30T00:00:00.000Z' }, { invoiceDate: '2026-10-01' }, { validUntil: undefined },
    { parsedData: [] }, { parsedData: null }, { parsedData: { value: undefined } }, { parsedData: { value: NaN } },
    { parsedData: { value: -0 } }, { parsedData: { value: BigInt(1) } }, { parsedData: { value: new Date() } },
  ])('rejects unsupported or lossy source values, case %#', change => expect(() => createQuoteReleaseSnapshot({ ...source(), ...change }, original())).toThrow());
  it('rejects accessors without evaluating them', () => {
    let evaluations = 0;
    const accessor = Object.defineProperty({}, 'private', { enumerable: true, get() { evaluations++; return 'secret'; } });
    expect(() => createQuoteReleaseSnapshot({ ...source(), parsedData: accessor }, original())).toThrow();
    expect(evaluations).toBe(0);
  });
  it('rejects sparse arrays, extra array properties, hidden fields and symbol fields', () => {
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    for (const parsedData of [{ rows: Array(2) }, { rows: Object.assign([1], { extra: 1 }) }, hidden, { [Symbol('hidden')]: 1 }]) {
      expect(() => createQuoteReleaseSnapshot({ ...source(), parsedData }, original())).toThrow();
    }
  });
  it('bounds cyclic/deep/wide/UTF-8 metadata before hashing, without large fixtures', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    let deep: unknown = null; for (let index = 0; index < 33; index++) deep = [deep];
    for (const parsedData of [cyclic, { deep }, { wide: Array(20_001).fill(null) }, { long: 'ä'.repeat(MAX_QUOTE_RELEASE_METADATA_BYTES / 2) }]) {
      expect(() => createQuoteReleaseSnapshot({ ...source(), parsedData }, original())).toThrow();
    }
  });
  it('rejects empty original bytes without parsing, rendering or opening a PDF', () => expect(() => createQuoteReleaseSnapshot(source(), new Uint8Array())).toThrow());
  it.each([{ version: 2 }, { originalSha256: 'A'.repeat(64) }, { originalBytes: 0 }, { originalBytes: 1.5 }, { snapshotSha256: 'a'.repeat(64) }, { extra: true }])('rejects changed/malformed persisted snapshot envelopes %j', change => expect(() => parseQuoteReleaseSnapshot({ ...snapshot(), ...change })).toThrow());
});

describe('quote response commands and append-only pure planning, no authority granted', () => {
  it.each(['ACCEPT', 'REJECT'] as const)('plans one immutable explicit %s command at the provided server instant', decision => {
    const result = plan({ command: { ...command(), decision, comment: 'Synthetischer Kommentar' } });
    expect(result).toEqual({ kind: 'APPEND', receipt: { ...command(), decision, comment: 'Synthetischer Kommentar', recordedAt: now } });
    if (result.kind === 'APPEND') expect(Object.isFrozen(result.receipt)).toBe(true);
  });
  it('replays only the exact command and preserves the original receipt time', () => {
    const result = plan({ previous: receipt(), command: Object.fromEntries(Object.entries(command()).reverse()) });
    expect(result).toEqual({ kind: 'REPLAY', receipt: receipt() });
  });
  it.each([{ requestId: otherId }, { decision: 'REJECT' }, { comment: 'Other comment' }])('does not rewrite a prior decision for %j', change => {
    const previous = receipt(); const before = structuredClone(previous);
    expect(plan({ previous, command: { ...command(), ...change } })).toEqual({ kind: 'CONFLICT' });
    expect(previous).toEqual(before);
  });
  it.each([
    [{ restoredAccessDisabled: true }, 'RESTORED'],
    [{ revokedAt: '2026-10-26T05:00:00.000Z' }, 'REVOKED'],
    [{ expiresAt: now }, 'EXPIRED'],
    [{ createdAt: '2026-10-27T00:00:00.000Z' }, 'NOT_YET_ACTIVE'],
  ] as const)('does not disclose even an exact prior receipt when unavailable: %j', (change, reason) => {
    // A future-created release cannot legitimately possess an earlier receipt.
    expect(plan({ release: { ...release(), ...change }, previous: reason === 'NOT_YET_ACTIVE' ? null : receipt() })).toEqual({ kind: 'UNAVAILABLE', reason });
  });
  it('allows the exact creation instant and blocks the exact expiration instant', () => {
    expect(plan({ now: release().createdAt }).kind).toBe('APPEND');
    expect(plan({ now: release().expiresAt })).toEqual({ kind: 'UNAVAILABLE', reason: 'EXPIRED' });
  });
  it('blocks altered originals and mismatched command releases even for a previously accepted command', () => {
    const changed = createQuoteReleaseSnapshot(source(), new Uint8Array([1, 2, 3])).snapshotSha256;
    expect(plan({ previous: receipt(), currentSnapshotSha256: changed })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
    expect(plan({ command: { ...command(), releaseId: otherId } })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
    expect(plan({ command: { ...command(), snapshotSha256: changed } })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
  });
  it.each([null, receipt()])('blocks the old release after an identical-content replacement, previous %#', previous => {
    // A valid command for old A still matches A's persisted row and exact content.
    // The target-owned current release slot, not the content hash, now names B.
    expect(plan({ currentReleaseId: otherId, previous })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
    expect(plan({ release: { ...release(), releaseId: otherId }, currentReleaseId: otherId, command: { ...command(), releaseId: otherId } }).kind).toBe('APPEND');
  });
  it.each([null, receipt()])('keeps an explicitly invalidated release unavailable, previous %#', previous => {
    expect(plan({ currentReleaseId: null, previous })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
  });
  it('does not resurrect an old release when source bytes/content change back', () => {
    const changed = createQuoteReleaseSnapshot(source(), new Uint8Array([1, 2, 3])).snapshotSha256;
    expect(plan({ currentReleaseId: null, currentSnapshotSha256: changed })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
    // A -> B -> A source identity is not authority to restore the retired slot.
    expect(plan({ currentReleaseId: null, currentSnapshotSha256: snapshot().snapshotSha256 })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
    expect(plan({ currentReleaseId: otherId, currentSnapshotSha256: snapshot().snapshotSha256, previous: receipt() })).toEqual({ kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' });
  });
  it.each([undefined, 'wrong', '00000000-0000-0000-0000-000000000000'])('rejects unknown or malformed current release authority, case %#', currentReleaseId => {
    expect(() => plan({ currentReleaseId } as unknown as Partial<Parameters<typeof planQuoteResponse>[0]>)).toThrow();
  });
  it('keeps manual quote status/notes out of electronic response evidence', () => {
    expect(() => parseQuoteResponseCommand({ ...command(), status: 'ACCEPTED' })).toThrow();
    expect(() => parseQuoteResponseCommand({ ...command(), quoteResponseNote: 'Phone call' })).toThrow();
    expect(plan().kind).toBe('APPEND'); // A plan alone still performs no write.
  });
  it('does not pretend a pure plan enforces transaction uniqueness or concurrent writes', () => {
    expect(plan().kind).toBe('APPEND');
    expect(plan({ command: { ...command(), requestId: otherId, decision: 'REJECT' } }).kind).toBe('APPEND');
    // A future caller must serialize competing plans and persist at most one.
    // Once one actual receipt is supplied, the opposite command conflicts.
    expect(plan({ previous: receipt(), command: { ...command(), requestId: otherId, decision: 'REJECT' } })).toEqual({ kind: 'CONFLICT' });
  });
  it.each([
    { version: 2 }, { requestId: 'wrong' }, { requestId: requestId.toUpperCase().replace('2', 'A') }, { releaseId: '00000000-0000-0000-0000-000000000000' },
    { snapshotSha256: 'A'.repeat(64) }, { decision: 'ACCEPTED' }, { decision: 'OPENED' }, { comment: '' }, { comment: ' padded ' },
    { comment: 'x'.repeat(501) }, { comment: 'line\nbreak' }, { comment: false }, { extra: true },
  ])('rejects malformed/unconfirmed command data %j', change => expect(() => parseQuoteResponseCommand({ ...command(), ...change })).toThrow());
  it('accepts a 500-character plain-text comment literally, without rendering HTML', () => {
    const prefix = '<script>not executed</script>';
    const comment = prefix + 'x'.repeat(500 - prefix.length);
    expect(comment.length).toBe(500);
    expect(parseQuoteResponseCommand({ ...command(), comment }).comment).toBe(comment);
  });
  it.each([
    { recordedAt: '2026-02-30T00:00:00.000Z' }, { recordedAt: '2026-12-01T00:00:00.000Z' },
    { recordedAt: '2026-10-01T09:59:59.999Z' }, { releaseId: otherId }, { snapshotSha256: 'a'.repeat(64) },
  ])('fails closed on contradictory stored response evidence %j', change => expect(() => plan({ previous: { ...receipt(), ...change } })).toThrow());
  it('rejects unknown restore authority and noncanonical timestamps', () => {
    expect(() => plan({ release: { ...release(), restoredAccessDisabled: undefined } as unknown as QuoteResponseRelease })).toThrow();
    expect(() => plan({ release: { ...release(), expiresAt: release().createdAt } })).toThrow();
    expect(() => plan({ release: { ...release(), revokedAt: '2026-09-01T00:00:00.000Z' } })).toThrow();
    expect(() => plan({ now: '2026-10-26T08:00:00+02:00' })).toThrow();
  });
});
