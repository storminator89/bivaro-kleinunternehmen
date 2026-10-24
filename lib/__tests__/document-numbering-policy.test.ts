import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
import { inTransaction } from '@/lib/db-transaction';
import { consumeDocumentNumberSelection, getNextDocumentNumber, previewDocumentNumber, previewNumberingChange } from '@/lib/invoice-numbers';
import { defaultNumberingPolicy, documentNumberCounterFloors, formatDocumentNumber, matchDocumentNumber, MAX_DOCUMENT_SEQUENCE, numberingNamespacesOverlap, validateNumberingFormat, type DocumentNumberSelection, type NumberingPolicy } from '@/lib/document-numbering-policy';
import { numberingPoliciesFromBackup, restoreDocumentNumberingPolicies, type NumberingPolicyBackup } from '@/lib/document-numbering-policy-backup';
let database: ReturnType<typeof createTestDatabase>;
let index = 0;
async function owner() { const id = `numbering-${++index}`; await database.client.user.create({ data: { id, email: `${id}@test.invalid`, password: 'unused' } }); return id; }
const format = (overrides: Partial<NumberingPolicy> = {}): NumberingPolicy => ({ ...defaultNumberingPolicy('INVOICE', 2026), prefix: 'RE-', revision: 1, ...overrides });
async function document(userId: string, invoiceNumber: string, type = 'INVOICE', tx: Prisma.TransactionClient = database.client) { return tx.invoice.create({ data: { userId, invoiceNumber, type, fileName: 'unchanged.pdf', storedFileName: 'unchanged-bytes.pdf', parsedData: { original: true } } }); }
async function policy(userId: string, value: NumberingPolicy) { return database.client.$transaction(async tx => { await previewNumberingChange(tx, userId, value); return tx.documentNumberingPolicy.create({ data: { userId, ...value } }); }); }
function selection(number: string, revision = 0, year = 2026): DocumentNumberSelection { return { version: 1, type: 'INVOICE', year, revision, number, automatic: true }; }
beforeAll(async () => { database = createTestDatabase(); state.client = database.client; }, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('bounded numbering formats', () => {
  it('preserves legacy defaults and minimum padding without truncation', () => {
    expect(formatDocumentNumber(defaultNumberingPolicy('INVOICE', 2026), 2026, 1)).toBe('2026-01');
    expect(formatDocumentNumber(defaultNumberingPolicy('QUOTE', 2026), 2026, 101)).toBe('AN-2026-101');
    expect(formatDocumentNumber(defaultNumberingPolicy('CREDIT_NOTE', 2026), 2026, 1)).toBe('GS-2026-01');
    expect(formatDocumentNumber(format({ sequenceWidth: 6 }), 2026, 12)).toBe('RE-2026-000012');
  });
  it.each([{ prefix: '{year}' }, { prefix: 'a' }, { prefix: 'A'.repeat(17) }, { sequenceWidth: 0 }, { sequenceWidth: 11 }, { startSequence: 0 }, { startSequence: MAX_DOCUMENT_SEQUENCE + 1 }, { effectiveYear: 1899 }, { formatVersion: 2 }])('rejects unsafe or unbounded format %j', value => { expect(() => validateNumberingFormat(format(value as Partial<NumberingPolicy>))).toThrow(); });
  it('does not parse arbitrary legacy suffixes or guess dates', () => {
    expect(matchDocumentNumber('old/2026-123', format())).toBeNull();
    expect(matchDocumentNumber('RE-2026-123-extra', format())).toBeNull();
    expect(() => matchDocumentNumber('RE-2026-2147483648', format())).toThrow('Grenze');
    expect(matchDocumentNumber('RE-2026-000123', format())).toEqual({ year: 2026, value: 123 });
  });
  it('detects overlapping namespaces across document types', () => {
    expect(numberingNamespacesOverlap(format(), format())).toBe(true);
    expect(numberingNamespacesOverlap(format({ includeYear: false, prefix: 'R' }), format({ includeYear: false, prefix: 'R1' }))).toBe(true);
    expect(numberingNamespacesOverlap(format(), format({ includeYear: false, prefix: 'RE-2026-' }))).toBe(true);
    expect(numberingNamespacesOverlap(format(), format({ prefix: 'AN-' }))).toBe(false);
    const embedded = format({ includeYear: false, prefix: 'RE-2026-1', sequenceWidth: 1 });
    expect(numberingNamespacesOverlap(format(), embedded)).toBe(true);
    expect(numberingNamespacesOverlap(embedded, format())).toBe(true);
  });
});
describe('transactional number policies', () => {
  it('previews repeatedly without reserving and isolates tenants', async () => {
    const user = await owner(), other = await owner(); await document(other, '2026-999');
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2026)).number).toBe('2026-01');
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2026)).number).toBe('2026-01');
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: user } })).toBe(0);
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: user } })).toBe(0);
  });
  it('takes the maximum of historical numbers and counters when moving forward', async () => {
    const user = await owner(); const original = await document(user, '2026-100');
    await database.client.invoiceNumberCounter.create({ data: { userId: user, type: 'INVOICE', year: 2026, value: 90 } });
    await expect(policy(user, format({ startSequence: 100 }))).rejects.toThrow('mindestens 101');
    await policy(user, format({ startSequence: 101 }));
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2026)).number).toBe('RE-2026-101');
    expect(await database.client.invoice.findUnique({ where: { id: original.id } })).toEqual(original);
  });
  it('blocks unclear imported legacy formats instead of renumbering them', async () => {
    const user = await owner(); const imported = await document(user, 'EXTERNAL/26/A');
    await expect(policy(user, format())).rejects.toThrow('unklar');
    expect(await database.client.invoice.findUnique({ where: { id: imported.id } })).toEqual(imported);
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: user } })).toBe(0);
  });
  it('remembers old configured prefixes and never resets on a prefix change', async () => {
    const user = await owner(); await policy(user, format({ startSequence: 30 }));
    await inTransaction(async tx => { const number = await getNextDocumentNumber(tx, user, 'INVOICE', 2026); await document(user, number, 'INVOICE', tx); });
    await policy(user, format({ revision: 2, prefix: 'NEU-', startSequence: 31 }));
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2026)).number).toBe('NEU-2026-31');
  });
  it('checks existing numbers across types and rejects future namespace overlap', async () => {
    const user = await owner(); await document(user, 'RE-2026-01', 'QUOTE');
    await expect(policy(user, format())).rejects.toThrow('kollidiert');
    await expect(policy(user, format({ prefix: 'AN-' }))).rejects.toThrow('überschneidet');
  });
  it('rejects stale settings tabs without adding another revision', async () => {
    const user = await owner(); await policy(user, format());
    await expect(policy(user, format({ prefix: 'NEW-' }))).rejects.toThrow('neuere');
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: user } })).toBe(1);
  });
  it('rejects a stale editor even when a changed width leaves the displayed number identical', async () => {
    const user = await owner(); const old = selection('2026-01');
    await policy(user, format({ prefix: '', sequenceWidth: 1 }));
    await expect(inTransaction(tx => consumeDocumentNumberSelection(tx, user, 'INVOICE', 2026, old.number, old))).rejects.toThrow('geändert');
    await expect(inTransaction(tx => consumeDocumentNumberSelection(tx, user, 'INVOICE', 2026, 'MANUAL', { ...old, automatic: false }))).rejects.toThrow('geändert');
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: user } })).toBe(0);
  });
  it('commits one exact preview under concurrent requests, never duplicate documents', async () => {
    const user = await owner(); const old = selection('2026-01');
    const create = () => inTransaction(async tx => { await consumeDocumentNumberSelection(tx, user, 'INVOICE', 2026, old.number, old); return document(user, old.number, 'INVOICE', tx); });
    const outcomes = await Promise.allSettled([create(), create(), create()]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await database.client.invoice.count({ where: { userId: user } })).toBe(1);
    expect((await database.client.invoiceNumberCounter.findUniqueOrThrow({ where: { userId_type_year: { userId: user, type: 'INVOICE', year: 2026 } } })).value).toBe(1);
  });
  it('allocates distinct fresh numbers atomically for parallel internal creation', async () => {
    const user = await owner();
    const values = await Promise.all([1, 2, 3].map(() => inTransaction(async tx => { const value = await getNextDocumentNumber(tx, user, 'INVOICE', 2026); await document(user, value, 'INVOICE', tx); return value; })));
    expect(values).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('keeps manual selections unchanged without reserving a preview', async () => {
    const user = await owner();
    await inTransaction(async tx => { await consumeDocumentNumberSelection(tx, user, 'INVOICE', 2026, 'MANUAL', { ...selection('2026-01'), automatic: false }); await document(user, 'MANUAL', 'INVOICE', tx); });
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: user } })).toBe(0);
    expect((await database.client.invoice.findFirstOrThrow({ where: { userId: user } })).invoiceNumber).toBe('MANUAL');
  });
  it('requires changed-year previews to be explicitly refreshed', async () => {
    const user = await owner(); await expect(inTransaction(tx => consumeDocumentNumberSelection(tx, user, 'INVOICE', 2027, '2026-01', selection('2026-01')))).rejects.toThrow('Dokumentjahr');
  });
  it('retains annual resets but never resets a format without a year', async () => {
    const annual = await owner(); await policy(annual, format({ startSequence: 40 }));
    expect((await previewDocumentNumber(database.client, annual, 'INVOICE', 2027)).number).toBe('RE-2027-01');
    const continuous = await owner(); await document(continuous, '2025-100');
    await policy(continuous, format({ includeYear: false, startSequence: 101 }));
    await inTransaction(async tx => { const number = await getNextDocumentNumber(tx, continuous, 'INVOICE', 2026); await document(continuous, number, 'INVOICE', tx); });
    expect((await previewDocumentNumber(database.client, continuous, 'INVOICE', 2027)).number).toBe('RE-102');
  });
  it('never invents a reset after re-enabling the year or lowering an unconsumed start', async () => {
    const user = await owner(); await policy(user, format({ includeYear: false, startSequence: 100 }));
    await expect(policy(user, format({ includeYear: true, revision: 2, startSequence: 1 }))).rejects.toThrow('mindestens 100');
    await policy(user, format({ includeYear: true, revision: 2, startSequence: 100 }));
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2027)).number).toBe('RE-2027-100');
  });
  it('fails closed on counter overflow without consuming or changing history', async () => {
    const user = await owner(); await database.client.invoiceNumberCounter.create({ data: { userId: user, type: 'INVOICE', year: 2026, value: MAX_DOCUMENT_SEQUENCE } });
    await expect(inTransaction(tx => getNextDocumentNumber(tx, user, 'INVOICE', 2026))).rejects.toThrow('ausgeschöpft');
    expect(await database.client.invoice.count({ where: { userId: user } })).toBe(0);
  });
  it('keeps credit-note identity separate and rejects stale cancellation previews', async () => {
    const user = await owner(); const previous = await previewDocumentNumber(database.client, user, 'CREDIT_NOTE', 2026);
    await policy(user, format({ type: 'CREDIT_NOTE', prefix: 'ST-' }));
    await expect(inTransaction(tx => getNextDocumentNumber(tx, user, 'CREDIT_NOTE', 2026, { revision: previous.revision, number: previous.number }))).rejects.toThrow('veraltet');
    expect((await previewDocumentNumber(database.client, user, 'CREDIT_NOTE', 2026)).number).toBe('ST-2026-01');
  });
});

describe('portable append-only policy restore', () => {
  const row = (): NumberingPolicyBackup => ({ ...format(), createdAt: '2026-10-24T09:00:00.000Z' });
  it('validates Date snapshots and canonical portable values', () => { expect(numberingPoliciesFromBackup({ documentNumberingPolicies: [{ ...row(), createdAt: new Date(row().createdAt) }] }, true)).toEqual([row()]); });
  it.each([{ ...row(), userId: 'wrong' }, { ...row(), revision: 2 }, { ...row(), createdAt: '2026-02-30T00:00:00.000Z' }, { ...row(), rawData: 'forbidden' }])('rejects ambiguous or nonportable restore row', value => { expect(() => numberingPoliciesFromBackup({ documentNumberingPolicies: [value] }, true)).toThrow(); });
  it('rejects conflicting restored namespaces across document types', () => { expect(() => numberingPoliciesFromBackup({ documentNumberingPolicies: [row(), { ...row(), type: 'QUOTE' }] }, true)).toThrow('überschneiden'); });
  it('rejects feature data in an old schema', () => { expect(() => numberingPoliciesFromBackup({ documentNumberingPolicies: [] }, false)).toThrow('Älteres'); expect(numberingPoliciesFromBackup({}, false)).toEqual([]); });
  it('retains custom historical high-water marks before overwrite deletion', async () => {
    const user = await owner(); await database.client.documentNumberingPolicy.create({ data: { userId: user, ...row(), createdAt: new Date(row().createdAt) } }); await document(user, 'RE-2026-800');
    await inTransaction(async tx => { expect(await restoreDocumentNumberingPolicies(tx, user, [])).toEqual({ imported: 0, skipped: 0 }); await tx.invoice.deleteMany({ where: { userId: user } }); });
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2026)).number).toBe('RE-2026-801');
  });
  it('rejects divergent immutable revisions before writes and keeps newer target settings', async () => {
    const user = await owner(); await inTransaction(tx => restoreDocumentNumberingPolicies(tx, user, [row()]));
    await expect(inTransaction(tx => restoreDocumentNumberingPolicies(tx, user, [{ ...row(), prefix: 'OTHER-' }]))).rejects.toThrow('weicht');
    await expect(inTransaction(tx => restoreDocumentNumberingPolicies(tx, user, [{ ...row(), createdAt: '2026-10-24T09:00:01.000Z' }]))).rejects.toThrow('weicht');
    await inTransaction(tx => restoreDocumentNumberingPolicies(tx, user, [{ ...row(), revision: 2, prefix: 'NEW-', createdAt: '2026-10-24T09:01:00.000Z' }]));
    await inTransaction(tx => restoreDocumentNumberingPolicies(tx, user, [row()]));
    expect((await previewDocumentNumber(database.client, user, 'INVOICE', 2026)).number).toBe('NEW-2026-01');
  });
  it('computes only exact-known high-water marks without interpreting unknown history', () => {
    expect(documentNumberCounterFloors([{ type: 'INVOICE', invoiceNumber: 'RE-2026-300' }, { type: 'INVOICE', invoiceNumber: 'MYSTERY-999' }], [format()])).toEqual([{ type: 'INVOICE', year: 2026, value: 300 }]);
  });
});
