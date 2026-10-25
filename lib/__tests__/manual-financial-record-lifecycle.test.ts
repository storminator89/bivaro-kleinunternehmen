/** SOURCE ONLY: no tests, fixture DBs or app servers were executed for #54a. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { createTestDatabase } from './helpers/database';
import type { ManualFinancialRecordDto, ManualFinancialRecordKind, ManualFinancialRecordMutation } from '@/lib/manual-financial-record-contract';
import { calculateAccountingYear } from '@/lib/accounting';

const state = vi.hoisted(() => ({ client: null as unknown, owner: '', context: null as AsyncLocalStorage<PrismaClient> | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.context?.getStore() ?? state.client; } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/get-user-id', () => ({ getUserId: async () => state.owner, requireUserId: async () => state.owner, UnauthorizedError: class UnauthorizedError extends Error {}, unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return { ...actual, withApiAuth: async (_request: NextRequest, handler: Parameters<typeof actual.withApiAuth>[1]) => handler({ userId: state.owner, apiKeyId: 1, scopes: ['read', 'write', 'delete'] }) };
});
let db: ReturnType<typeof createTestDatabase>;
const extraDatabases: ReturnType<typeof createTestDatabase>[] = [];
let root: string;
let lifecycle: typeof import('@/lib/manual-financial-record-service');
let incomeService: typeof import('@/lib/income-service');
let expenseService: typeof import('@/lib/expense-service');
let cash: typeof import('@/lib/cashbook-service');
let storage: typeof import('@/lib/upload-path');
let backupSnapshot: typeof import('@/lib/backup-snapshot');
let backupManifest: typeof import('@/lib/backup-manifest');
let restore: typeof import('@/lib/backup-restore');
let accountant: typeof import('@/lib/accountant-export');
let webCustomer: typeof import('@/app/api/customers/route');
let apiCustomer: typeof import('@/app/api/v1/customers/route');
let webIncome: typeof import('@/app/api/incomes/route');
let apiIncome: typeof import('@/app/api/v1/incomes/route');
let webExpense: typeof import('@/app/api/expenses/route');
let apiExpense: typeof import('@/app/api/v1/expenses/route');
let lifecycleRoute: typeof import('@/app/api/manual-financial-records/route');
let summary: typeof import('@/app/api/dashboard/summary/route');
let kpis: typeof import('@/app/api/dashboard/kpis/route');
let taxSummary: typeof import('@/app/api/tax-summary/route');
let eur: typeof import('@/app/api/eur-export/route');
let download: typeof import('@/app/api/expenses/download/route');

beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client; state.context = new AsyncLocalStorage<PrismaClient>();
  root = await mkdtemp(path.join(tmpdir(), 'bivaro-manual-records-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  try {
    storage = await import('@/lib/upload-path'); lifecycle = await import('@/lib/manual-financial-record-service');
    incomeService = await import('@/lib/income-service'); expenseService = await import('@/lib/expense-service'); cash = await import('@/lib/cashbook-service');
    backupSnapshot = await import('@/lib/backup-snapshot'); backupManifest = await import('@/lib/backup-manifest'); restore = await import('@/lib/backup-restore'); accountant = await import('@/lib/accountant-export');
    webCustomer = await import('@/app/api/customers/route'); apiCustomer = await import('@/app/api/v1/customers/route');
    webIncome = await import('@/app/api/incomes/route'); apiIncome = await import('@/app/api/v1/incomes/route'); webExpense = await import('@/app/api/expenses/route'); apiExpense = await import('@/app/api/v1/expenses/route');
    kpis = await import('@/app/api/dashboard/kpis/route'); taxSummary = await import('@/app/api/tax-summary/route'); eur = await import('@/app/api/eur-export/route');
    lifecycleRoute = await import('@/app/api/manual-financial-records/route'); summary = await import('@/app/api/dashboard/summary/route'); download = await import('@/app/api/expenses/download/route');
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { for (const database of extraDatabases) await database.cleanup(); await db?.cleanup(); if (root) await rm(root, { recursive: true, force: true }); });
async function owner() { state.owner = `manual-${randomUUID()}`; await db.client.user.create({ data: { id: state.owner, email: `${state.owner}@test.invalid`, password: 'unused' } }); return state.owner; }
const at = new Date('2026-10-01T00:00:00.000Z');
const request = (url: string, method = 'GET', body?: object) => new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
function command(record: ManualFinancialRecordDto, operation: 'FINALIZE' | 'CORRECT_AMOUNT' = 'FINALIZE'): ManualFinancialRecordMutation {
  return { kind: record.kind, id: record.id, operation, expectedRevision: record.revision, fingerprint: record.fingerprint, mutationId: randomUUID(), ...(operation === 'CORRECT_AMOUNT' ? { amount: '80', reason: 'Mistyped original amount; no new payment' } : record.requiresLegacyDeclaration ? { legacyManualDeclaration: true as const } : {}) };
}
const read = (kind: ManualFinancialRecordKind, id: number) => lifecycle.getManualFinancialRecord(state.owner, kind, id);
async function createIncome(customerId: number | null = null) { return incomeService.createManualIncome(state.owner, { description: 'Actual manual receipt', amount: 100, date: at, customerId, taxRelevant: true }); }
async function createExpense() { return expenseService.createManualExpense(state.owner, { description: 'Actual manual outflow', amount: 100, date: at, category: 'Software', taxRelevant: true, taxDeductiblePercentage: 50 }); }
async function finalize(kind: ManualFinancialRecordKind, id: number) { return lifecycle.mutateManualFinancialRecord(state.owner, command(await read(kind, id))); }
async function makeBackup(type = 'json') {
  const snapshot = await backupSnapshot.readBackupSnapshot(state.owner), data = JSON.parse(JSON.stringify(snapshot.data));
  return { version: '3.0', type, data, manifest: backupManifest.createBackupManifest({ sourceUserId: state.owner, generatedAt: snapshot.info.endedAt, data, snapshot: snapshot.info }) };
}
async function files(ownerId: string) { try { return await readdir(storage.tenantUploadDir(ownerId)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } }

describe('manual record financial lifecycle, API bypasses and audit atomicity', () => {
  it('keeps 100→80 one effective row through dashboard, annual accounting, list APIs and handoff; snapshots are never additive', async () => {
    await owner(); const income = await createIncome(), expense = await createExpense();
    await finalize('income', income.id); await finalize('expense', expense.id);
    const preview = await accountant.previewAccountantExport(state.owner, accountant.parseAccountantExportPeriod(new URLSearchParams('year=2026')));
    for (const [kind, id] of [['income', income.id], ['expense', expense.id]] as const) await lifecycle.mutateManualFinancialRecord(state.owner, command(await read(kind, id), 'CORRECT_AMOUNT'));
    expect(await db.client.income.findUniqueOrThrow({ where: { id: income.id } })).toMatchObject({ amount: 80, date: at, customerId: null, taxRelevant: true });
    expect(await db.client.expense.findUniqueOrThrow({ where: { id: expense.id } })).toMatchObject({ amount: 80, date: at, category: 'Software', taxDeductiblePercentage: 50 });
    const incomes = await db.client.income.findMany({ where: { userId: state.owner } }), expenses = await db.client.expense.findMany({ where: { userId: state.owner } });
    expect(calculateAccountingYear(2026, incomes, expenses)).toMatchObject({ totalIncome: 80, totalExpense: 40, profit: 40 });
    expect(await (await summary.GET(request('/api/dashboard/summary?timeRange=all'))).json()).toMatchObject({ totalIncome: 80, totalExpense: 40, profit: 40 });
    expect(await (await kpis.GET(request('/api/dashboard/kpis?year=2026'))).json()).toMatchObject({ totalRevenue: 80, totalExpenses: 80 });
    expect(await (await taxSummary.GET(request('/api/tax-summary?year=2026&timeRange=all'))).json()).toMatchObject({ totalIncome: 80, totalExpenses: 40, profit: 40 });
    expect((await (await eur.GET(request('/api/eur-export?year=2026&format=json'))).json()).data).toMatchObject({ totalIncome: 80, totalExpense: 40, profit: 40 });
    expect((await (await webIncome.GET(request('/api/incomes'))).json()).items).toHaveLength(1);
    expect((await (await webExpense.GET(request('/api/expenses'))).json()).items).toHaveLength(1);
    const period = accountant.parseAccountantExportPeriod(new URLSearchParams('year=2026'));
    await expect(accountant.createAccountantExport(state.owner, period, preview.manifest.sourceFingerprint)).rejects.toMatchObject({ status: 409 });
    const result = await accountant.createAccountantExport(state.owner, period), zip = await JSZip.loadAsync(result.bytes), records = JSON.parse(await zip.file('records.json')!.async('string'));
    expect(records.incomes.map((row: { amount: number }) => row.amount)).toEqual([80]); expect(records.expenses.map((row: { amount: number }) => row.amount)).toEqual([80]);
    expect(records.manualFinancialRecordEvents).toHaveLength(4); expect(records.manualFinancialRecordEvents.every((row: { contextOnly: boolean; cashEffectCents: string }) => row.contextOnly && row.cashEffectCents === '0')).toBe(true);
    expect((await read('income', income.id)).history.map(event => event.amount)).toEqual(['100', '80']);
    expect(await db.client.cashTransaction.count({ where: { userId: state.owner } })).toBe(0);
  });
  it('rejects finalized PUT/DELETE with stable 409 through BOTH web and API v1 income/expense paths', async () => {
    await owner(); const income = await createIncome(), expense = await createExpense(); await finalize('income', income.id); await finalize('expense', expense.id);
    for (const [kind, id, web, api] of [['incomes', income.id, webIncome, apiIncome], ['expenses', expense.id, webExpense, apiExpense]] as const) {
      for (const [route, suffix] of [[web, `/api/${kind}`], [api, `/api/v1/${kind}`]] as const) for (const method of ['PUT', 'DELETE'] as const) {
        const response = await route[method](request(`${suffix}?id=${id}`, method, method === 'PUT' ? { id, description: 'bypass attempt', amount: 2 } : undefined));
        const body = await response.json(); expect(response.status).toBe(409); expect(body.code ?? body.error?.code).toBe('FINALIZED_RECORD');
      }
    }
  });
  it('returns stable finalized-customer conflicts on web and v1, including the authoritative SQL race guard', async () => {
    await owner(); const customer = await db.client.customer.create({ data: { userId: state.owner, name: 'Retained manual reference' } }), income = await createIncome(customer.id); await finalize('income', income.id);
    for (const [route, url] of [[webCustomer, '/api/customers'], [apiCustomer, '/api/v1/customers']] as const) {
      const response = await route.DELETE(request(`${url}?id=${customer.id}`, 'DELETE')), body = await response.json();
      expect(response.status).toBe(409); expect(body.code ?? body.error?.code).toBe('FINALIZED_RECORD');
    }
    // Simulate a stale precheck, not a fake transaction: the actual migrated
    // SQLite trigger must retain the reference and the API maps its failure.
    const stalePrecheck = vi.spyOn(db.client.income, 'findFirst').mockResolvedValueOnce(null);
    try {
      const response = await apiCustomer.DELETE(request(`/api/v1/customers?id=${customer.id}`, 'DELETE'));
      expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('FINALIZED_RECORD');
    } finally { stalePrecheck.mockRestore(); }
    expect(await db.client.customer.findUnique({ where: { id: customer.id } })).not.toBeNull();
    expect((await db.client.income.findUniqueOrThrow({ where: { id: income.id } })).customerId).toBe(customer.id);
  });
  it('replays identical mutation semantics before stale CAS, rejects key reuse, and recovers an unknown response from GET history', async () => {
    await owner(); const income = await createIncome(), input = command(await read('income', income.id));
    const accepted = await lifecycle.mutateManualFinancialRecord(state.owner, input); expect(accepted.replayed).toBe(false);
    expect((await lifecycle.mutateManualFinancialRecord(state.owner, input)).replayed).toBe(true);
    const response = await lifecycleRoute.GET(request(`/api/manual-financial-records?kind=income&id=${income.id}`));
    expect((await response.json()).record.history.some((event: { mutationId: string }) => event.mutationId === input.mutationId)).toBe(true);
    await expect(lifecycle.mutateManualFinancialRecord(state.owner, { ...input, fingerprint: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'MANUAL_RECORD_MUTATION_CONFLICT' });
    expect(await db.client.manualFinancialRecordEvent.count({ where: { userId: state.owner } })).toBe(1);
  });
  it('updates technical revisions for ordinary draft edits and rejects changed finalization previews', async () => {
    await owner(); const row = await createIncome(), old = await read('income', row.id);
    await incomeService.updateManualIncome(state.owner, row.id, { description: 'Changed actual receipt description' });
    expect((await read('income', row.id)).revision).toBe(old.revision + 1);
    await expect(lifecycle.mutateManualFinancialRecord(state.owner, command(old))).rejects.toMatchObject({ code: 'MANUAL_RECORD_STALE' });
  });
  it('commits at most one of competing correction commands across independent connections', async () => {
    await owner(); const row = await createIncome(); await finalize('income', row.id); const preview = await read('income', row.id);
    // eslint-disable-next-line no-restricted-syntax -- explicit second connection to this isolated fixture only.
    const second = new PrismaClient({ datasources: { db: { url: db.url } } });
    try {
      const results = await Promise.allSettled([state.context!.run(db.client, () => lifecycle.mutateManualFinancialRecord(state.owner, command(preview, 'CORRECT_AMOUNT'))), state.context!.run(second, () => lifecycle.mutateManualFinancialRecord(state.owner, { ...command(preview, 'CORRECT_AMOUNT'), amount: '70' }))]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(await db.client.manualFinancialRecordEvent.count({ where: { recordId: row.manualRecordId! } })).toBe(2);
    } finally { await second.$disconnect(); }
  });
  it('rolls back the actual projection, immutable event and revision when mandatory audit insertion fails', async () => {
    await owner(); const row = await createIncome(); await finalize('income', row.id); const input = command(await read('income', row.id), 'CORRECT_AMOUNT');
    await db.client.$executeRawUnsafe(`CREATE TRIGGER manual_test_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.entityType='Income' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`);
    try { await expect(lifecycle.mutateManualFinancialRecord(state.owner, input)).rejects.toThrow(); } finally { await db.client.$executeRawUnsafe('DROP TRIGGER manual_test_audit_failure'); }
    expect(await db.client.income.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ amount: 100, manualRecordRevision: 1 });
    expect(await db.client.manualFinancialRecordEvent.count({ where: { recordId: row.manualRecordId! } })).toBe(1);
  });
  it('requires an explicit legacy declaration, never rounds old fractions, and preserves unsupported mutability', async () => {
    await owner(); const legacy = await db.client.income.create({ data: { userId: state.owner, description: 'Legacy effective receipt', amount: 100, date: at } }), preview = await read('income', legacy.id);
    await expect(lifecycle.mutateManualFinancialRecord(state.owner, { ...command(preview), legacyManualDeclaration: undefined })).rejects.toMatchObject({ code: 'MANUAL_RECORD_LEGACY_DECLARATION_REQUIRED' });
    await finalize('income', legacy.id);
    const fraction = await db.client.income.create({ data: { userId: state.owner, description: 'Unrounded old fraction', amount: 100.001, date: at } });
    expect((await read('income', fraction.id)).canFinalize).toBe(false); expect((await db.client.income.findUniqueOrThrow({ where: { id: fraction.id } })).amount).toBe(100.001);
    const afa = await db.client.expense.create({ data: { userId: state.owner, description: 'Existing AfA source', amount: 100, date: at, depreciationYears: 3 } });
    expect((await read('expense', afa.id)).canFinalize).toBe(false); await expenseService.updateManualExpense(state.owner, afa.id, { description: 'Still editable through appropriate old path' });
  });
  it('uses source relations over false MANUAL metadata and retains recurring origin after FK removal', async () => {
    await owner(); const expense = await createExpense();
    await db.client.purchaseDocument.create({ data: { userId: state.owner, expenseId: expense.id, originalFileName: 'source.pdf', storedFileName: `${randomUUID()}.pdf`, originalSha256: 'c'.repeat(64), originalByteCount: 4, mediaType: 'application/pdf', uploadRequestId: randomUUID() } });
    expect((await read('expense', expense.id)).canFinalize).toBe(false); await expect(expenseService.deleteManualExpense(state.owner, expense.id)).rejects.toMatchObject({ code: 'SOURCE_LINKED' });
    const series = await db.client.recurringExpense.create({ data: { userId: state.owner, description: 'Series', amount: 100, interval: 'MONTHLY', nextExecution: at } });
    const execution = await db.client.expense.create({ data: { userId: state.owner, description: 'Series execution', amount: 100, date: at, recurringExpenseId: series.id, manualRecordOrigin: 'RECURRING' } });
    await db.client.recurringExpense.delete({ where: { id: series.id } }); expect((await read('expense', execution.id)).canFinalize).toBe(false);
  });
  it('atomically prevents cash/source attachment and customer SetNull races against finalization', async () => {
    await owner(); const row = await createIncome(), preview = await read('income', row.id), book = await db.client.cashBook.create({ data: { userId: state.owner } });
    const cashRace = await Promise.allSettled([lifecycle.mutateManualFinancialRecord(state.owner, command(preview)), cash.createCashTransaction(state.owner, { cashBookId: book.id, type: 'EINNAHME', incomeId: row.id, amount: 100, date: '2026-10-01', description: 'Cash attachment' })]);
    expect(cashRace.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const customer = await db.client.customer.create({ data: { userId: state.owner, name: 'Frozen reference' } }), customerIncome = await createIncome(customer.id), customerPreview = await read('income', customerIncome.id);
    const customerRace = await Promise.allSettled([lifecycle.mutateManualFinancialRecord(state.owner, command(customerPreview)), db.client.customer.delete({ where: { id: customer.id } })]);
    expect(customerRace.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    if ((await db.client.income.findUniqueOrThrow({ where: { id: customerIncome.id } })).manualRecordState === 'FINALIZED') expect((await db.client.income.findUniqueOrThrow({ where: { id: customerIncome.id } })).customerId).toBe(customer.id);
    const sourceExpense = await createExpense(), sourcePreview = await read('expense', sourceExpense.id);
    const sourceRace = await Promise.allSettled([lifecycle.mutateManualFinancialRecord(state.owner, command(sourcePreview)), db.client.purchaseDocument.create({ data: { userId: state.owner, expenseId: sourceExpense.id, originalFileName: 'source.pdf', storedFileName: `${randomUUID()}.pdf`, originalSha256: 'd'.repeat(64), originalByteCount: 4, mediaType: 'application/pdf', uploadRequestId: randomUUID() } })]);
    expect(sourceRace.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('binds only private stable original bytes and blocks finalization/correction/download/backup after tampering', async () => {
    await owner(); const bytes = Buffer.from('%PDF synthetic original'); const storedName = await storage.writeTenantFile(state.owner, 'original.pdf', bytes);
    const row = await expenseService.createManualExpense(state.owner, { description: 'Receipt-backed outflow', amount: 100, date: at, receiptFileName: 'original.pdf', storedReceiptFileName: storedName });
    const accepted = await finalize('expense', row.id); expect(accepted.record.original.status).toBe('ARCHIVED');
    await writeFile(storage.getTenantUploadPath(state.owner, storedName), Buffer.from('tampered'));
    expect((await read('expense', row.id)).original.status).toBe('UNVERIFIED');
    await expect(lifecycle.mutateManualFinancialRecord(state.owner, command(await read('expense', row.id), 'CORRECT_AMOUNT'))).rejects.toMatchObject({ code: 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE' });
    expect((await download.GET(request(`/api/expenses/download?id=${row.id}`))).status).toBe(409); await expect(makeBackup()).rejects.toThrow();
    const external = await expenseService.createManualExpense(state.owner, { description: 'URL is not archived proof', amount: 3, date: at, receiptUrl: 'https://example.invalid/original.pdf' });
    expect((await read('expense', external.id)).original.status).toBe('UNVERIFIED');
  });
});

describe('manual financial backup replay, owner remap and rollback', () => {
  it('replays exact finalized UUID+chain without passing through duplicate-producing generic financial creates', async () => {
    await owner(); const row = await createIncome(); await finalize('income', row.id); await lifecycle.mutateManualFinancialRecord(state.owner, command(await read('income', row.id), 'CORRECT_AMOUNT'));
    const backup = await makeBackup(); const before = await db.client.income.count({ where: { userId: state.owner } });
    for (let attempt = 0; attempt < 2; attempt++) await restore.restoreBackupData({ userId: state.owner, backup, overwrite: false });
    expect(await db.client.income.count({ where: { userId: state.owner } })).toBe(before);
    expect((await db.client.income.findUniqueOrThrow({ where: { id: row.id } })).amount).toBe(80);
    expect(await db.client.manualFinancialRecordEvent.count({ where: { userId: state.owner } })).toBe(2);
  });
  it('blocks older/newer/divergent history and legacy overwrite without staging or duplicating finance', async () => {
    await owner(); const row = await createIncome(); await finalize('income', row.id); const older = await makeBackup();
    await lifecycle.mutateManualFinancialRecord(state.owner, command(await read('income', row.id), 'CORRECT_AMOUNT'));
    const before = await db.client.income.count({ where: { userId: state.owner } }), resolver = vi.fn(async () => Buffer.from('must never be staged'));
    await expect(restore.restoreBackupData({ userId: state.owner, backup: older, overwrite: false, resolveFile: resolver })).rejects.toThrow(/älter|neuer|abweichend|Projektion/);
    expect(resolver).not.toHaveBeenCalled();
    await expect(restore.restoreBackupData({ userId: state.owner, backup: { version: '2.0', data: {} }, overwrite: true })).rejects.toThrow(/Festschreibungsverlauf/);
    expect(await db.client.income.count({ where: { userId: state.owner } })).toBe(before);
  });
  it('fail-closes legacy finance merge into a finalized target rather than fuzzy-matching or creating a duplicate', async () => {
    await owner(); const row = await createIncome(); await finalize('income', row.id);
    const backup = { version: '2.0', data: { incomes: [{ id: 902, description: row.description, amount: row.amount, date: row.date.toISOString(), taxRelevant: true }] } }, resolver = vi.fn(async () => null);
    await expect(restore.restoreBackupData({ userId: state.owner, backup, overwrite: false, resolveFile: resolver })).rejects.toThrow(/keine portablen|duplizieren/);
    expect(resolver).not.toHaveBeenCalled(); expect(await db.client.income.count({ where: { userId: state.owner } })).toBe(1);
    await owner(); await restore.restoreBackupData({ userId: state.owner, backup, overwrite: false });
    expect(await db.client.income.findFirstOrThrow({ where: { userId: state.owner } })).toMatchObject({ manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: 'LEGACY_UNKNOWN', amount: 100 });
  });
  it('preserves portable UUIDs and exact evidence while numeric IDs and owner remap into a separate empty target', async () => {
    const sourceOwner = await owner(), row = await createIncome(); await finalize('income', row.id); const backup = await makeBackup();
    const target = createTestDatabase(); extraDatabases.push(target); const targetOwner = `target-${randomUUID()}`;
    await target.client.user.create({ data: { id: targetOwner, email: `${targetOwner}@test.invalid`, password: 'unused' } });
    // Occupy a numeric row ID in the independent target; there is no fuzzy match.
    await target.client.income.create({ data: { id: row.id, userId: targetOwner, description: 'Unrelated actual receipt', amount: 1, date: at } });
    await state.context!.run(target.client, () => restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false }));
    const imported = await target.client.income.findUniqueOrThrow({ where: { manualRecordId: row.manualRecordId! } });
    expect(imported.id).not.toBe(row.id); expect(imported.userId).toBe(targetOwner); expect(imported.amount).toBe(100);
    const sourceEvents = await db.client.manualFinancialRecordEvent.findMany({ where: { userId: sourceOwner }, orderBy: { sequence: 'asc' } });
    const targetEvents = await target.client.manualFinancialRecordEvent.findMany({ where: { userId: targetOwner }, orderBy: { sequence: 'asc' } });
    expect(targetEvents.map(event => ({ id: event.id, snapshot: event.snapshot, hash: event.hash }))).toEqual(sourceEvents.map(event => ({ id: event.id, snapshot: event.snapshot, hash: event.hash })));
    expect(targetEvents[0].incomeId).toBe(imported.id);
    await state.context!.run(target.client, () => restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false }));
    expect(await target.client.income.count({ where: { manualRecordId: row.manualRecordId! } })).toBe(1);
  });
  it('blocks cross-owner portable identities even when numeric amounts and names happen to match', async () => {
    const sourceOwner = await owner(), row = await createIncome(); await finalize('income', row.id); const backup = await makeBackup();
    const targetOwner = await owner(); await expect(restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false })).rejects.toThrow(/Mandanten/);
    expect((await db.client.income.findUniqueOrThrow({ where: { id: row.id } })).userId).toBe(sourceOwner);
    expect(await db.client.income.count({ where: { userId: targetOwner } })).toBe(0);
  });
  it('requires ZIP for new archived originals and rolls back new files/rows/history on actual restore audit failure', async () => {
    await owner(); const bytes = Buffer.from('%PDF synthetic preserved original'), storedName = await storage.writeTenantFile(state.owner, 'preserve.pdf', bytes);
    const row = await expenseService.createManualExpense(state.owner, { description: 'Portable original outflow', amount: 100, date: at, receiptFileName: 'preserve.pdf', storedReceiptFileName: storedName });
    const finalized = await finalize('expense', row.id), backup = await makeBackup('full');
    backup.manifest = backupManifest.createBackupManifest({ sourceUserId: state.owner, generatedAt: backup.manifest.generatedAt, data: backup.data, snapshot: backup.manifest.snapshot, fileManifest: [{ kind: 'receipt', sourceName: storedName, zipPath: `receipts/${storedName}`, sha256: finalized.record.original.sha256!, bytes: bytes.byteLength }] });
    const target = createTestDatabase(); extraDatabases.push(target); const targetOwner = `restore-${randomUUID()}`;
    await target.client.user.create({ data: { id: targetOwner, email: `${targetOwner}@test.invalid`, password: 'unused' } });
    const jsonBackup = { ...backup, type: 'json' };
    await expect(state.context!.run(target.client, () => restore.restoreBackupData({ userId: targetOwner, backup: jsonBackup, overwrite: false }))).rejects.toThrow(/ZIP/);
    await target.client.$executeRawUnsafe(`CREATE TRIGGER manual_restore_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.entityType='Backup' AND NEW.action='RESTORE' BEGIN SELECT RAISE(ABORT,'synthetic restore audit failure'); END`);
    try { await expect(state.context!.run(target.client, () => restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false, resolveFile: async () => bytes }))).rejects.toThrow(); }
    finally { await target.client.$executeRawUnsafe('DROP TRIGGER manual_restore_audit_failure'); }
    expect(await target.client.expense.count({ where: { userId: targetOwner } })).toBe(0); expect(await target.client.manualFinancialRecordEvent.count({ where: { userId: targetOwner } })).toBe(0); expect(await files(targetOwner)).toEqual([]);
    await state.context!.run(target.client, () => restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false, resolveFile: async () => bytes }));
    expect(await target.client.expense.count({ where: { userId: targetOwner } })).toBe(1);
  });
});
