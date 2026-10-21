import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import {
  createBackupManifest, CURRENT_SCHEMA_VERSION, FULL_PAYMENT_JOURNAL_SCHEMA_VERSION,
  hashJson, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION,
} from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let restore: typeof import('@/lib/backup-restore');
let preview: typeof import('@/lib/backup-preview');

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-partial-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    restore = await import('@/lib/backup-restore');
    preview = await import('@/lib/backup-preview');
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

const dateA = '2026-01-31T00:00:00.000Z';
const dateB = '2026-02-02T00:00:00.000Z';
const createdAt = '2026-02-03T12:00:00.123Z';
function envelope<T extends Record<string, unknown>>(data: T) {
  return { version: '3.0', type: 'full', exportedAt: createdAt, data,
    manifest: createBackupManifest({ sourceUserId: 'partial-source', generatedAt: createdAt, data }) };
}
function fixture(amounts = [40, 80], dates = [dateA, dateB]) {
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  return envelope({
    user: { id: 'partial-source' }, suppliers: [], purchaseDocuments: [], customers: [], expenses: [], auditLogs: [], invoiceNumberCounters: [],
    invoices: [{ id: 10, type: 'INVOICE', invoiceNumber: '2026-120', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf',
      totalAmount: 120, status: sum === 120 ? 'PAID' : 'SENT', issuanceState: 'ISSUED',
      paidAt: sum === 120 ? [...dates].sort().at(-1)! : null, parsedData: { currency: 'EUR' } }],
    incomes: amounts.map((amount, index) => ({ id: 20 + index, invoiceId: 10, description: 'Rechnung 2026-120', amount,
      date: dates[index], taxRelevant: true })),
    paymentJournalEvents: amounts.map((amount, index) => ({ id: 30 + index, invoiceId: 10, incomeId: 20 + index,
      amountCents: String(amount * 100), currency: 'EUR', paidAt: dates[index], dateCertainty: 'ACTUAL', source: 'MANUAL',
      reference: 'bank-reference', idempotencyKey: `partial-${index}`, createdAt })),
  });
}
async function user(id: string) {
  await database.client.user.create({ data: { id, email: `${id}@backup.invalid`, password: 'unused' } });
}
const resolveFile = async () => new Uint8Array([37, 80, 68, 70]);
async function apply(userId: string, backup: unknown, overwrite = false) {
  return restore.restoreBackupData({ userId, backup, overwrite, resolveFile });
}
async function eventAuditCount(userId: string) {
  const rows = await database.client.auditLog.findMany({ where: { userId } });
  return rows.filter((row) => row.metadata && JSON.parse(row.metadata).operation === 'payment-journal.restore').length;
}

describe('partial-payment backup identity and grouped invariants', () => {
  it('round trips two allocations with distinct Income links, exact original dates and event creation times', async () => {
    await user('partial-roundtrip');
    const backup = fixture();
    expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(preview.createBackupPreview(backup).counts).toMatchObject({ invoices: 1, incomes: 2, paymentJournalEvents: 2 });
    const first = await apply('partial-roundtrip', backup, true);
    expect(first.paymentJournalEvents).toEqual({ imported: 2, skipped: 0 });
    const events = await database.client.paymentJournalEvent.findMany({ where: { userId: 'partial-roundtrip' }, orderBy: { id: 'asc' }, include: { income: true } });
    expect(events.map((event) => event.amountCents)).toEqual(['4000', '8000']);
    expect(events.map((event) => event.paidAt?.toISOString())).toEqual([dateA, dateB]);
    expect(events.every((event) => event.createdAt.toISOString() === createdAt)).toBe(true);
    expect(new Set(events.map((event) => event.incomeId)).size).toBe(2);
    expect(events.map((event) => event.income?.amount)).toEqual([40, 80]);
    const snapshot = await readBackupSnapshot('partial-roundtrip');
    expect(() => restore.validateBackupForRestore({ version: '3.0', data: snapshot.data,
      manifest: createBackupManifest({ sourceUserId: 'partial-roundtrip', generatedAt: createdAt, data: snapshot.data }) })).not.toThrow();
    const auditCount = await eventAuditCount('partial-roundtrip');
    for (let index = 0; index < 2; index += 1) {
      const repeat = await apply('partial-roundtrip', backup);
      expect(repeat.incomes).toEqual({ imported: 0, skipped: 2 });
      expect(repeat.paymentJournalEvents).toEqual({ imported: 0, skipped: 2 });
    }
    expect(await database.client.income.count({ where: { userId: 'partial-roundtrip' } })).toBe(2);
    expect(await eventAuditCount('partial-roundtrip')).toBe(auditCount);
  });

  it('advances a verified subset to settlement, then never regresses the target to the older partial snapshot', async () => {
    await user('partial-advance');
    await apply('partial-advance', fixture([40], [dateA]), true);
    expect(await database.client.invoice.findFirstOrThrow({ where: { userId: 'partial-advance' } })).toMatchObject({ status: 'SENT', paidAt: null });
    const settled = await apply('partial-advance', fixture());
    expect(settled.incomes).toEqual({ imported: 1, skipped: 1 });
    expect(settled.paymentJournalEvents).toEqual({ imported: 1, skipped: 1 });
    const before = await database.client.invoice.findFirstOrThrow({ where: { userId: 'partial-advance' } });
    expect(before).toMatchObject({ status: 'PAID', paidAt: new Date(dateB) });
    const audits = await eventAuditCount('partial-advance');
    await apply('partial-advance', fixture([40], [dateA]));
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await database.client.income.count({ where: { userId: 'partial-advance' } })).toBe(2);
    expect(await eventAuditCount('partial-advance')).toBe(audits);
  });

  it('does not deduplicate distinct allocations with equal amount, date, description and reference', async () => {
    await user('partial-equal');
    const first = fixture([40], [dateA]);
    const advanced = fixture([40, 40], [dateA, dateA]);
    await apply('partial-equal', first, true);
    await apply('partial-equal', advanced);
    const result = await apply('partial-equal', advanced);
    expect(result.paymentJournalEvents).toEqual({ imported: 0, skipped: 2 });
    expect(await database.client.income.count({ where: { userId: 'partial-equal' } })).toBe(2);
    expect(await database.client.paymentJournalEvent.count({ where: { userId: 'partial-equal' } })).toBe(2);
  });

  it('preserves cancellation and both allocations when merging an older settled snapshot', async () => {
    await user('partial-cancel');
    const cancelled = fixture(); cancelled.data.invoices[0].status = 'CANCELLED';
    await apply('partial-cancel', envelope(cancelled.data), true);
    await apply('partial-cancel', fixture());
    expect(await database.client.invoice.findFirstOrThrow({ where: { userId: 'partial-cancel' } })).toMatchObject({ status: 'CANCELLED', paidAt: new Date(dateB) });
    expect(await database.client.income.count({ where: { userId: 'partial-cancel' } })).toBe(2);
  });

  it('recognizes the immediately previous full-payment journal schema, including restore and replay', async () => {
    await user('partial-previous');
    const previous = fixture([120], [dateA]); previous.manifest.schemaVersion = FULL_PAYMENT_JOURNAL_SCHEMA_VERSION;
    expect(() => restore.validateBackupForRestore(previous)).not.toThrow();
    await apply('partial-previous', previous, true);
    const replay = await apply('partial-previous', previous);
    expect(replay.paymentJournalEvents).toEqual({ imported: 0, skipped: 1 });
    const invalid = fixture(); invalid.manifest.schemaVersion = FULL_PAYMENT_JOURNAL_SCHEMA_VERSION;
    expect(() => restore.validateBackupForRestore(invalid)).toThrow(/Vollzahlungs-Backup-Schema/u);
  });

  it.each([
    ['overpayment', (backup: ReturnType<typeof fixture>) => { backup.data.invoices[0].totalAmount = 119; }],
    ['orphan Income', (backup: ReturnType<typeof fixture>) => { backup.data.incomes.push({ ...backup.data.incomes[0], id: 29 }); }],
    ['shared Income', (backup: ReturnType<typeof fixture>) => { backup.data.paymentJournalEvents[1].incomeId = 20; }],
    ['amount mismatch', (backup: ReturnType<typeof fixture>) => { backup.data.incomes[0].amount = 41; }],
    ['date mismatch', (backup: ReturnType<typeof fixture>) => { backup.data.incomes[0].date = dateB; }],
    ['paid projection mismatch', (backup: ReturnType<typeof fixture>) => { backup.data.invoices[0].status = 'SENT'; }],
    ['settlement date mismatch', (backup: ReturnType<typeof fixture>) => { backup.data.invoices[0].paidAt = dateA; }],
    ['tenant mismatch', (backup: ReturnType<typeof fixture>) => { Object.assign(backup.data.incomes[0], { userId: 'other-tenant' }); }],
    ['historical mixing', (backup: ReturnType<typeof fixture>) => { Object.assign(backup.data.paymentJournalEvents[0], { source: 'LEGACY_IMPORT', dateCertainty: 'LEGACY_INCOME' }); }],
  ] as const)('rejects %s in the grouped source graph', (_label, mutate) => {
    const backup = fixture(); mutate(backup);
    expect(() => restore.validateBackupForRestore(envelope(backup.data))).toThrow();
  });

  it.each([40, 80])('rejects divergent histories before committing anything (union allocation %s)', async (amount) => {
    const target = `partial-divergent-${amount}`;
    await user(target);
    await apply(target, fixture([amount], [dateA]), true);
    const source = fixture([amount], [dateA]);
    source.data.incomes[0].id = 21;
    Object.assign(source.data.paymentJournalEvents[0], { id: 31, incomeId: 21, idempotencyKey: 'independent-branch' });
    const before = await readBackupSnapshot(target);
    await expect(apply(target, envelope(source.data))).rejects.toThrow(/Unvereinbare Zahlungshistorien/u);
    expect(hashJson((await readBackupSnapshot(target)).data)).toBe(hashJson(before.data));
  });

  it.each(['reference', 'amount', 'document'] as const)('rejects a conflicting advanced snapshot: %s', async (field) => {
    const target = `partial-conflicting-${field}`;
    await user(target);
    await apply(target, fixture([40], [dateA]), true);
    const source = fixture();
    if (field === 'reference') source.data.paymentJournalEvents[0].reference = 'different-proof';
    if (field === 'amount') { source.data.invoices[0].totalAmount = 121; source.data.invoices[0].status = 'SENT'; source.data.invoices[0].paidAt = null; }
    if (field === 'document') Object.assign(source.data.invoices[0].parsedData, { lineItems: [{ description: 'different goods', total: 120 }] });
    const before = await readBackupSnapshot(target);
    await expect(apply(target, envelope(source.data))).rejects.toThrow(/Kollision|Zielrechnung/u);
    expect(hashJson((await readBackupSnapshot(target)).data)).toBe(hashJson(before.data));
  });

  it.each(['2.0', '3.0'])('restores old %s evidence into an empty target but rejects an ambiguous merge into partial history', async (version) => {
    const target = `partial-old-${version.replace('.', '-')}`;
    const empty = `partial-old-empty-${version.replace('.', '-')}`;
    await user(target); await user(empty);
    await apply(target, fixture([40], [dateA]), true);
    const old = fixture([120], [dateA]); old.data.paymentJournalEvents = [];
    old.manifest = createBackupManifest({ sourceUserId: 'partial-source', generatedAt: createdAt, data: old.data });
    old.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION;
    old.manifest.modelCoverage = old.manifest.modelCoverage.filter((entry) => entry.model !== 'PaymentJournalEvent');
    const backup = version === '2.0' ? { version, data: old.data } : old;
    await apply(empty, backup, true);
    expect(await database.client.paymentJournalEvent.count({ where: { userId: empty } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: empty } })).toBe(1);
    const before = await readBackupSnapshot(target);
    await expect(apply(target, backup)).rejects.toThrow(/ohne Zahlungsidentitäten/u);
    expect(hashJson((await readBackupSnapshot(target)).data)).toBe(hashJson(before.data));
    await expect(apply(target, backup, true)).rejects.toThrow(/unveränderliche Zahlungsereignisse/u);
  });

  it('rejects customer identity changes even when an old customer name still matches', async () => {
    await user('partial-customer-conflict');
    const initial = fixture([40], [dateA]);
    const customerData = {
      ...initial.data, customers: [{ id: 1, name: 'Same display name', taxNumber: 'original-tax-id' }],
      invoices: initial.data.invoices.map((invoice) => ({ ...invoice, customerId: 1 })),
      incomes: initial.data.incomes.map((income) => ({ ...income, customerId: 1 })),
    };
    await apply('partial-customer-conflict', envelope(customerData), true);
    const before = await readBackupSnapshot('partial-customer-conflict');
    customerData.customers[0].taxNumber = 'different-tax-id';
    await expect(apply('partial-customer-conflict', envelope(customerData))).rejects.toThrow(/Kundenstammdaten/u);
    expect(hashJson((await readBackupSnapshot('partial-customer-conflict')).data)).toBe(hashJson(before.data));
  });

  it('rolls back a new allocation, its Income, projection and audit if mandatory restore audit fails', async () => {
    await user('partial-audit-rollback');
    await apply('partial-audit-rollback', fixture([40], [dateA]), true);
    const before = await readBackupSnapshot('partial-audit-rollback');
    await database.client.$executeRawUnsafe(`CREATE TRIGGER partial_backup_audit_fail BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, 'fixture restore audit failure'); END;`);
    try { await expect(apply('partial-audit-rollback', fixture())).rejects.toThrow(); }
    finally { await database.client.$executeRawUnsafe('DROP TRIGGER partial_backup_audit_fail'); }
    expect(hashJson((await readBackupSnapshot('partial-audit-rollback')).data)).toBe(hashJson(before.data));
  });

  it('rejects unexplained Income on an existing partial target instead of adopting it for a new event', async () => {
    await user('partial-orphan-target');
    await apply('partial-orphan-target', fixture([40], [dateA]), true);
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'partial-orphan-target' } });
    await database.client.income.create({ data: { userId: 'partial-orphan-target', invoiceId: invoice.id,
      description: 'Unexplained historical income', amount: 80, date: new Date(dateB) } });
    const before = await readBackupSnapshot('partial-orphan-target');
    await expect(apply('partial-orphan-target', fixture())).rejects.toThrow(/Rechnungseinnahme/u);
    expect(hashJson((await readBackupSnapshot('partial-orphan-target')).data)).toBe(hashJson(before.data));
  });

  it('rejects mapping two source documents to one journal invoice, including newly created targets', async () => {
    await user('partial-collapsed-invoices');
    const source = fixture([80], [dateA]);
    source.data.invoices.push({ ...source.data.invoices[0], id: 11 });
    source.data.incomes.push({ ...source.data.incomes[0], id: 21, invoiceId: 11 });
    source.data.paymentJournalEvents.push({ ...source.data.paymentJournalEvents[0], id: 31, invoiceId: 11, incomeId: 21, idempotencyKey: 'different-document-payment' });
    expect(() => restore.validateBackupForRestore(envelope(source.data))).not.toThrow();
    await expect(apply('partial-collapsed-invoices', envelope(source.data))).rejects.toThrow(/Mehrere Quellrechnungen/u);
    expect(await database.client.invoice.count({ where: { userId: 'partial-collapsed-invoices' } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: 'partial-collapsed-invoices' } })).toBe(0);
    expect(await database.client.paymentJournalEvent.count({ where: { userId: 'partial-collapsed-invoices' } })).toBe(0);
  });


  it('rejects a reused original source event ID under a different idempotency key', async () => {
    await user('partial-source-id-reuse');
    await apply('partial-source-id-reuse', fixture([40], [dateA]), true);
    const forged = fixture([40, 40], [dateA, dateA]);
    forged.data.paymentJournalEvents[0].idempotencyKey = 'new-key-for-old-source-id';
    forged.data.paymentJournalEvents[1].idempotencyKey = 'partial-0';
    const before = await readBackupSnapshot('partial-source-id-reuse');
    await expect(apply('partial-source-id-reuse', envelope(forged.data))).rejects.toThrow(/Quellidentität/u);
    expect(hashJson((await readBackupSnapshot('partial-source-id-reuse')).data)).toBe(hashJson(before.data));
  });

  it('does not clone unidentified journal-free invoices into a journal-bearing target', async () => {
    await user('partial-unidentified-old');
    await apply('partial-unidentified-old', fixture([40], [dateA]), true);
    const old = fixture([120], [dateA]);
    old.data.paymentJournalEvents = []; old.data.invoices[0].invoiceNumber = '';
    const before = await readBackupSnapshot('partial-unidentified-old');
    await expect(apply('partial-unidentified-old', { version: '2.0', data: old.data })).rejects.toThrow(/keine eindeutige Rechnungsidentität/u);
    expect(hashJson((await readBackupSnapshot('partial-unidentified-old')).data)).toBe(hashJson(before.data));
  });


  it('does not mistake imported foreign restore audits for local source-to-target identity mappings', async () => {
    await user('partial-chain-origin'); await user('partial-chain-target');
    await apply('partial-chain-origin', fixture(), true);
    const snapshot = await readBackupSnapshot('partial-chain-origin');
    const backup = { version: '3.0', type: 'full', data: snapshot.data,
      manifest: createBackupManifest({ sourceUserId: 'partial-chain-origin', generatedAt: createdAt, data: snapshot.data }) };
    await apply('partial-chain-target', backup, true);
    const replay = await apply('partial-chain-target', backup);
    expect(replay.paymentJournalEvents).toEqual({ imported: 0, skipped: 2 });
    expect(await database.client.paymentJournalEvent.count({ where: { userId: 'partial-chain-target' } })).toBe(2);
    expect(await database.client.income.count({ where: { userId: 'partial-chain-target' } })).toBe(2);
  });


  it('rejects identical old unnamed backup after its restored Income was historically adopted', async () => {
    await user('partial-old-adopted-unnamed');
    const old = fixture([120], [dateA]);
    old.data.paymentJournalEvents = []; Object.assign(old.data.invoices[0], { invoiceNumber: null });
    const backup = { version: '2.0', data: old.data };
    await apply('partial-old-adopted-unnamed', backup, true);
    const income = await database.client.income.findFirstOrThrow({ where: { userId: 'partial-old-adopted-unnamed' } });
    await database.client.paymentJournalEvent.create({ data: { userId: 'partial-old-adopted-unnamed', invoiceId: income.invoiceId!, incomeId: income.id,
      amountCents: '12000', currency: 'EUR', paidAt: income.date, source: 'LEGACY_IMPORT', dateCertainty: 'LEGACY_INCOME',
      reference: 'Explicit historical adoption', idempotencyKey: 'adopted-unnamed-once' } });
    const before = await readBackupSnapshot('partial-old-adopted-unnamed');
    await expect(apply('partial-old-adopted-unnamed', backup)).rejects.toThrow(/keine eindeutige Rechnungsidentität/u);
    expect(hashJson((await readBackupSnapshot('partial-old-adopted-unnamed')).data)).toBe(hashJson(before.data));
  });

  it('rejects an unnamed source document with disjoint journal keys instead of cloning its ledger', async () => {
    await user('partial-unnamed-divergent');
    const first = fixture([40], [dateA]); Object.assign(first.data.invoices[0], { invoiceNumber: null });
    await apply('partial-unnamed-divergent', envelope(first.data), true);
    const divergent = fixture([40], [dateA]); Object.assign(divergent.data.invoices[0], { invoiceNumber: null });
    divergent.data.paymentJournalEvents[0].idempotencyKey = 'disjoint-unnamed-branch';
    // Distinct source IDs cannot be assumed to mean a distinct document.
    divergent.data.paymentJournalEvents[0].id = 99;
    const before = await readBackupSnapshot('partial-unnamed-divergent');
    await expect(apply('partial-unnamed-divergent', envelope(divergent.data))).rejects.toThrow(/ohne eindeutige Rechnungsidentität/u);
    expect(hashJson((await readBackupSnapshot('partial-unnamed-divergent')).data)).toBe(hashJson(before.data));
  });


  it.each(['journal-free', 'disjoint-journal'] as const)('rejects whitespace invoice identity without rewriting the source: %s', async (kind) => {
    const target = `partial-whitespace-${kind}`;
    await user(target);
    const first = fixture([40], [dateA]);
    Object.assign(first.data.invoices[0], { invoiceNumber: null });
    await apply(target, envelope(first.data), true);
    const whitespaceNumber = ' \t ';
    const source = kind === 'journal-free' ? fixture([120], [dateA]) : fixture([40], [dateA]);
    source.data.invoices[0].invoiceNumber = whitespaceNumber;
    if (kind === 'journal-free') source.data.paymentJournalEvents = [];
    else Object.assign(source.data.paymentJournalEvents[0], { id: 99, idempotencyKey: 'disjoint-whitespace-payment' });
    const backup = kind === 'journal-free' ? { version: '2.0', data: source.data } : envelope(source.data);
    const before = await readBackupSnapshot(target);
    await expect(apply(target, backup)).rejects.toThrow(/eindeutige Rechnungsidentität/u);
    expect(source.data.invoices[0].invoiceNumber).toBe(whitespaceNumber);
    expect(hashJson((await readBackupSnapshot(target)).data)).toBe(hashJson(before.data));
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(1);
    expect(await database.client.income.count({ where: { userId: target } })).toBe(1);
    expect(await database.client.paymentJournalEvent.count({ where: { userId: target } })).toBe(1);
    expect(await database.client.invoice.findFirstOrThrow({ where: { userId: target } })).toMatchObject({ invoiceNumber: null });
  });

});
