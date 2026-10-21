import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, CURRENT_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, backupSchemaSupportsPaymentAdjustments, backupSchemaSupportsProjectServiceTimes } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { createBackupPreview } from '@/lib/backup-preview';
import { restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';
import { durationToQuantity } from '@/lib/service-duration';
import { randomUUID } from 'node:crypto';
import { serviceCaptureFingerprint, type ServiceCaptureSource } from '@/lib/service-capture';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
const sourceUserId = 'project-backup-source';
const fixed = new Date('2026-10-21T12:00:00.000Z');
const pdf = async () => new Uint8Array([37, 80, 68, 70]);
async function owner(suffix: string) {
  const id = `project-backup-${suffix}`;
  await database.client.user.create({ data: { id, email: `${id}@test.invalid`, password: 'fixture' } });
  return id;
}
function pack(data: Record<string, unknown>, source = sourceUserId) {
  return { version: '3.0', type: 'full', exportedAt: fixed.toISOString(), data, manifest: createBackupManifest({ sourceUserId: source, generatedAt: fixed.toISOString(), data }) };
}
async function snapshot(source = sourceUserId) {
  return pack(JSON.parse(JSON.stringify((await readBackupSnapshot(source)).data)), source);
}
function historical(backup: ReturnType<typeof pack>) {
  const old = structuredClone(backup);
  delete old.data.serviceProjects;
  delete old.data.purchaseValidationReports;
  for (const note of old.data.billingNotes as Record<string, unknown>[]) {
    delete note.projectId; delete note.durationMinutes;
    for (const field of ['captureKey', 'captureFingerprint', 'deletedAt']) if (note[field] === null) delete note[field];
  }
  old.manifest = createBackupManifest({ sourceUserId: old.manifest.sourceUserId, generatedAt: fixed.toISOString(), data: old.data });
  old.manifest.schemaVersion = PAYMENT_ADJUSTMENTS_SCHEMA_VERSION;
  old.manifest.modelCoverage = old.manifest.modelCoverage.filter(entry => !['ServiceProject', 'PurchaseValidationReport', 'EmailOutbox', 'EmailOutboxAttempt'].includes(entry.model));
  return old;
}
function capture(note: Record<string, unknown>, key = randomUUID()) {
  note.captureKey = key;
  note.captureFingerprint = serviceCaptureFingerprint(note as unknown as ServiceCaptureSource);
  return key;
}
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await owner('source');
  const customer = await database.client.customer.create({ data: { userId: sourceUserId, name: 'Project backup customer', email: 'customer@example.invalid' } });
  const project = await database.client.serviceProject.create({ data: { userId: sourceUserId, customerId: customer.id, name: 'Historic support', archivedAt: fixed, createdAt: fixed, updatedAt: fixed } });
  const invoice = await database.client.invoice.create({ data: { userId: sourceUserId, customerId: customer.id, fileName: 'time.pdf', storedFileName: 'time.pdf', invoiceNumber: '2026-771', parsedData: { lineItems: [{ description: 'Historic support', quantity: durationToQuantity(1), unit: 'Stunde', unitPrice: 123.45, amount: 2.06 }] }, uploadedAt: fixed } });
  await database.client.billingNote.create({ data: { userId: sourceUserId, customerId: customer.id, projectId: project.id, durationMinutes: 1, quantity: durationToQuantity(1), description: 'One minute', serviceDate: new Date('2026-10-21T00:00:00.000Z'), invoiceId: invoice.id, createdAt: fixed, updatedAt: fixed } });
  await database.client.billingNote.create({ data: { userId: sourceUserId, customerId: customer.id, description: 'Legacy quantity only', quantity: 2.5, serviceDate: new Date('2026-10-20T00:00:00.000Z'), createdAt: fixed, updatedAt: fixed } });
}, 40_000);
afterAll(async () => database?.cleanup());

describe('exact project and manual-duration backup contract', () => {
  it('roundtrips archived projects, integer minutes, unknown legacy duration and invoice price history', async () => {
    const backup = await snapshot();
    expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(backupSchemaSupportsProjectServiceTimes(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(backupSchemaSupportsProjectServiceTimes(PAYMENT_ADJUSTMENTS_SCHEMA_VERSION)).toBe(false);
    expect(backupSchemaSupportsPaymentAdjustments(PAYMENT_ADJUSTMENTS_SCHEMA_VERSION)).toBe(true);
    expect(createBackupPreview(backup).counts).toMatchObject({ serviceProjects: 1, billingNotes: 2 });
    expect(backup.manifest.modelCoverage.find(entry => entry.model === 'ServiceProject')).toMatchObject({ mode: 'included', count: 1 });
    const target = await owner('roundtrip');
    const result = await restoreBackupData({ userId: target, overwrite: true, backup, resolveFile: pdf });
    expect(result.serviceProjects).toEqual({ imported: 1, skipped: 0 });
    const project = await database.client.serviceProject.findFirstOrThrow({ where: { userId: target } });
    expect(project).toMatchObject({ name: 'Historic support', archivedAt: fixed, createdAt: fixed, updatedAt: fixed });
    const notes = await database.client.billingNote.findMany({ where: { userId: target }, orderBy: { id: 'asc' } });
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    expect(notes[0]).toMatchObject({ projectId: project.id, customerId: project.customerId, durationMinutes: 1, quantity: durationToQuantity(1), invoiceId: invoice.id });
    expect(notes[1]).toMatchObject({ projectId: null, durationMinutes: null, quantity: 2.5 });
    expect(invoice.parsedData).toEqual((backup.data.invoices as Record<string, unknown>[])[0].parsedData);
  });

  it('accepts genuine historical v3 and v2 notes without inferring minutes', async () => {
    const old = historical(await snapshot());
    expect(() => validateBackupForRestore(old)).not.toThrow();
    const target = await owner('old');
    await restoreBackupData({ userId: target, overwrite: true, backup: old, resolveFile: pdf });
    expect(await database.client.serviceProject.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.billingNote.findMany({ where: { userId: target } })).toEqual(expect.arrayContaining([expect.objectContaining({ durationMinutes: null, projectId: null, quantity: durationToQuantity(1) })]));
    const legacy = structuredClone(old.data); delete legacy.paymentAdjustments; delete legacy.paymentOperations;
    expect(() => validateBackupForRestore({ version: '2.0', data: legacy })).not.toThrow();
  });

  it('rejects hash-correct old-schema feature injections, absent current fields and unknown future fields', async () => {
    const original = await snapshot();
    for (const field of ['projectId', 'durationMinutes', 'captureKey', 'captureFingerprint', 'deletedAt']) {
      const old = historical(original);
      (old.data.billingNotes as Record<string, unknown>[])[0][field] = null;
      old.manifest = { ...createBackupManifest({ sourceUserId, generatedAt: fixed.toISOString(), data: old.data }), schemaVersion: PAYMENT_ADJUSTMENTS_SCHEMA_VERSION };
      old.manifest.modelCoverage = old.manifest.modelCoverage.filter(entry => !['ServiceProject', 'PurchaseValidationReport', 'EmailOutbox', 'EmailOutboxAttempt'].includes(entry.model));
      expect(() => validateBackupForRestore(old)).toThrow(/Älteres Backupschema/);
      const missing = structuredClone(original); delete (missing.data.billingNotes as Record<string, unknown>[])[0][field];
      expect(() => validateBackupForRestore(pack(missing.data))).toThrow(/explizit nullable/);
    }
    const oldSection = historical(original); oldSection.data.serviceProjects = [];
    expect(() => validateBackupForRestore(oldSection)).toThrow(/Älteres Backupschema/);
    const noSection = structuredClone(original); delete noSection.data.serviceProjects;
    expect(() => validateBackupForRestore(pack(noSection.data))).toThrow(/erforderlichen Abschnitt/);
    for (const key of ['billingNotes', 'serviceProjects']) {
      const future = structuredClone(original); (future.data[key] as Record<string, unknown>[])[0].futureEvidence = null;
      expect(() => validateBackupForRestore(pack(future.data))).toThrow(/Nicht unterstütztes/);
    }
  });

  it('rejects customer/project, tenant and duration/quantity/unit mismatches before overwrite writes', async () => {
    const target = await owner('invalid');
    const keep = await database.client.customer.create({ data: { userId: target, name: 'Keep target history' } });
    const original = await snapshot();
    const mutations: ((data: Record<string, unknown>) => void)[] = [
      data => { (data.billingNotes as Record<string, unknown>[])[0].durationMinutes = 2; },
      data => { (data.billingNotes as Record<string, unknown>[])[0].durationMinutes = 0; },
      data => { (data.billingNotes as Record<string, unknown>[])[0].unit = 'Tag'; },
      data => { (data.billingNotes as Record<string, unknown>[])[0].projectId = 999999; },
      data => { (data.serviceProjects as Record<string, unknown>[])[0].userId = target; },
      data => { (data.billingNotes as Record<string, unknown>[])[0].userId = target; },
      data => { (data.serviceProjects as Record<string, unknown>[])[0].archivedAt = 'not-a-date'; },
      data => { (data.serviceProjects as Record<string, unknown>[])[0].name = ' '; },
      data => {
        (data.customers as Record<string, unknown>[]).push({ id: 99999, name: 'Other customer', createdAt: fixed.toISOString() });
        (data.serviceProjects as Record<string, unknown>[])[0].customerId = 99999;
      },
    ];
    for (const mutate of mutations) {
      const data = structuredClone(original.data); mutate(data);
      await expect(restoreBackupData({ userId: target, overwrite: true, backup: pack(data), resolveFile: pdf })).rejects.toThrow();
      expect(await database.client.customer.findUnique({ where: { id: keep.id } })).toEqual(keep);
      expect(await database.client.serviceProject.count({ where: { userId: target } })).toBe(0);
    }
  });

  it('does not duplicate, re-claim or overwrite project and invoice history on repeated and native merges', async () => {
    const source = await snapshot();
    const target = await owner('merge');
    await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf });
    const project = await database.client.serviceProject.findFirstOrThrow({ where: { userId: target } });
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    const legacyNote = await database.client.billingNote.findFirstOrThrow({ where: { userId: target, durationMinutes: null } });
    await database.client.billingNote.update({ where: { id: legacyNote.id }, data: { invoiceId: invoice.id } });
    await database.client.serviceProject.update({ where: { id: project.id }, data: { name: 'Target name retained', archivedAt: null } });
    const invoiceBefore = await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const repeated = await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf });
    expect(repeated.serviceProjects).toEqual({ imported: 0, skipped: 1 });
    expect(repeated.billingNotes).toEqual({ imported: 0, skipped: 2 });
    expect(await database.client.serviceProject.findUnique({ where: { id: project.id } })).toMatchObject({ name: 'Target name retained', archivedAt: null });
    expect(await database.client.billingNote.findUnique({ where: { id: legacyNote.id } })).toMatchObject({ invoiceId: invoice.id });
    expect(await database.client.invoice.findUnique({ where: { id: invoice.id } })).toEqual(invoiceBefore);
    const native = await snapshot(target);
    const self = await restoreBackupData({ userId: target, overwrite: false, backup: native, resolveFile: pdf });
    expect(self.serviceProjects).toEqual({ imported: 0, skipped: 1 });
    expect(self.billingNotes).toEqual({ imported: 0, skipped: 2 });
    expect(await database.client.billingNote.count({ where: { userId: target } })).toBe(2);
    const forged = structuredClone(native); (forged.data.billingNotes as Record<string, unknown>[])[0].description = 'Forged native identity';
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: pack(forged.data, target), resolveFile: pdf })).rejects.toThrow(/Quellidentität/);
  });

  it('never replays a source claim onto an existing open target note and guards destructive overwrites', async () => {
    const source = await snapshot();
    const target = await owner('open-target');
    await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf });
    const timeNote = await database.client.billingNote.findFirstOrThrow({ where: { userId: target, durationMinutes: 1 } });
    await database.client.billingNote.update({ where: { id: timeNote.id }, data: { invoiceId: null } });
    const beforeConflict = await snapshot(target);
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf })).rejects.toThrow(/Rechnungszuordnung der Quelle/);
    expect((await snapshot(target)).data).toEqual(beforeConflict.data);
    expect(await database.client.billingNote.findUnique({ where: { id: timeNote.id } })).toMatchObject({ invoiceId: null });
    await expect(restoreBackupData({ userId: target, overwrite: true, backup: historical(source), resolveFile: pdf })).rejects.toThrow(/ältere Backup/);
    await database.client.billingNote.update({ where: { id: timeNote.id }, data: { invoiceId: (await database.client.invoice.findFirstOrThrow({ where: { userId: target } })).id } });
    await expect(restoreBackupData({ userId: target, overwrite: true, backup: source, resolveFile: pdf })).rejects.toThrow(/Abgerechnete/);
    expect(await database.client.billingNote.findUnique({ where: { id: timeNote.id } })).toMatchObject({ durationMinutes: 1, invoiceId: expect.any(Number) });
  });

  it.each([
    ['open', 'open', false], ['open', 'same-claim', false], ['open', 'other-claim', false], ['open', 'removed', false],
    ['claimed', 'open', true], ['claimed', 'same-claim', false], ['claimed', 'other-claim', true], ['claimed', 'removed', true],
    ['removed', 'open', true], ['removed', 'same-claim', true], ['removed', 'other-claim', true], ['removed', 'removed', false],
  ] as const)('unions lifecycle safely: source %s, target %s, conflict %s', async (sourceState, targetState, conflict) => {
    const original = await snapshot();
    const note = (original.data.billingNotes as Record<string, unknown>[])[1];
    const key = capture(note);
    const sourceInvoiceId = (original.data.invoices as Record<string, unknown>[])[0].id;
    original.data.billingNotes = [note]; original.data.serviceProjects = [];
    const openData = structuredClone(original.data);
    openData.invoices = [];
    const openBackup = pack(openData);
    const claimedData = structuredClone(original.data);
    (claimedData.billingNotes as Record<string, unknown>[])[0].invoiceId = sourceInvoiceId;
    const claimedBackup = pack(claimedData);
    const target = await owner(`union-${sourceState}-${targetState}`);
    await restoreBackupData({ userId: target, overwrite: false, backup: targetState === 'same-claim' ? claimedBackup : openBackup, resolveFile: pdf });
    const targetNote = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: target, captureKey: key } } });
    if (targetState === 'other-claim') {
      const different = await database.client.invoice.create({ data: {
        userId: target, customerId: targetNote.customerId, fileName: 'independent-target.pdf', storedFileName: 'independent-target.pdf',
        invoiceNumber: `TARGET-${targetNote.id}`, parsedData: {},
      } });
      await database.client.billingNote.update({ where: { id: targetNote.id }, data: { invoiceId: different.id } });
    } else if (targetState === 'removed') {
      await database.client.billingNote.update({ where: { id: targetNote.id }, data: { deletedAt: fixed } });
    }
    const sourceData = sourceState === 'claimed' ? claimedData : structuredClone(openData);
    if (sourceState === 'removed') (sourceData.billingNotes as Record<string, unknown>[])[0].deletedAt = fixed.toISOString();
    const before = await snapshot(target);
    const incoming = pack(sourceData);
    if (conflict) {
      await expect(restoreBackupData({ userId: target, overwrite: false, backup: incoming, resolveFile: pdf })).rejects.toThrow(/Rechnungszuordnung der Quelle|Gelöschter Quell/);
      // This includes invoice metadata and audit rows created before the receipt
      // was encountered: the database import must roll back atomically.
      expect((await snapshot(target)).data).toEqual(before.data);
    } else {
      const result = await restoreBackupData({ userId: target, overwrite: false, backup: incoming, resolveFile: pdf });
      expect(result.billingNotes).toEqual({ imported: 0, skipped: 1 });
      const after = (await snapshot(target)).data;
      // Successful restores append their normal restore audit record; every
      // business row, receipt and invoice must otherwise remain unchanged.
      expect({ ...after, auditLogs: before.data.auditLogs }).toEqual(before.data);
      expect((after.auditLogs as unknown[]).slice(0, -1)).toEqual(before.data.auditLogs);
    }
  });

  it('retains capture UUIDs and rebinds fingerprints to mapped customer/project IDs through snapshots and restores', async () => {
    const original = await snapshot();
    const sourceNotes = original.data.billingNotes as Record<string, unknown>[];
    const key = capture(sourceNotes[0]);
    const sourceHash = sourceNotes[0].captureFingerprint;
    const target = await owner('receipt-roundtrip');
    await restoreBackupData({ userId: target, overwrite: true, backup: pack(original.data), resolveFile: pdf });
    const restored = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: target, captureKey: key } } });
    expect(restored.customerId).not.toBe(sourceNotes[0].customerId);
    expect(restored.projectId).not.toBe(sourceNotes[0].projectId);
    expect(restored.captureFingerprint).not.toBe(sourceHash);
    expect(restored.captureFingerprint).toBe(serviceCaptureFingerprint(restored));
    expect(restored).toMatchObject({ captureKey: key, deletedAt: null, description: sourceNotes[0].description, durationMinutes: 1, invoiceId: expect.any(Number) });
    const exported = await snapshot(target);
    expect((exported.data.billingNotes as Record<string, unknown>[]).find(note => note.captureKey === key)).toMatchObject({ captureKey: key, captureFingerprint: restored.captureFingerprint, deletedAt: null });
    const again = await owner('receipt-roundtrip-again');
    await restoreBackupData({ userId: again, overwrite: true, backup: exported, resolveFile: pdf });
    const rebound = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: again, captureKey: key } } });
    expect(rebound.captureFingerprint).toBe(serviceCaptureFingerprint(rebound));
    expect(rebound.captureFingerprint).not.toBe(restored.captureFingerprint);
  });

  it('rejects forged fingerprints, nullable-pair errors, noncanonical keys and duplicate receipt keys before restore', async () => {
    const original = await snapshot();
    const notes = original.data.billingNotes as Record<string, unknown>[];
    const key = capture(notes[0], 'abcdef01-2345-4678-89ab-cdef01234567');
    const mutations: ((rows: Record<string, unknown>[]) => void)[] = [
      rows => { rows[0].captureFingerprint = null; },
      rows => { rows[0].captureKey = null; },
      rows => { rows[0].captureKey = key.toUpperCase(); },
      rows => { rows[0].captureKey = 'not-a-uuid'; },
      rows => { rows[0].captureFingerprint = 'A'.repeat(64); },
      rows => { rows[0].captureFingerprint = '0'.repeat(64); },
      rows => { rows[0].description = 'Changed source command'; },
      rows => { capture(rows[1], key); },
      rows => { rows[0].deletedAt = fixed.toISOString(); },
      rows => { rows[1].deletedAt = fixed.toISOString(); },
      rows => { rows[0].deletedAt = '2026-10-21'; },
    ];
    for (const mutate of mutations) {
      const data = structuredClone(original.data); mutate(data.billingNotes as Record<string, unknown>[]);
      expect(() => validateBackupForRestore(pack(data))).toThrow();
    }
    expect(() => validateBackupForRestore(historical(pack(original.data)))).toThrow(/Älteres Backupschema/);
  });

  it('keeps later claims on repeated/source-native receipt merges and blocks receipt-erasing overwrites', async () => {
    const original = await snapshot();
    const key = capture((original.data.billingNotes as Record<string, unknown>[])[1]);
    const source = pack(original.data);
    const target = await owner('receipt-merge');
    await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf });
    const restored = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: target, captureKey: key } } });
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    await database.client.billingNote.update({ where: { id: restored.id }, data: { invoiceId: invoice.id } });
    const before = await database.client.billingNote.findUniqueOrThrow({ where: { id: restored.id } });
    expect((await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf })).billingNotes).toEqual({ imported: 0, skipped: 2 });
    expect((await restoreBackupData({ userId: target, overwrite: false, backup: await snapshot(target), resolveFile: pdf })).billingNotes).toEqual({ imported: 0, skipped: 2 });
    const receiptAlias = structuredClone(source.data);
    (receiptAlias.billingNotes as Record<string, unknown>[])[1].id = 123456;
    (receiptAlias.billingNotes as Record<string, unknown>[])[1].createdAt = new Date(fixed.getTime() + 1_000).toISOString();
    // The portable receipt is authoritative even when no row-ID provenance exists.
    expect((await restoreBackupData({ userId: target, overwrite: false, backup: pack(receiptAlias), resolveFile: pdf })).billingNotes).toEqual({ imported: 0, skipped: 2 });
    expect(await database.client.billingNote.findUnique({ where: { id: restored.id } })).toEqual(before);
    await expect(restoreBackupData({ userId: target, overwrite: true, backup: source, resolveFile: pdf })).rejects.toThrow(/Abgerechnete|Erfassungsnachweise/);
  });

  it('rolls back a whole merge on a valid but conflicting capture command, including tombstoned receipts', async () => {
    const original = await snapshot();
    const key = capture((original.data.billingNotes as Record<string, unknown>[])[1]);
    const source = pack(original.data);
    const target = await owner('receipt-collision');
    await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile: pdf });
    const receipt = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: target, captureKey: key } } });
    const forged = structuredClone(source.data);
    const forgedNote = (forged.billingNotes as Record<string, unknown>[])[1];
    forgedNote.id = 99998; // Exercise receipt-key collision without a prior row-ID import.
    forgedNote.description = 'Different command with same key'; capture(forgedNote, key);
    (forged.customers as Record<string, unknown>[]).push({ id: 99999, name: 'Must roll back', createdAt: fixed.toISOString() });
    const before = await snapshot(target);
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: pack(forged), resolveFile: pdf })).rejects.toThrow(/Quellidentität|Kollision/);
    expect((await snapshot(target)).data).toEqual(before.data);
    await database.client.billingNote.update({ where: { id: receipt.id }, data: { deletedAt: fixed } });
    const deletedBefore = await snapshot(target);
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: pack(forged), resolveFile: pdf })).rejects.toThrow(/Quellidentität|Kollision/);
    expect((await snapshot(target)).data).toEqual(deletedBefore.data);
  });

  it('roundtrips tombstones, never resurrects them, and conflicts rather than deleting an active target receipt', async () => {
    const original = await snapshot();
    const sourceNote = (original.data.billingNotes as Record<string, unknown>[])[1];
    const key = capture(sourceNote);
    const activeSource = pack(structuredClone(original.data));
    sourceNote.deletedAt = fixed.toISOString();
    const deletedSource = pack(original.data);
    const target = await owner('receipt-tombstone');
    await restoreBackupData({ userId: target, overwrite: true, backup: deletedSource, resolveFile: pdf });
    const tombstone = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: target, captureKey: key } } });
    expect(tombstone).toMatchObject({ deletedAt: fixed, invoiceId: null, captureFingerprint: serviceCaptureFingerprint(tombstone) });
    const targetSnapshot = await snapshot(target);
    expect((targetSnapshot.data.billingNotes as Record<string, unknown>[]).find(note => note.captureKey === key)).toMatchObject({ deletedAt: fixed.toISOString() });
    for (const backup of [activeSource, deletedSource, targetSnapshot]) {
      expect((await restoreBackupData({ userId: target, overwrite: false, backup, resolveFile: pdf })).billingNotes).toEqual({ imported: 0, skipped: 2 });
      expect(await database.client.billingNote.findUnique({ where: { id: tombstone.id } })).toEqual(tombstone);
    }
    await expect(restoreBackupData({ userId: target, overwrite: true, backup: activeSource, resolveFile: pdf })).rejects.toThrow(/Abgerechnete|Erfassungsnachweise/);
    const activeTarget = await owner('receipt-active-conflict');
    await restoreBackupData({ userId: activeTarget, overwrite: false, backup: activeSource, resolveFile: pdf });
    const activeBefore = await snapshot(activeTarget);
    await expect(restoreBackupData({ userId: activeTarget, overwrite: false, backup: deletedSource, resolveFile: pdf })).rejects.toThrow(/Gelöschter Quell/);
    expect((await snapshot(activeTarget)).data).toEqual(activeBefore.data);
  });

  it('blocks overwriting even an open or deleted unclaimed receipt without unrelated claimed history', async () => {
    const original = await snapshot();
    const note = (original.data.billingNotes as Record<string, unknown>[])[1];
    const key = capture(note);
    original.data.billingNotes = [note]; original.data.serviceProjects = []; original.data.invoices = [];
    const source = pack(original.data);
    const target = await owner('receipt-overwrite');
    await restoreBackupData({ userId: target, overwrite: true, backup: source });
    const receipt = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: target, captureKey: key } } });
    for (const deletedAt of [null, fixed]) {
      if (deletedAt !== null) await database.client.billingNote.update({ where: { id: receipt.id }, data: { deletedAt } });
      const before = await snapshot(target);
      await expect(restoreBackupData({ userId: target, overwrite: true, backup: source })).rejects.toThrow(/Erfassungsnachweise/);
      expect((await snapshot(target)).data).toEqual(before.data);
    }
    const again = await owner('receipt-tombstone-again');
    await restoreBackupData({ userId: again, overwrite: true, backup: await snapshot(target) });
    const rebound = await database.client.billingNote.findUniqueOrThrow({ where: { userId_captureKey: { userId: again, captureKey: key } } });
    expect(rebound).toMatchObject({ deletedAt: fixed, invoiceId: null, captureFingerprint: serviceCaptureFingerprint(rebound) });
  });

  it('rejects an existing receipt whose stored hash does not describe its actual target command', async () => {
    const original = await snapshot();
    const sourceNote = (original.data.billingNotes as Record<string, unknown>[])[1];
    const key = capture(sourceNote);
    original.data.billingNotes = [sourceNote]; original.data.serviceProjects = []; original.data.invoices = [];
    const target = await owner('receipt-invalid-target-hash');
    const sourceCustomer = (original.data.customers as Record<string, unknown>[])[0];
    const customer = await database.client.customer.create({ data: { userId: target, name: String(sourceCustomer.name), email: String(sourceCustomer.email) } });
    const stored = await database.client.billingNote.create({ data: {
      userId: target, customerId: customer.id, projectId: null, durationMinutes: null,
      serviceDate: new Date(String(sourceNote.serviceDate)), description: String(sourceNote.description),
      quantity: Number(sourceNote.quantity), unit: String(sourceNote.unit),
      captureKey: key, captureFingerprint: '0'.repeat(64),
    } });
    expect(stored.captureFingerprint).not.toBe(serviceCaptureFingerprint(stored));
    const before = await snapshot(target);
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: pack(original.data) })).rejects.toThrow(/Erfassungsnachweis-Kollision/);
    expect((await snapshot(target)).data).toEqual(before.data);
  });
});
