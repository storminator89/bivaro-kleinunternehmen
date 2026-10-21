import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDatabase } from './helpers/database';
import { PURCHASE_RULES_SHA256, PURCHASE_RULES_VERSION, PURCHASE_VALIDATION_VERSION, PURCHASE_VALIDATOR_VERSION, XRECHNUNG_PROFILE } from '@/lib/purchase-documents/validation-contract';
import { createBackupManifest, PRE_PURCHASE_VALIDATION_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { technicalReportFingerprint } from '@/lib/purchase-documents/validation-evidence';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'validator-owner' as string | null, runs: 0, auditFail: false }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
vi.mock('@/lib/purchase-documents/validation-runtime', () => ({ validatePurchaseOriginal: async (input: { expectedSha256: string }) => {
  state.runs++;
  return { reportVersion: 1, originalSha256: input.expectedSha256, checkerVersion: PURCHASE_VALIDATION_VERSION, validatorVersion: PURCHASE_VALIDATOR_VERSION, rulesVersion: PURCHASE_RULES_VERSION, rulesSha256: PURCHASE_RULES_SHA256,
    checkedAt: new Date().toISOString(), status: 'VALID', reasonCode: 'SUPPORTED_RULES_PASSED', format: 'UBL', profile: XRECHNUNG_PROFILE, checks: { xml: 'PASSED', xsd: 'PASSED', schematron: 'PASSED' }, findings: [], findingsTruncated: false, accountingApproval: 'NOT_PERFORMED' };
} }));
vi.mock('@/lib/audit-log', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/audit-log')>();
  return { ...actual, createFinancialAuditLog: async (...args: Parameters<typeof actual.createFinancialAuditLog>) => {
    if (state.auditFail && args[0].metadata.operation === 'purchase-document.validate') throw new Error('synthetic audit failure');
    return actual.createFinancialAuditLog(...args);
  } };
});
let database: ReturnType<typeof createTestDatabase>, storage: string;
let intake: typeof import('@/lib/purchase-documents/service');
let route: typeof import('@/app/api/purchase-documents/[id]/validation/route');
let document: Awaited<ReturnType<typeof import('@/lib/purchase-documents/service').intakePurchaseDocument>>['document'];
const context = (id = document.id) => ({ params: Promise.resolve({ id: String(id) }) });
const get = (id = document.id) => route.GET(new NextRequest(`http://localhost/api/purchase-documents/${id}/validation`), context(id));
const payload = (extra = {}) => ({ expectedRevision: document.revision, expectedSha256: document.originalRef.sha256, requestId: randomUUID(), checkerVersion: PURCHASE_VALIDATION_VERSION, rulesVersion: PURCHASE_RULES_VERSION, ...extra });
const post = (body: Record<string, unknown>, id = document.id) => route.POST(new NextRequest(`http://localhost/api/purchase-documents/${id}/validation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), context(id));
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['validator-owner', 'validator-other'].map(id => ({ id, email: `${id}@example.test`, password: 'unused' })) });
  storage = await mkdtemp(path.join(tmpdir(), 'bivaro-validation-service-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storage);
  try { intake = await import('@/lib/purchase-documents/service'); route = await import('@/app/api/purchase-documents/[id]/validation/route'); }
  finally { cwd.mockRestore(); }
  document = (await intake.intakePurchaseDocument({ userId: 'validator-owner', requestId: randomUUID(), originalFileName: 'synthetic.xml', mediaType: 'application/xml', bytes: Buffer.from('<Invoice><ID>SYNTHETIC</ID><LegalMonetaryTotal><TaxInclusiveAmount>119</TaxInclusiveAmount><PayableAmount>119</PayableAmount></LegalMonetaryTotal></Invoice>') })).document;
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (storage) await rm(storage, { recursive: true, force: true }); });
describe('immutable owned technical reports without financial effects', () => {
  it('stores an append-only report bound to original hash, independent of parsing/revision/financial records', async () => {
    const before = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } });
    const body = payload();
    const response = await post(body); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toMatchObject({ replayed: false, reports: [{ provenance: 'LOCAL', current: true, report: { status: 'VALID', originalSha256: document.originalRef.sha256, accountingApproval: 'NOT_PERFORMED' } }] });
    expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } })).toEqual(before);
    expect(await Promise.all([database.client.expense.count(), database.client.income.count(), database.client.invoice.count(), database.client.customer.count(), database.client.cashTransaction.count(), database.client.invoiceNumberCounter.count()])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await database.client.purchaseValidationReport.count()).toBe(1); expect(state.runs).toBe(1);
    expect((await post(body)).status).toBe(200); expect(state.runs).toBe(1); expect(await database.client.purchaseValidationReport.count()).toBe(1);
    const row = await database.client.purchaseValidationReport.findFirstOrThrow();
    await expect(database.client.purchaseValidationReport.update({ where: { id: row.id }, data: { provenance: 'IMPORTED_HISTORIC' } })).rejects.toThrow();
    await expect(database.client.purchaseValidationReport.delete({ where: { id: row.id } })).rejects.toThrow();
    const history = await get(); expect(history.status).toBe(200); expect(history.headers.get('cache-control')).toBe('private, no-store');
  });
  it('distinguishes stale revision/hash/version and does not run the validator for rejected input', async () => {
    const before = state.runs;
    for (const extra of [{ expectedRevision: document.revision + 1 }, { expectedSha256: 'a'.repeat(64) }, { rulesVersion: 'other-version' }, { checkerVersion: 'old-checker' }]) expect((await post(payload(extra))).status).toBe(409);
    expect((await post(payload({ requestId: 'not-a-uuid' }))).status).toBe(400);
    expect((await post({ ...payload(), userId: 'validator-other' })).status).toBe(400);
    expect(state.runs).toBe(before);
  });
  it('blocks cross-tenant history and validation even for a known original hash', async () => {
    state.userId = 'validator-other';
    try { expect((await get()).status).toBe(404); expect((await post(payload())).status).toBe(404); }
    finally { state.userId = 'validator-owner'; }
    state.userId = null;
    try { expect((await get()).status).toBe(401); expect((await post(payload())).status).toBe(401); }
    finally { state.userId = 'validator-owner'; }
  });
  it('creates a new historical record only on explicit rerun and rolls back report+audit together', async () => {
    const before = await database.client.purchaseValidationReport.count();
    state.auditFail = true;
    try { expect((await post(payload())).status).toBe(500); }
    finally { state.auditFail = false; }
    expect(await database.client.purchaseValidationReport.count()).toBe(before);
    expect((await post(payload())).status).toBe(200); expect(await database.client.purchaseValidationReport.count()).toBe(before + 1);
  });
  it('exports original-bound evidence, imports it only as historic, deduplicates and preserves target history across overwrite', async () => {
    const { readBackupSnapshot } = await import('@/lib/backup-snapshot');
    const { restoreBackupData, validateBackupForRestore } = await import('@/lib/backup-restore');
    const { readPurchaseOriginal } = await import('@/lib/purchase-documents/original');
    const source = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } });
    const bytes = await readPurchaseOriginal(source);
    const data = JSON.parse(JSON.stringify((await readBackupSnapshot('validator-owner')).data));
    expect(data.purchaseValidationReports).toHaveLength(2);
    expect(data.purchaseValidationReports[0]).not.toHaveProperty('id'); expect(data.purchaseValidationReports[0]).not.toHaveProperty('userId');
    const manifest = (value: typeof data) => createBackupManifest({ sourceUserId: 'validator-owner', generatedAt: new Date().toISOString(), data: value, fileManifest: [{ kind: 'purchase-document', sourceName: source.storedFileName, sha256: source.originalSha256, bytes: source.originalByteCount }] });
    const backup = { version: '3.0', type: 'full', data, manifest: manifest(data) };
    const resolveFile = vi.fn(async () => bytes);
    await restoreBackupData({ userId: 'validator-other', backup, overwrite: false, resolveFile });
    const imported = await database.client.purchaseValidationReport.findMany({ where: { userId: 'validator-other' } });
    expect(imported).toHaveLength(2); expect(imported.every(item => item.provenance === 'IMPORTED_HISTORIC')).toBe(true);
    const target = await database.client.purchaseDocument.findUniqueOrThrow({ where: { userId_originalSha256: { userId: 'validator-other', originalSha256: source.originalSha256 } } });
    state.userId = 'validator-other';
    try {
      const response = await get(target.id); expect(response.status).toBe(200);
      expect((await response.json()).reports.every((row: { current: boolean }) => row.current === false)).toBe(true);
      expect((await post({ ...payload(), expectedRevision: target.revision }, target.id)).status).toBe(200);
    } finally { state.userId = 'validator-owner'; }
    const targetReports = await database.client.purchaseValidationReport.findMany({ where: { userId: 'validator-other' }, orderBy: { id: 'asc' } });
    expect(targetReports).toHaveLength(3);
    await restoreBackupData({ userId: 'validator-other', backup, overwrite: false, resolveFile });
    await restoreBackupData({ userId: 'validator-other', backup, overwrite: true, resolveFile });
    expect(await database.client.purchaseValidationReport.findMany({ where: { userId: 'validator-other' }, orderBy: { id: 'asc' } })).toEqual(targetReports);
    const after = await readBackupSnapshot('validator-other');
    const conflicting = structuredClone(backup);
    conflicting.data.purchaseValidationReports[0].report.checkerVersion = 'changed-checker';
    conflicting.data.purchaseValidationReports[0].fingerprint = technicalReportFingerprint(conflicting.data.purchaseValidationReports[0].report);
    conflicting.manifest = manifest(conflicting.data);
    await expect(restoreBackupData({ userId: 'validator-other', backup: conflicting, overwrite: true, resolveFile })).rejects.toThrow(/kollidiert/);
    expect((await readBackupSnapshot('validator-other')).data).toEqual(after.data);
    expect(await database.client.purchaseValidationReport.findMany({ where: { userId: 'validator-other' }, orderBy: { id: 'asc' } })).toEqual(targetReports);
    const foreign = structuredClone(backup); foreign.data.purchaseValidationReports[0].originalSha256 = 'b'.repeat(64); foreign.manifest = manifest(foreign.data);
    expect(() => validateBackupForRestore(foreign)).toThrow(/Original/);
    const old = structuredClone(backup); old.manifest.schemaVersion = PRE_PURCHASE_VALIDATION_SCHEMA_VERSION;
    expect(() => validateBackupForRestore(old)).toThrow(/Backupschema/);
    expect(await Promise.all([database.client.expense.count(), database.client.income.count(), database.client.invoice.count(), database.client.cashTransaction.count()])).toEqual([0, 0, 0, 0]);
  }, 40_000);
  it('does not expose even historic reports when the owned original cannot be integrity-verified', async () => {
    const { readPurchaseOriginal } = await import('@/lib/purchase-documents/original');
    const { getTenantUploadPath } = await import('@/lib/upload-path');
    const source = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } });
    const original = await readPurchaseOriginal(source);
    try { await writeFile(getTenantUploadPath(source.userId, source.storedFileName), 'tampered'); expect((await get()).status).toBe(409); }
    finally { await writeFile(getTenantUploadPath(source.userId, source.storedFileName), original); }
  });
});
