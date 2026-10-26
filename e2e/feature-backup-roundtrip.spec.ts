import { expect, test, type Page } from '@playwright/test';
import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { BackupManifest } from '../lib/backup-manifest';
import { createBankMappingProfileConfiguration } from '../lib/bank-mapping-profile-contract';
import type { PortableBankMappingProfile, PortableBankMappingProfileRevision } from '../lib/bank-mapping-profile-backup';
import { inferBankCsvMapping, parseBankCsv } from '../lib/bank-csv';
import type { NumberingPolicyBackup, QuoteCreateReceiptBackup } from '../lib/document-numbering-policy-backup';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

type FeatureData = Record<string, unknown> & {
  bankMappingProfiles: PortableBankMappingProfile[];
  bankMappingProfileRevisions: PortableBankMappingProfileRevision[];
  documentNumberingPolicies: NumberingPolicyBackup[];
  quoteCreateReceipts: QuoteCreateReceiptBackup[];
  quoteReleaseAuthorities: unknown[];
  quoteReleases: unknown[];
  quoteElectronicResponses: unknown[];
  manualFinancialRecordEvents: unknown[];
  incomes: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
};
type Backup = { version: string; exportedAt: string; manifest: BackupManifest; data: FeatureData };

// Hosted CI only: no route mocks or service calls replace either HTTP boundary.
// Direct Prisma access is limited to synthetic fixture setup and independent assertions.
async function account(page: Page, label: string) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticBackupRoundtrip123!';
  const user = await prisma.user.create({ data: { email: `feature-backup-${label}-${randomUUID()}@example.test`, name: `Synthetic backup ${label}`, password: await hashPassword(password), role: 'USER' } });
  const loginSession = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/login');
  await page.goto('/login');
  const anonymous = await loginSession;
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.finished()).toBeNull();
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/dashboard');
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  const response = await session;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await expect(page).toHaveURL(/\/dashboard/);
  return user;
}

function restore(page: Page, backup: unknown) {
  return page.request.post('/api/backup/restore', { data: backup, headers: { Origin: new URL(page.url()).origin, 'Sec-Fetch-Site': 'same-origin' } });
}

async function state(userId: string) {
  return prisma.$transaction([
    prisma.bankMappingProfile.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.bankMappingProfileRevision.findMany({ where: { userId }, orderBy: [{ profileId: 'asc' }, { revision: 'asc' }] }),
    prisma.documentNumberingPolicy.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { revision: 'asc' }] }),
    prisma.quoteCreateReceipt.findMany({ where: { userId }, orderBy: { requestId: 'asc' } }),
    prisma.invoiceNumberCounter.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.customer.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.expense.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.auditLog.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.manualFinancialRecordEvent.findMany({ where: { userId }, orderBy: [{ recordId: 'asc' }, { sequence: 'asc' }] }),
  ]);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}
function reseal(backup: Backup) {
  // Match lib/backup-manifest.ts canonicalize/coverageCount/coverageHash and
  // createBackupManifest exactly, without importing its server-only validators
  // into the Playwright runner. Keep the REAL export's closed capability,
  // coverage registry, secret exclusions and file metadata; only renew hashes.
  // Never insert missing sections/row metadata or promote a historical identity:
  // malformed current/history payloads below must reach the REAL strict server.
  const manifest = backup.manifest, auditLogs = backup.data.auditLogs ?? [], counters = backup.data.invoiceNumberCounters ?? [];
  manifest.modelCoverage = manifest.modelCoverage.map(entry => {
    const value = backup.data[entry.key];
    const updated = { ...entry, count: Array.isArray(value) ? value.length : value && typeof value === 'object' ? 1 : 0 };
    delete updated.sha256;
    if (entry.mode !== 'excluded' && value !== undefined && value !== null) updated.sha256 = hashJson(value);
    return updated;
  });
  manifest.backupId = hashJson({ sourceUserId: manifest.sourceUserId, generatedAt: backup.exportedAt, auditLogs, counters, ...(manifest.snapshot ? { snapshotId: manifest.snapshot.id } : {}) });
  manifest.auditSegment = { ...manifest.auditSegment, count: Array.isArray(auditLogs) ? auditLogs.length : 0, sha256: hashJson(auditLogs) };
  manifest.invoiceNumberCounters = { ...manifest.invoiceNumberCounters, count: Array.isArray(counters) ? counters.length : 0, sha256: hashJson(counters) };
  return backup;
}

test.afterAll(async () => { await prisma.$disconnect(); });

test('real backup endpoints remap feature histories, preserve legacy high-water marks and reject conflicts atomically', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const source = await account(page, 'source');
  const at = new Date('2026-10-24T09:00:00.000Z');
  const profileId = randomUUID(), mutationId = randomUUID(), requestId = randomUUID();
  const hiddenCell = 'SYNTHETIC-PRIVATE-ROW-NOT-A-PROFILE';
  const parsed = parseBankCsv(`Datum;Betrag;Währung;Verwendungszweck\n24.10.2026;1,00;EUR;${hiddenCell}`);
  const configuration = await createBankMappingProfileConfiguration('SYNTHETISCHES Backup-Profil', { ...inferBankCsvMapping(parsed.headers), accountAlias: 'SYNTHETISCHES Konto' }, parsed);
  await prisma.$transaction([
    prisma.bankMappingProfile.create({ data: { userId: source.id, id: profileId, revision: 1, createdAt: at, updatedAt: at } }),
    prisma.bankMappingProfileRevision.create({ data: { userId: source.id, profileId, revision: 1, mutationId, configuration: configuration as unknown as Prisma.InputJsonValue, createdAt: at } }),
    prisma.documentNumberingPolicy.create({ data: { userId: source.id, type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'BKP-', includeYear: false, sequenceWidth: 4, startSequence: 20, effectiveYear: 2026, createdAt: at } }),
    prisma.quoteCreateReceipt.create({ data: { userId: source.id, requestId, fingerprint: '1'.repeat(64), pdfSha256: '2'.repeat(64), createdAt: at } }),
  ]);

  const exported = await page.request.get('/api/backup');
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-disposition']).toContain('attachment;');
  const backup = await exported.json() as Backup;
  expect(backup.version).toBe('3.0');
  expect(backup.manifest.schemaVersion).toBe('20261026093000_add_quote_release_backup_identity');
  // This fresh owner has no release history, but the current identity must
  // export all three capability sections and their integrity-covered entries.
  for (const [key, model] of [
    ['quoteReleaseAuthorities', 'QuoteReleaseAuthority'],
    ['quoteReleases', 'QuoteRelease'],
    ['quoteElectronicResponses', 'QuoteElectronicResponse'],
  ] as const) {
    expect(backup.data[key]).toEqual([]);
    expect(backup.manifest.modelCoverage.filter(entry => entry.key === key)).toEqual([
      expect.objectContaining({ model, mode: 'included', count: 0, sha256: hashJson([]) }),
    ]);
  }
  // Prove the independent pure calculation matches this actual server export
  // before using it to reach immutable-history conflicts with changed data.
  expect(reseal(structuredClone(backup)).manifest).toStrictEqual(backup.manifest);
  expect(backup.data.manualFinancialRecordEvents).toEqual([]);
  expect(backup.data.incomes).toEqual([]); expect(backup.data.expenses).toEqual([]);
  expect(backup.manifest.modelCoverage.find(entry => entry.key === 'manualFinancialRecordEvents')).toMatchObject({ model: 'ManualFinancialRecordEvent', mode: 'included', count: 0, sha256: hashJson([]) });
  for (const key of ['incomes', 'expenses'] as const) expect(backup.manifest.modelCoverage.find(entry => entry.key === key)).toMatchObject({ mode: 'included', count: 0, sha256: hashJson(backup.data[key]) });
  expect(backup.manifest.sourceUserId).toBe(source.id);
  expect(backup.data.bankMappingProfiles).toHaveLength(1);
  expect(backup.data.bankMappingProfileRevisions).toHaveLength(1);
  expect(backup.data.bankMappingProfileRevisions[0].configuration).toEqual(configuration);
  expect(backup.data.documentNumberingPolicies).toHaveLength(1);
  expect(backup.data.quoteCreateReceipts).toEqual([{ requestId, fingerprint: '1'.repeat(64), pdfSha256: '2'.repeat(64), invoiceId: null, createdAt: at.toISOString() }]);
  expect(JSON.stringify(backup)).not.toContain(hiddenCell);
  for (const key of ['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies', 'quoteCreateReceipts'] as const) {
    for (const row of backup.data[key]) expect(row).not.toHaveProperty('userId');
    expect(backup.manifest.modelCoverage.find(entry => entry.key === key)).toMatchObject({ mode: 'included', count: 1 });
  }

  const targetContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const targetPage = await targetContext.newPage();
    const target = await account(targetPage, 'target');
    const sourceBefore = await state(source.id);
    const first = await restore(targetPage, backup);
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.success).toBe(true);
    for (const key of ['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies', 'quoteCreateReceipts']) expect(firstBody.results[key]).toEqual({ imported: 1, skipped: 0 });
    expect(await prisma.bankMappingProfile.count({ where: { id: profileId, userId: { in: [source.id, target.id] } } })).toBe(2);
    expect(await prisma.bankMappingProfileRevision.findUniqueOrThrow({ where: { userId_profileId_revision: { userId: target.id, profileId, revision: 1 } } })).toMatchObject({ userId: target.id, mutationId, configuration });
    expect(await prisma.documentNumberingPolicy.findUniqueOrThrow({ where: { userId_type_revision: { userId: target.id, type: 'INVOICE', revision: 1 } } })).toMatchObject({ userId: target.id, prefix: 'BKP-', includeYear: false });
    expect(await prisma.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: target.id, requestId } } })).toMatchObject({ userId: target.id, invoiceUserId: null, invoiceId: null, pdfSha256: '2'.repeat(64) });

    const repeated = await restore(targetPage, backup);
    expect(repeated.status(), await repeated.text()).toBe(200);
    const repeatBody = await repeated.json();
    for (const key of ['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies', 'quoteCreateReceipts']) expect(repeatBody.results[key]).toEqual({ imported: 0, skipped: 1 });

    await prisma.invoiceNumberCounter.upsert({ where: { userId_type_year: { userId: target.id, type: 'INVOICE', year: 2026 } }, create: { userId: target.id, type: 'INVOICE', year: 2026, value: 50 }, update: { value: 50 } });
    const historiesBeforeLegacy = (await state(target.id)).slice(0, 4);
    const legacy = await restore(targetPage, { version: '2.0', data: {}, confirmOverwrite: true });
    expect(legacy.status(), await legacy.text()).toBe(200);
    expect((await legacy.json()).results.warnings).toEqual(expect.arrayContaining([expect.stringContaining('2.0')]));
    expect((await state(target.id)).slice(0, 4)).toEqual(historiesBeforeLegacy);
    const preview = await targetPage.request.get('/api/invoices/next-number?year=2027');
    expect(preview.status()).toBe(200);
    expect(await preview.json()).toMatchObject({ nextInvoiceNumber: 'BKP-0051', numberingSelection: { version: 1, type: 'INVOICE', revision: 1, year: 2027, number: 'BKP-0051', automatic: true } });
    expect(await prisma.invoiceNumberCounter.findUniqueOrThrow({ where: { userId_type_year: { userId: target.id, type: 'INVOICE', year: 2026 } } })).toHaveProperty('value', 50);
    expect(await prisma.invoiceNumberCounter.count({ where: { userId: target.id, year: 2027 } })).toBe(0);

    const divergentProfile = structuredClone(backup);
    divergentProfile.data.bankMappingProfileRevisions[0].configuration.name = 'SYNTHETISCH veränderte unveränderliche Revision';
    const divergentPolicy = structuredClone(backup);
    divergentPolicy.data.documentNumberingPolicies[0].prefix = 'OTHER-';
    // This valid new profile would be inserted before the later policy conflict;
    // equality below therefore also proves rollback across feature collections.
    const extraId = randomUUID();
    divergentPolicy.data.bankMappingProfiles.push({ ...backup.data.bankMappingProfiles[0], id: extraId });
    divergentPolicy.data.bankMappingProfileRevisions.push({ ...structuredClone(backup.data.bankMappingProfileRevisions[0]), profileId: extraId, mutationId: randomUUID() });
    const divergentFingerprint = structuredClone(backup);
    divergentFingerprint.data.quoteCreateReceipts[0].fingerprint = 'f'.repeat(64);
    const divergentOriginalHash = structuredClone(backup);
    divergentOriginalHash.data.quoteCreateReceipts[0].pdfSha256 = 'e'.repeat(64);
    for (const [label, changed, message] of [
      ['profile', divergentProfile, /unveränderliche Profilrevision/u],
      ['policy', divergentPolicy, /Nummernformat-Revision weicht/u],
      ['receipt fingerprint', divergentFingerprint, /Angebotsanfrage-Nachweis weicht/u],
      ['receipt original hash', divergentOriginalHash, /Angebotsanfrage-Nachweis weicht/u],
    ] as const) {
      const before = await state(target.id);
      const rejected = await restore(targetPage, { ...reseal(changed), confirmOverwrite: true });
      expect(rejected.status(), `${label}: ${await rejected.text()}`).toBe(400);
      expect((await rejected.json()).error).toMatch(message);
      expect(await state(target.id), `${label} must leave every observed target row unchanged`).toEqual(before);
      expect(await state(source.id), `${label} must never mutate the source owner`).toEqual(sourceBefore);
    }
    // Resealing recalculates integrity hashes; it must never repair a missing
    // current capability section/row identity or grant it to the old supplier schema.
    const missingHistory = structuredClone(backup); delete (missingHistory.data as Record<string, unknown>).manualFinancialRecordEvents;
    const missingMetadata = structuredClone(backup);
    missingMetadata.data.incomes.push({ id: 991, description: 'SYNTHETIC missing lifecycle identity', amount: 1, date: at.toISOString(), taxRelevant: true, customerId: null, invoiceId: null });
    const historicalIdentity = structuredClone(backup); historicalIdentity.manifest.schemaVersion = '20261024040000_add_supplier_tasks';
    for (const [label, changed, message] of [
      ['missing manual history', missingHistory, /Vollständiger Verlauf fehlt/u],
      ['missing manual row identity', missingMetadata, /Lifecycle-Metadaten/u],
      ['future manual section under historical supplier identity', historicalIdentity, /Ältere Schemaidentitäten/u],
    ] as const) {
      const before = await state(target.id), rejected = await restore(targetPage, { ...reseal(changed), confirmOverwrite: true });
      expect(rejected.status(), `${label}: ${await rejected.text()}`).toBe(400);
      expect((await rejected.json()).error).toMatch(message);
      expect(await state(target.id), `${label} must not mutate target finance or history`).toEqual(before);
      expect(await state(source.id), `${label} must not mutate source finance or history`).toEqual(sourceBefore);
    }
    for (const userId of [source.id, target.id]) {
      for (const count of await Promise.all([prisma.invoice.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.expense.count({ where: { userId } }), prisma.paymentJournalEvent.count({ where: { userId } }), prisma.emailOutbox.count({ where: { userId } }), prisma.bankImportBatch.count({ where: { userId } }), prisma.manualFinancialRecordEvent.count({ where: { userId } })])) expect(count).toBe(0);
    }
  } finally { await targetContext.close(); }
});
