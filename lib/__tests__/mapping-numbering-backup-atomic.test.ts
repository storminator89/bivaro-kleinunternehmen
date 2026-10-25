import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createBackupManifest } from './helpers/backup';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION } from '@/lib/bank-import-contract';
import { createBackupPreview } from '@/lib/backup-preview';
import { restoreBackupData } from '@/lib/backup-restore';
import { readBackupSnapshot } from '@/lib/backup-snapshot';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
const at = '2026-10-24T00:00:00.000Z';
function fixture() {
  const id = randomUUID();
  const data = { user: { id: 'synthetic-source' }, customers: [], suppliers: [], serviceArticles: [], purchaseDocuments: [], invoices: [], paymentJournalEvents: [], serviceProjects: [], billingNotes: [], purchaseValidationReports: [], serviceBillingPlans: [], serviceBillingPeriods: [], auditLogs: [], invoiceNumberCounters: [],
    bankMappingProfiles: [{ id, revision: 1, deletedAt: null, deleteMutationId: null, createdAt: at, updatedAt: at }],
    bankMappingProfileRevisions: [{ profileId: id, revision: 1, mutationId: randomUUID(), configuration: { version: 1, name: 'Synthetisches Profil', parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, delimiter: ';', mapping: { headerRow: 0, date: 0, amount: 1, credit: null, debit: null, currency: null, counterparty: null, reference: null, externalId: null, decimalSeparator: ',', accountAlias: 'Synthetisches Konto', defaultCurrency: 'EUR', amountMode: 'signed' }, headerHashes: ['1'.repeat(64), '2'.repeat(64)] }, createdAt: at }],
    documentNumberingPolicies: [{ type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'RE-', includeYear: true, sequenceWidth: 4, startSequence: 1, effectiveYear: 2026, createdAt: at }],
  };
  return { version: '3.0', type: 'json', data, manifest: createBackupManifest({ sourceUserId: data.user.id, generatedAt: at, data }) };
}

describe('shared backup integration without a database', () => {
  it('rolls back profile writes when a numbering conflict aborts the encompassing restore', async () => {
    const backup = fixture(), committed: unknown[] = [], attempted: unknown[] = [];
    const existingPolicy = { userId: 'target-owner', ...backup.data.documentNumberingPolicies[0], prefix: 'DIVERGENT-', createdAt: new Date(at) };
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const draft = structuredClone(committed);
      const tx = new Proxy({}, { get: (_target, model: string) => {
        if (model === 'bankMappingProfile') return {
          findMany: async (query: unknown) => { expect(query).toMatchObject({ where: { userId: 'target-owner' } }); return []; },
          create: async ({ data }: { data: unknown }) => { attempted.push(data); draft.push(data); return data; },
        };
        if (model === 'bankMappingProfileRevision') return { create: async ({ data }: { data: unknown }) => { draft.push(data); return data; } };
        if (model === 'documentNumberingPolicy') return { findMany: async (query: unknown) => { expect(query).toMatchObject({ where: { userId: 'target-owner' } }); return [existingPolicy]; } };
        return { findMany: async () => [], count: async () => 0 };
      } });
      const result = await work(tx);
      committed.splice(0, committed.length, ...draft);
      return result;
    });
    state.client = { annualBusinessContextRevision: { findMany: async () => [] }, quoteCreateReceipt: { findMany: async () => [] }, $transaction: transaction };
    await expect(restoreBackupData({ userId: 'target-owner', backup, overwrite: false })).rejects.toThrow(/Nummernformat-Revision weicht/);
    expect(transaction).toHaveBeenCalledOnce();
    expect(attempted).toHaveLength(1);
    expect(committed).toEqual([]);
    expect(existingPolicy.prefix).toBe('DIVERGENT-');
  });
  it('preserves target profile/policy history and custom counter floors during legacy overwrite', async () => {
    const source = fixture(), profile = { userId: 'target-owner', ...source.data.bankMappingProfiles[0] };
    const policy = { userId: 'target-owner', ...source.data.documentNumberingPolicies[0], createdAt: new Date(at) };
    const counters = new Map<string, { userId: string; type: string; year: number; value: number }>();
    let deletedInvoices = false;
    const deletedModels: string[] = [];
    const client = new Proxy({}, { get: (_target, model: string) => {
      if (model === '$transaction') return async (work: (tx: unknown) => Promise<unknown>) => work(client);
      if (model === 'documentNumberingPolicy') return { findMany: async (query: { select?: unknown }) => query.select ? [{ ...source.data.documentNumberingPolicies[0], createdAt: new Date(at) }] : [policy] };
      if (model === 'invoiceNumberCounter') return {
        findMany: async () => [...counters.values()],
        findUnique: async ({ where }: { where: { userId_type_year: { type: string; year: number } } }) => counters.get(`${where.userId_type_year.type}:${where.userId_type_year.year}`) ?? null,
        upsert: async ({ where, create, update }: { where: { userId_type_year: { type: string; year: number } }; create: { userId: string; type: string; year: number; value: number }; update: { value: number } }) => {
          const key = `${where.userId_type_year.type}:${where.userId_type_year.year}`, existing = counters.get(key);
          counters.set(key, existing ? { ...existing, ...update } : create);
        },
      };
      return {
        findMany: async (query: { where?: { quoteCreateRequestId?: unknown } }) => model === 'invoice' && !query.where?.quoteCreateRequestId && !deletedInvoices ? [{ type: 'INVOICE', invoiceNumber: 'RE-2026-0900' }] : [],
        findFirst: async () => null,
        count: async () => 0,
        deleteMany: async () => { deletedModels.push(model); if (model === 'invoice') deletedInvoices = true; return { count: 0 }; },
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: { data: unknown }) => data,
      };
    } });
    state.client = client;
    const result = await restoreBackupData({ userId: 'target-owner', backup: { version: '2.0', data: {} }, overwrite: true });
    expect(result.documentNumberingPolicies).toEqual({ imported: 0, skipped: 0 });
    expect(result.bankMappingProfiles).toEqual({ imported: 0, skipped: 0 });
    expect(counters.get('INVOICE:2026')?.value).toBe(900);
    expect(deletedModels).not.toContain('documentNumberingPolicy');
    expect(deletedModels).not.toContain('bankMappingProfile');
    expect(deletedModels).not.toContain('bankMappingProfileRevision');
    expect(policy.prefix).toBe('RE-');
    expect(profile.userId).toBe('target-owner');
  });
  it('uses the same closed-history validation in preview and committing restore before any transaction', async () => {
    const backup = fixture(); backup.data.bankMappingProfileRevisions = [];
    backup.manifest = createBackupManifest({ sourceUserId: backup.data.user.id, generatedAt: at, data: backup.data });
    const transaction = vi.fn(); state.client = { $transaction: transaction };
    expect(() => createBackupPreview(backup)).toThrow(/vollständig|lückenlos/);
    await expect(restoreBackupData({ userId: 'target-owner', backup, overwrite: true })).rejects.toThrow(/vollständig|lückenlos/);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('fails export rather than leaking unknown raw data from stored JSON configuration', async () => {
    const source = fixture().data;
    const revision = { ...source.bankMappingProfileRevisions[0], configuration: { ...source.bankMappingProfileRevisions[0].configuration, rawRows: ['private synthetic transaction'] } };
    const tx = new Proxy({}, { get: (_target, model: string) => ({
      count: async () => 0,
      findUnique: async () => model === 'user' ? source.user : null,
      findMany: async () => model === 'bankMappingProfile' ? source.bankMappingProfiles : model === 'bankMappingProfileRevision' ? [revision] : [],
    }) });
    state.client = { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx) };
    await expect(readBackupSnapshot('synthetic-source')).rejects.toThrow(/nicht unterstützte Felder|Bankdaten/);
  });
  it('reads all three feature collections in the same tenant snapshot with explicit field allowlists', async () => {
    const queries = new Map<string, Record<string, unknown>>();
    const tx = new Proxy({}, { get: (_target, model: string) => ({
      count: async () => 0,
      findUnique: async () => model === 'user' ? { id: 'snapshot-owner', email: 'synthetic@example.test', name: 'Synthetic' } : null,
      findMany: async (query: Record<string, unknown>) => { queries.set(model, query); return []; },
    }) });
    const transaction = vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx));
    state.client = { $transaction: transaction };
    const snapshot = await readBackupSnapshot('snapshot-owner');
    expect(transaction).toHaveBeenCalledOnce();
    expect(queries.get('bankMappingProfile')?.where).toEqual({ userId: 'snapshot-owner' });
    expect(queries.get('bankMappingProfileRevision')?.where).toEqual({ userId: 'snapshot-owner', profile: { userId: 'snapshot-owner' } });
    expect(queries.get('documentNumberingPolicy')?.where).toEqual({ userId: 'snapshot-owner' });
    for (const model of ['bankMappingProfile', 'bankMappingProfileRevision', 'documentNumberingPolicy']) expect(queries.get(model)?.select).not.toHaveProperty('userId');
    expect(queries.get('bankMappingProfileRevision')?.select).toEqual({ profileId: true, revision: true, mutationId: true, configuration: true, createdAt: true });
    expect(snapshot.data).toMatchObject({ bankMappingProfiles: [], bankMappingProfileRevisions: [], documentNumberingPolicies: [] });
    expect(createBackupPreview({ version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: 'snapshot-owner', generatedAt: at, data: snapshot.data }) }).counts).toMatchObject({ bankMappingProfiles: 0, bankMappingProfileRevisions: 0, documentNumberingPolicies: 0 });
  });
});
