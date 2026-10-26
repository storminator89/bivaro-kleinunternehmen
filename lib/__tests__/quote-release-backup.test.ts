import { describe, expect, it } from 'vitest';
import { MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, QUOTE_RELEASE_BACKUP_SCHEMA_VERSION } from '@/lib/backup-schema-identities';
import { createQuoteReleaseSnapshot } from '@/lib/quote-release-contract';
import { quoteReleaseGraphFromBackup, quoteReleaseImmutableGraphFingerprint, validateQuoteReleaseOriginalManifest, type QuoteReleaseBackupGraph } from '@/lib/quote-release-backup';

const uid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const createdAt = '2026-10-01T10:00:00.000Z';
const recordedAt = '2026-10-02T10:00:00.000Z';
const expiresAt = '2026-11-01T10:00:00.000Z';
const snapshot = createQuoteReleaseSnapshot({ type: 'QUOTE', fileName: 'synthetic.pdf', invoiceNumber: 'AN-SYNTHETIC-1', invoiceDate: createdAt, validUntil: expiresAt, totalAmount: 119, parsedData: { synthetic: true } }, new TextEncoder().encode('%PDF-SYNTHETIC'));
function fixture() {
  return {
    user: { id: 'synthetic-owner' },
    invoices: [{ id: 10, type: 'QUOTE', customerId: 20, status: 'SENT' }],
    quoteReleaseAuthorities: [{ id: uid(1), sourceInvoiceId: 10 as number | null, revision: 3, currentReleaseId: uid(12) as string | null, boundCustomerId: 20 as number | null }],
    quoteReleases: [
      { ...snapshot, id: uid(11), authorityId: uid(1), generation: 1, previousReleaseId: null as string | null, originalArchiveName: `${uid(101)}.pdf`, sourcePayload: ' {"synthetic": true} \n', createdAt, expiresAt, revokedAt: recordedAt as string | null, restoredAccessDisabled: 0 },
      { ...snapshot, id: uid(12), authorityId: uid(1), generation: 3, previousReleaseId: null as string | null, originalArchiveName: `${uid(102)}.pdf`, sourcePayload: '{"synthetic":true}', createdAt, expiresAt, revokedAt: null as string | null, restoredAccessDisabled: 0 },
    ],
    quoteElectronicResponses: [{ version: 1, requestId: uid(21), authorityId: uid(1), releaseId: uid(11), snapshotSha256: snapshot.snapshotSha256, decision: 'ACCEPT', comment: null as string | null, recordedAt }],
  };
}
type Fixture = ReturnType<typeof fixture>;
const parse = (value: Record<string, unknown> = fixture(), identity: string | undefined = QUOTE_RELEASE_BACKUP_SCHEMA_VERSION) => quoteReleaseGraphFromBackup(value, identity);
function originalFiles(graph: QuoteReleaseBackupGraph) {
  return graph.releases.map(row => ({ kind: 'quote-release-original', sourceName: row.originalArchiveName, sha256: row.originalSha256, bytes: row.originalBytes, zipPath: `quote-release-originals/${row.originalArchiveName}` }));
}

describe('quote release closed backup capability, pure no I/O', () => {
  it('requires all three arrays even empty only under the exact new identity', () => {
    expect(parse({ quoteReleaseAuthorities: [], quoteReleases: [], quoteElectronicResponses: [] })).toEqual({ authorities: [], releases: [], responses: [] });
    for (const identity of [undefined, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, `${QUOTE_RELEASE_BACKUP_SCHEMA_VERSION}-future`]) {
      expect(quoteReleaseGraphFromBackup({}, identity)).toEqual({ authorities: [], releases: [], responses: [] });
      for (const key of ['quoteReleaseAuthorities', 'quoteReleases', 'quoteElectronicResponses']) for (const value of [[], null, undefined]) expect(() => quoteReleaseGraphFromBackup({ [key]: value }, identity)).toThrow();
    }
    for (const key of ['quoteReleaseAuthorities', 'quoteReleases', 'quoteElectronicResponses']) {
      const data: Record<string, unknown> = { quoteReleaseAuthorities: [], quoteReleases: [], quoteElectronicResponses: [] }; delete data[key];
      expect(() => parse(data)).toThrow();
      expect(() => parse({ ...data, [key]: Array(10_001).fill(null) })).toThrow();
    }
  });
  it('preserves a legitimate invalidation forest and exact JSON text without mutating or activating it', () => {
    const input = fixture(), before = structuredClone(input), graph = parse(input);
    expect(input).toEqual(before);
    expect(graph.releases[1].previousReleaseId).toBeNull();
    expect(graph.releases[0].sourcePayload).toBe(input.quoteReleases[0].sourcePayload);
    expect(Object.isFrozen(graph.releases[0])).toBe(true);
    expect(graph.responses[0].recordedAt).toBe(graph.releases[0].revokedAt); // same millisecond is legitimate
    input.quoteReleases[0].sourcePayload = '{}';
    expect(graph.releases[0].sourcePayload).toBe(before.quoteReleases[0].sourcePayload);
  });
  it('accepts a predecessor only from an earlier generation of the same authority', () => {
    const data = fixture(); data.quoteReleases[1].previousReleaseId = uid(11);
    expect(parse(data).releases[1].previousReleaseId).toBe(uid(11));
    data.quoteReleases[0].previousReleaseId = uid(12);
    expect(() => parse(data)).toThrow();
  });
  it('reserves MAX_INT for closed historical generations and keeps an empty tombstone valid', () => {
    const data = fixture();
    data.quoteReleaseAuthorities[0].revision = data.quoteReleases[1].generation = 2147483647;
    expect(() => parse(data)).toThrow();
    Object.assign(data.quoteReleaseAuthorities[0], { sourceInvoiceId: null, boundCustomerId: null, currentReleaseId: null });
    data.quoteReleases.forEach(row => { row.restoredAccessDisabled = 1; });
    expect(parse(data).releases[1].generation).toBe(2147483647);
    expect(parse({ quoteReleaseAuthorities: [{ id: uid(2), sourceInvoiceId: null, boundCustomerId: null, currentReleaseId: null, revision: 1 }], quoteReleases: [], quoteElectronicResponses: [] }).authorities).toHaveLength(1);
  });
  it.each([
    ['uppercase UUID', (d: Fixture) => { d.quoteReleaseAuthorities[0].id = uid(1).replace('00000001', '0000000A'); }],
    ['non-v4 UUID', (d: Fixture) => { d.quoteReleases[0].id = uid(11).replace('-4111-', '-5111-'); }],
    ['unknown owner field', (d: Fixture) => { Object.assign(d.quoteReleases[0], { userId: undefined }); }],
    ['source owner spoof', (d: Fixture) => { Object.assign(d.quoteReleaseAuthorities[0], { sourceUserId: 'foreign' }); }],
    ['response owner spoof', (d: Fixture) => { Object.assign(d.quoteElectronicResponses[0], { userId: 'foreign' }); }],
    ['wrong snapshot hash', (d: Fixture) => { d.quoteReleases[0].snapshotSha256 = 'a'.repeat(64); }],
    ['boolean flag', (d: Fixture) => { Object.assign(d.quoteReleases[0], { restoredAccessDisabled: false }); }],
    ['non-Int32 revision', (d: Fixture) => { d.quoteReleaseAuthorities[0].revision = 2147483648; }],
    ['negative zero revision', (d: Fixture) => { d.quoteReleaseAuthorities[0].revision = -0; }],
    ['high-water regression', (d: Fixture) => { d.quoteReleaseAuthorities[0].revision = 2; }],
    ['duplicate authority', (d: Fixture) => { d.quoteReleaseAuthorities.push({ ...d.quoteReleaseAuthorities[0] }); }],
    ['duplicate source', (d: Fixture) => { d.quoteReleaseAuthorities.push({ ...d.quoteReleaseAuthorities[0], id: uid(2), currentReleaseId: null }); }],
    ['duplicate release', (d: Fixture) => { d.quoteReleases.push({ ...d.quoteReleases[0] }); }],
    ['duplicate generation', (d: Fixture) => { d.quoteReleases[1].generation = 1; }],
    ['duplicate archive', (d: Fixture) => { d.quoteReleases[1].originalArchiveName = d.quoteReleases[0].originalArchiveName; }],
    ['duplicate request', (d: Fixture) => { d.quoteElectronicResponses.push({ ...d.quoteElectronicResponses[0], releaseId: uid(12) }); }],
    ['duplicate release response', (d: Fixture) => { d.quoteElectronicResponses.push({ ...d.quoteElectronicResponses[0], requestId: uid(22) }); }],
    ['orphan release', (d: Fixture) => { d.quoteReleases[0].authorityId = uid(2); }],
    ['missing predecessor', (d: Fixture) => { d.quoteReleases[0].previousReleaseId = uid(99); }],
    ['foreign predecessor', (d: Fixture) => { d.quoteReleaseAuthorities.push({ id: uid(2), sourceInvoiceId: null, revision: 1, currentReleaseId: null, boundCustomerId: null }); d.quoteReleases[0].authorityId = uid(2); d.quoteReleases[1].previousReleaseId = uid(11); }],
    ['missing source', (d: Fixture) => { d.invoices = []; }],
    ['foreign source owner', (d: Fixture) => { Object.assign(d.invoices[0], { userId: 'foreign' }); }],
    ['wrong source type', (d: Fixture) => { d.invoices[0].type = 'INVOICE'; }],
    ['customer mirror', (d: Fixture) => { d.quoteReleaseAuthorities[0].boundCustomerId = 21; }],
    ['non-live source', (d: Fixture) => { d.invoices[0].status = 'ACCEPTED'; }],
    ['converted source', (d: Fixture) => { d.invoices.push(Object.assign({ ...d.invoices[0], id: 11, type: 'INVOICE' }, { convertedFromQuoteId: 10 })); }],
    ['duplicate source invoice', (d: Fixture) => { d.invoices.push({ ...d.invoices[0] }); }],
    ['wrong current generation', (d: Fixture) => { d.quoteReleaseAuthorities[0].currentReleaseId = uid(11); }],
    ['closed current release', (d: Fixture) => { d.quoteReleases[1].restoredAccessDisabled = 1; }],
    ['revoked current release', (d: Fixture) => { d.quoteReleases[1].revokedAt = recordedAt; }],
    ['detached active authority', (d: Fixture) => { d.quoteReleaseAuthorities[0].sourceInvoiceId = null; }],
    ['foreign response authority', (d: Fixture) => { d.quoteElectronicResponses[0].authorityId = uid(2); }],
    ['wrong response version', (d: Fixture) => { d.quoteElectronicResponses[0].version = 2; }],
    ['wrong response hash', (d: Fixture) => { d.quoteElectronicResponses[0].snapshotSha256 = 'b'.repeat(64); }],
    ['response after revocation', (d: Fixture) => { d.quoteElectronicResponses[0].recordedAt = '2026-10-02T10:00:00.001Z'; }],
    ['response before creation', (d: Fixture) => { d.quoteElectronicResponses[0].recordedAt = '2026-10-01T09:59:59.999Z'; }],
    ['response at expiration', (d: Fixture) => { d.quoteElectronicResponses[0].recordedAt = expiresAt; }],
    ['noncanonical instant', (d: Fixture) => { d.quoteReleases[0].createdAt = '2026-10-01T10:00:00Z'; }],
    ['invalid calendar instant', (d: Fixture) => { d.quoteReleases[0].createdAt = '2026-02-30T10:00:00.000Z'; }],
    ['expiration at creation', (d: Fixture) => { d.quoteReleases[0].expiresAt = createdAt; }],
    ['revocation before creation', (d: Fixture) => { d.quoteReleases[0].revokedAt = '2026-10-01T09:59:59.999Z'; }],
    ['unsafe archive', (d: Fixture) => { d.quoteReleases[0].originalArchiveName = '../escape.pdf'; }],
    ['non-opaque archive', (d: Fixture) => { d.quoteReleases[0].originalArchiveName = 'synthetic.pdf'; }],
    ['invalid JSON', (d: Fixture) => { d.quoteReleases[0].sourcePayload = '{'; }],
    ['oversize UTF8 JSON', (d: Fixture) => { d.quoteReleases[0].sourcePayload = JSON.stringify('ä'.repeat(524288)); }],
    ['wide JSON', (d: Fixture) => { d.quoteReleases[0].sourcePayload = JSON.stringify(Array(20_001).fill(null)); }],
    ['deep JSON', (d: Fixture) => { d.quoteReleases[0].sourcePayload = '['.repeat(33) + 'null' + ']'.repeat(33); }],
  ])('rejects %s', (_name, change) => {
    const data = fixture(); (change as (d: Fixture) => void)(data);
    expect(() => parse(data)).toThrow();
  });
  it('rejects getters, non-plain rows, hidden/symbol fields and sparse/decorated arrays without evaluation', () => {
    let calls = 0;
    const row = fixture().quoteReleases[0];
    const getter = Object.defineProperty({ ...row }, 'sourcePayload', { enumerable: true, get() { calls++; return '{}'; } });
    for (const value of [getter, Object.assign(Object.create({ inherited: true }), row), Object.defineProperty({ ...row }, 'hidden', { value: 1 }), { ...row, [Symbol('owner')]: 'foreign' }]) {
      expect(() => parse({ ...fixture(), quoteReleases: [value] })).toThrow();
    }
    for (const value of [Array(1), Object.assign([row], { owner: 'foreign' }), Object.defineProperty([row], '0', { get() { calls++; return row; } })]) expect(() => parse({ ...fixture(), quoteReleases: value })).toThrow();
    expect(() => parse(Object.defineProperty(fixture(), 'quoteReleases', { enumerable: true, get() { calls++; return []; } }))).toThrow();
    const coercion = fixture(); Object.assign(coercion.invoices[0], { status: { toString() { calls++; return 'SENT'; } } });
    expect(() => parse(coercion)).toThrow();
    expect(calls).toBe(0);
  });
});

describe('immutable full graph identity and exact original manifest, no live authority granted', () => {
  it('ignores closure and local source/owner identity, but rejects ancestor/extra/mutated immutable history', () => {
    const graph = parse(), fingerprint = quoteReleaseImmutableGraphFingerprint(graph, uid(1));
    const closed = structuredClone(graph);
    Object.assign(closed.authorities[0], { sourceInvoiceId: null, boundCustomerId: null, currentReleaseId: null, revision: 99 });
    for (const release of closed.releases) Object.assign(release, { restoredAccessDisabled: 1, revokedAt: recordedAt });
    closed.releases.reverse();
    expect(quoteReleaseImmutableGraphFingerprint(closed, uid(1))).toBe(fingerprint);
    const detached = { quoteReleaseAuthorities: closed.authorities, quoteReleases: closed.releases, quoteElectronicResponses: closed.responses };
    expect(parse(detached)).toEqual(closed);
    for (const change of [
      (g: QuoteReleaseBackupGraph) => { g.releases.pop(); },
      (g: QuoteReleaseBackupGraph) => { g.responses = []; },
      (g: QuoteReleaseBackupGraph) => { g.releases[0].sourcePayload = '{"synthetic":true}'; },
      (g: QuoteReleaseBackupGraph) => { g.responses[0] = { ...g.responses[0], decision: 'REJECT' }; },
      (g: QuoteReleaseBackupGraph) => { g.responses[0].recordedAt = createdAt; },
      (g: QuoteReleaseBackupGraph) => { g.releases[0].originalArchiveName = 'another-original.pdf'; },
    ]) {
      const changed = structuredClone(graph); change(changed);
      expect(quoteReleaseImmutableGraphFingerprint(changed, uid(1))).not.toBe(fingerprint);
    }
    expect(() => quoteReleaseImmutableGraphFingerprint(graph, uid(99))).toThrow();
  });
  it('requires every exact original in ZIP; optional JSON entries still have to match, with no orphan or duplicate', () => {
    const graph = parse(), files = originalFiles(graph);
    expect(() => validateQuoteReleaseOriginalManifest(graph, files, true)).not.toThrow();
    expect(() => validateQuoteReleaseOriginalManifest(graph, [], false)).not.toThrow();
    expect(() => validateQuoteReleaseOriginalManifest(graph, files.map(({ zipPath: _path, ...file }) => { void _path; return file; }), false)).not.toThrow();
    for (const invalid of [[], files.slice(1), files.map(({ zipPath: _path, ...file }) => { void _path; return file; })]) expect(() => validateQuoteReleaseOriginalManifest(graph, invalid, true)).toThrow();
    for (const invalid of [
      [...files, { ...files[0] }], [...files, { ...files[0], sourceName: 'orphan.pdf' }],
      [{ ...files[0], sha256: 'a'.repeat(64) }], [{ ...files[0], bytes: files[0].bytes + 1 }],
      [{ ...files[0], zipPath: 'quote-release-originals/other.pdf' }],
      [{ ...files[0], zipPath: '../escape.pdf' }],
    ]) expect(() => validateQuoteReleaseOriginalManifest(graph, invalid, false)).toThrow();
    expect(() => validateQuoteReleaseOriginalManifest(graph, [{ kind: 'invoice', sourceName: 'other.pdf', bytes: 1, sha256: 'a'.repeat(64) }], false)).not.toThrow();
  });
});
