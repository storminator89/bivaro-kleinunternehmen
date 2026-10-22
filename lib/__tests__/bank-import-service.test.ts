import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prisma } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest } from './helpers/backup';
import { inferBankCsvMapping, parseBankCsv, MAX_BANK_CSV_BYTES, MAX_BANK_CSV_ROWS } from '@/lib/bank-csv';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, parseBankImportInput } from '@/lib/bank-import-contract';
import { confirmBankImport, recoverBankImport, readBankImport, listBankImports } from '@/lib/bank-import-service';
import { bankImportFingerprint, prepareBankImport } from '@/lib/bank-import-evidence';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { restoreBackupData } from '@/lib/backup-restore';
import { createBackupPreview } from '@/lib/backup-preview';
import { GET, POST } from '@/app/api/bank-imports/route';
import { GET as detailGET } from '@/app/api/bank-imports/[id]/route';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'bank-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
let db: ReturnType<typeof createTestDatabase>;
const csv = 'Datum;Betrag;Währung;Gegenpartei;Verwendungszweck;Umsatz-ID\n21.10.2026;40,01;EUR;Synthetisch;RE-1;A\n21.10.2026;40,01;EUR;Synthetisch;RE-1;B\n22.10.2026;-0,03;EUR;Synthetisch;Gebühr;C\n22.10.2026;5,00;USD;Synthetisch;FX;D';
function input(source = csv, requestId = randomUUID(), alias = 'Synthetisches Konto') {
  return { requestId, originalBase64: Buffer.from(source).toString('base64'), delimiter: ';', mapping: { ...inferBankCsvMapping(parseBankCsv(source).headers), accountAlias: alias }, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, reviewed: true };
}
async function financialCounts() { return Promise.all([db.client.invoice.count(), db.client.income.count(), db.client.expense.count(), db.client.paymentJournalEvent.count(), db.client.paymentOperation.count(), db.client.paymentAdjustment.count()]); }
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: ['bank-owner', 'bank-other', 'bank-restore', 'bank-rollback'].map(id => ({ id, email: `${id}@test.invalid`, password: 'synthetic fixture' })) });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('explicit immutable bank evidence save', () => {
  it('browser preview and abandoned request do not persist', async () => {
    const before = await financialCounts();
    prepareBankImport(parseBankImportInput(input()));
    expect(await db.client.bankImportBatch.count()).toBe(0); expect(await db.client.bankImportRow.count()).toBe(0);
    expect(await financialCounts()).toEqual(before);
  });
  it('revalidates bytes, retains every duplicate/negative/FX row and exact integer cents without any financial writes', async () => {
    const before = await financialCounts(), request = input();
    const result = await confirmBankImport('bank-owner', request);
    expect(result).toMatchObject({ replayed: false, receipt: { counts: { total: 4, valid: 3, invalid: 1, duplicates: 2 }, totals: { incomingCents: '8002', outgoingCents: '3', netCents: '7999' } } });
    expect(result.receipt.sourceSha256).toBe(createHash('sha256').update(Buffer.from(csv)).digest('hex'));
    const detail = await readBankImport('bank-owner', result.receipt.id, 0);
    expect(detail.rows).toHaveLength(4); expect(detail.rows[3]).toMatchObject({ currency: 'USD', amountCents: null });
    expect(detail.rows[2].amountCents).toBe('-3'); expect(await financialCounts()).toEqual(before);
    const stored = await db.client.bankImportBatch.findFirstOrThrow({ where: { stableKey: result.receipt.id } });
    expect(stored).not.toHaveProperty('originalBase64'); expect(JSON.stringify(stored)).not.toContain('Gegenpartei;');
    const audit = await db.client.auditLog.findFirstOrThrow({ where: { entityId: result.receipt.id } });
    expect(audit.metadata).not.toContain('Synthetisch'); expect(audit.metadata).not.toContain('RE-1');
  });
  it('original UUID retry recovers exact immutable receipt after later overlap imports; fresh UUID same payload points to original', async () => {
    const request = input('Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n20.10.2026;1,23;EUR;Synthetisch;Retry-A');
    const original = await confirmBankImport('bank-owner', request);
    await confirmBankImport('bank-owner', input('Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n20.10.2026;1,23;EUR;Synthetisch;Retry-A\n20.10.2026;0,01;EUR;Andere;Retry-B'));
    const replay = await confirmBankImport('bank-owner', request);
    expect(replay).toEqual({ receipt: original.receipt, replayed: true });
    expect(await recoverBankImport('bank-owner', request.requestId)).toEqual(original.receipt);
    await expect(confirmBankImport('bank-owner', { ...request, requestId: randomUUID() })).rejects.toMatchObject({ status: 409, existingReceiptId: original.receipt.id });
    await expect(confirmBankImport('bank-owner', { ...request, mapping: { ...request.mapping, accountAlias: 'Anderes Konto' } })).rejects.toMatchObject({ status: 409 });
    expect(await db.client.bankImportBatch.count({ where: { userId: 'bank-owner', requestId: request.requestId } })).toBe(1);
  });
  it('concurrent same-key and different-key same-payload confirmations cannot duplicate a batch', async () => {
    const request = input('Datum;Betrag;Währung\n19.10.2026;9,99;EUR');
    const same = await Promise.all(Array.from({ length: 3 }, () => confirmBankImport('bank-owner', request)));
    expect(same.filter(value => !value.replayed)).toHaveLength(1);
    expect(new Set(same.map(value => value.receipt.id)).size).toBe(1);
    const parallelInput = input('Datum;Betrag;Währung\n19.10.2026;1,99;EUR');
    const different = await Promise.allSettled([confirmBankImport('bank-owner', parallelInput), confirmBankImport('bank-owner', { ...parallelInput, requestId: randomUUID() })]);
    expect(different.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(different.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  });
  it('retains overlapping exports and conflicting external IDs as warnings, never silent row removal or uniqueness proof', async () => {
    const first = await confirmBankImport('bank-owner', input('Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n18.10.2026;10,00;EUR;Gleich;Overlap-A\n18.10.2026;10,00;EUR;Gleich;Overlap-A'));
    const second = await confirmBankImport('bank-owner', input('Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n18.10.2026;10,00;EUR;Gleich;Overlap-A\n18.10.2026;17,00;EUR;Widerspruch;Overlap-A'));
    const detail = await readBankImport('bank-owner', second.receipt.id, 0);
    expect(first.receipt.counts.total).toBe(2); expect(detail.rows).toHaveLength(2);
    expect(detail.receipt.counts.overlapRows).toBe(2);
    expect(detail.rows[0].priorMatches).toEqual({ external: 2, content: 2, dayAmount: 2 });
    expect(detail.rows[1].priorMatches).toEqual({ external: 2, content: 0, dayAmount: 0 });
    expect(detail.rows[1].warnings.join(' ')).toContain('beweist keine Dublette');
    const otherAlias = await confirmBankImport('bank-owner', input('Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n18.10.2026;10,00;EUR;Gleich;Overlap-A', randomUUID(), 'Zweites Konto'));
    expect(otherAlias.receipt.counts.overlapRows).toBe(0);
  });
  it('same bytes with deliberately changed mapping/context retain a second batch and visible same-file evidence', async () => {
    const request = input('Datum;Betrag;Währung\n17.10.2026;2,00;EUR');
    const first = await confirmBankImport('bank-owner', request);
    const second = await confirmBankImport('bank-owner', { ...request, requestId: randomUUID(), mapping: { ...request.mapping, accountAlias: 'Bewusst anderes Konto' } });
    expect(second.receipt.id).not.toBe(first.receipt.id); expect(second.receipt.sameFilePreviouslySaved).toBe(true);
    expect((await readBankImport('bank-owner', first.receipt.id, 0)).receipt).toEqual(first.receipt);
  });
  it('tenant scoped receipts, history, external identity and recovery do not disclose other owner data', async () => {
    const owner = await db.client.bankImportBatch.findFirstOrThrow({ where: { userId: 'bank-owner' } });
    expect(await recoverBankImport('bank-other', owner.requestId)).toBeNull();
    await expect(readBankImport('bank-other', owner.stableKey, 0)).rejects.toMatchObject({ status: 404 });
    expect((await listBankImports('bank-other', 0)).receipts).toEqual([]);
    const other = await confirmBankImport('bank-other', input());
    expect(other.receipt.counts.overlapRows).toBe(0);
    const listed = await listBankImports('bank-other', 0);
    expect(listed.receipts).toEqual([other.receipt]); expect(JSON.stringify(listed)).not.toContain('userId');
  });
  it('late row persistence failure atomically rolls back receipt, every row and audit', async () => {
    await db.client.$executeRawUnsafe(`CREATE TRIGGER bank_test_failure BEFORE INSERT ON BankImportRow WHEN NEW.sourceRow = 3 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    const request = input('Datum;Betrag;Währung\n16.10.2026;1,00;EUR\n16.10.2026;2,00;EUR');
    const before = await db.client.auditLog.count();
    await expect(confirmBankImport('bank-rollback', request)).rejects.toThrow();
    expect(await recoverBankImport('bank-rollback', request.requestId)).toBeNull(); expect(await db.client.bankImportRow.count({ where: { userId: 'bank-rollback' } })).toBe(0);
    expect(await db.client.auditLog.count()).toBe(before);
    await db.client.$executeRawUnsafe('DROP TRIGGER bank_test_failure');
  });
  it('supports BOM actual-byte hashing and rejects forged rows/totals, invalid UTF8, versions, mapping and bounds', async () => {
    const source = '\ufeffDatum;Betrag;Währung\r\n15.10.2026;0,01;EUR';
    const saved = await confirmBankImport('bank-owner', input(source));
    expect(saved.receipt.sourceSha256).toBe(createHash('sha256').update(Buffer.from(source)).digest('hex'));
    const request = input();
    for (const mutation of [{ reviewed: false }, { rows: [] }, { totals: { incomingCents: '999' } }, { parserVersion: 'future' }, { originalBase64: Buffer.from([0xff, 0xfe]).toString('base64') }, { originalBase64: 'YQ=A' }, { mapping: { ...request.mapping, date: 63 } }, { mapping: { ...request.mapping, accountAlias: '=SUM(A1)' } }]) await expect(confirmBankImport('bank-owner', { ...request, ...mutation })).rejects.toThrow();
    expect(() => parseBankImportInput({ ...request, originalBase64: Buffer.alloc(MAX_BANK_CSV_BYTES + 1).toString('base64') })).toThrow();
    const tooMany = 'Datum;Betrag;Währung\n' + Array.from({ length: MAX_BANK_CSV_ROWS + 1 }, () => '15.10.2026;0,01;EUR').join('\n');
    await expect(confirmBankImport('bank-owner', { ...request, originalBase64: Buffer.from(tooMany).toString('base64') })).rejects.toThrow();
  });
  it('retry after an entire rolled-back transaction never duplicates immutable overlap warnings', async () => {
    const source = 'Datum;Betrag;Währung;Umsatz-ID\n12.10.2026;1,00;EUR;Synthetic-Retry-ID';
    await confirmBankImport('bank-owner', input(source));
    const request = input(source + '\n12.10.2026;2,00;EUR;Synthetic-Retry-New');
    const actual = db.client.$transaction.bind(db.client);
    const spy = vi.spyOn(db.client, '$transaction').mockImplementationOnce((async (work: unknown, options: unknown) => {
      return actual(async tx => {
        await (work as (client: Prisma.TransactionClient) => Promise<unknown>)(tx);
        throw new Error('SQLITE_BUSY synthetic after-work rollback');
      }, options as { timeout?: number; maxWait?: number });
    }) as typeof db.client.$transaction);
    try {
      const saved = await confirmBankImport('bank-owner', request);
      const detail = await readBankImport('bank-owner', saved.receipt.id, 0);
      expect(detail.rows[0].warnings).toEqual([...new Set(detail.rows[0].warnings)]);
      const snapshot = await readBackupSnapshot('bank-owner');
      expect(() => createBackupPreview({ version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: 'bank-owner', generatedAt: new Date().toISOString(), data: snapshot.data }) })).not.toThrow();
    } finally { spy.mockRestore(); }
  });
  it('overlong invalid external IDs and Unicode boundaries remain bounded restorable evidence, not truncated identities', async () => {
    const prefix = 'X'.repeat(255), partner = 'P'.repeat(254) + '😀', reference = 'R'.repeat(1999) + '😀';
    const source = `Datum;Betrag;Währung;Gegenpartei;Verwendungszweck;Umsatz-ID\n11.10.2026;1,00;EUR;${partner};${reference};${prefix}A\n10.10.2026;2,00;EUR;Synthetic;Invalid;${prefix}B`;
    const saved = await confirmBankImport('bank-owner', input(source));
    expect(saved.receipt.counts).toMatchObject({ valid: 0, invalid: 2 });
    const records = await db.client.bankImportRow.findMany({ where: { userId: 'bank-owner', batch: { stableKey: saved.receipt.id } } });
    expect(records.every(row => row.externalKey === null)).toBe(true);
    const snapshot = await readBackupSnapshot('bank-owner');
    expect(() => createBackupPreview({ version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: 'bank-owner', generatedAt: new Date().toISOString(), data: snapshot.data }) })).not.toThrow();
  });
  it('row and import history pagination remain bounded', async () => {
    const source = 'Datum;Betrag;Währung\n' + Array.from({ length: 21 }, (_, index) => `14.10.2026;${index + 1},00;EUR`).join('\n');
    const saved = await confirmBankImport('bank-owner', input(source));
    expect((await readBankImport('bank-owner', saved.receipt.id, 0)).rows).toHaveLength(20);
    expect((await readBankImport('bank-owner', saved.receipt.id, 1)).rows).toHaveLength(1);
    expect((await readBankImport('bank-owner', saved.receipt.id, 2)).rows).toHaveLength(0);
    expect((await listBankImports('bank-owner', 0)).receipts.length).toBeLessThanOrEqual(20);
  });
});

describe('bank import guarded route contracts', () => {
  it('applies existing authentication and mutation-origin guards, bounds pages and minimizes DTOs', async () => {
    const request = input('Datum;Betrag;Währung\n13.10.2026;1,00;EUR');
    const make = (headers = {}) => new Request('http://localhost/api/bank-imports', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(request) });
    state.userId = null;
    expect((await GET(new Request('http://localhost/api/bank-imports'))).status).toBe(401);
    expect((await POST(make())).status).toBe(401);
    state.userId = 'bank-owner';
    expect((await POST(make({ origin: 'https://evil.invalid' }))).status).toBe(403);
    expect((await POST(make({ 'content-length': String(3 * 1024 * 1024 + 1) }))).status).toBe(413);
    const saved = await POST(make()); expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toBe('private, no-store');
    const value = await saved.json(); expect(value.receipt.sourceSha256).toHaveLength(64); expect(JSON.stringify(value)).not.toContain('userId'); expect(value).not.toHaveProperty('rows');
    expect((await GET(new Request('http://localhost/api/bank-imports?page=-1'))).status).toBe(400);
    const recovery = await GET(new Request(`http://localhost/api/bank-imports?requestId=${request.requestId}`)); expect((await recovery.json()).receipt).toEqual(value.receipt);
    state.userId = 'bank-other';
    expect((await detailGET(new Request('http://localhost/api/bank-imports/x'), { params: Promise.resolve({ id: value.receipt.id }) })).status).toBe(404);
    state.userId = 'bank-owner';
  });
});

describe('bank immutable evidence backup and restore', () => {
  async function backup() { const snapshot = await readBackupSnapshot('bank-owner'); return { version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: 'bank-owner', generatedAt: new Date().toISOString(), data: snapshot.data }) }; }
  it('snapshot carries normalized portable graph without originals/internal owner identifiers; cross-tenant restore retains exact receipts and no finances', async () => {
    const original = await backup(), before = await financialCounts();
    const batches = original.data.bankImportBatches as Record<string, unknown>[], rows = original.data.bankImportRows as Record<string, unknown>[];
    expect(batches.length).toBeGreaterThan(0); expect(rows.length).toBeGreaterThan(0);
    expect(batches[0]).not.toHaveProperty('id'); expect(rows[0]).not.toHaveProperty('batchId'); expect(rows[0]).toHaveProperty('batchStableKey');
    expect(createBackupPreview(original).counts.bankImportRows).toBe(rows.length);
    const restored = await restoreBackupData({ userId: 'bank-restore', backup: original, overwrite: false });
    expect(restored.bankImportBatches.imported).toBe(batches.length); expect(restored.bankImportRows.imported).toBe(rows.length);
    const repeated = await restoreBackupData({ userId: 'bank-restore', backup: original, overwrite: false });
    expect(repeated.bankImportBatches).toEqual({ imported: 0, skipped: batches.length });
    const first = batches[0]; expect((await readBankImport('bank-restore', String(first.stableKey), 0)).receipt).toEqual(first.receipt);
    expect(await financialCounts()).toEqual(before);
  });
  it('immutable collision during restore rolls back unrelated imports and does not rewrite target history even in overwrite', async () => {
    const original = await backup(), cloned = structuredClone(original);
    const batch = (cloned.data.bankImportBatches as Record<string, unknown>[])[0];
    const mapping = { ...(batch.mapping as Record<string, unknown>), accountAlias: 'Manipulierter Alias' };
    batch.mapping = mapping; batch.accountAlias = mapping.accountAlias;
    batch.fingerprint = bankImportFingerprint(batch as unknown as Parameters<typeof bankImportFingerprint>[0]);
    (batch.receipt as Record<string, unknown>).accountAlias = mapping.accountAlias;
    // Deliberately colliding stable UUID is rejected before any target evidence mutation.
    cloned.manifest = createBackupManifest({ sourceUserId: 'bank-owner', generatedAt: new Date().toISOString(), data: cloned.data });
    const before = await readBankImport('bank-restore', String(batch.stableKey), 0);
    await expect(restoreBackupData({ userId: 'bank-restore', backup: cloned, overwrite: true })).rejects.toThrow();
    expect(await readBankImport('bank-restore', String(batch.stableKey), 0)).toEqual(before);
    const empty = await readBackupSnapshot('bank-rollback');
    const emptyBackup = { version: '3.0', data: empty.data, manifest: createBackupManifest({ sourceUserId: 'bank-rollback', generatedAt: new Date().toISOString(), data: empty.data }) };
    const retained = await db.client.bankImportBatch.count({ where: { userId: 'bank-restore' } });
    await restoreBackupData({ userId: 'bank-restore', backup: emptyBackup, overwrite: true });
    expect(await db.client.bankImportBatch.count({ where: { userId: 'bank-restore' } })).toBe(retained);
  });
});
