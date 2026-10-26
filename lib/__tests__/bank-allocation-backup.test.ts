import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION } from '@/lib/bank-import-contract';
import { bankImportEvidenceHash, bankImportRowKeys, bankImportTotals, prepareBankImport } from '@/lib/bank-import-evidence';
import { bankAllocationsFromBackup, portableBankAllocations, validateBankAllocationGraph } from '@/lib/bank-allocation-backup';
import { allocationBasisSnapshot, allocationChangeBasisSnapshot, bankBindingBasisSnapshot } from '@/lib/payment-journal/allocation-evidence';
import { adjustmentBasisSnapshot, adjustmentFingerprint, evidenceDate, financialHash } from '@/lib/payment-journal/adjustment-evidence';
import { createBackupManifest, BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION, PAYMENT_BANK_IMPORT_SCHEMA_VERSION, BACKUP_FEATURE_CAPABILITIES, backupSchemaSupportsBankPaymentAllocations } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
const source = 'allocation-backup-source', date = '2026-10-20T00:00:00.000Z', recorded = '2026-10-22T12:00:00.000Z';
const token = 'a'.repeat(64);
function fixture(kind: 'move' | 'refund' | 'correction' = 'move', amount = 40): Row {
  const csv = `Datum;Betrag;Währung;Verwendungszweck\n20.10.2026;${amount},00;EUR;synthetisch`;
  const mapping = { ...inferBankCsvMapping(parseBankCsv(csv).headers), accountAlias: 'Synthetisches Konto' };
  const requestId = randomUUID(), batchKey = randomUUID(), rowKey = randomUUID(), bindingKey = randomUUID(), changeKey = randomUUID();
  const prepared = prepareBankImport({ requestId, originalBase64: Buffer.from(csv).toString('base64'), delimiter: ';', mapping, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION });
  const bankRow = { stableKey: rowKey, batchStableKey: batchKey, sourceRow: prepared.rows[0].rowNumber, evidence: prepared.rows[0], ...bankImportRowKeys(mapping.accountAlias, prepared.rows[0]) };
  const receipt = { version: 1, id: batchKey, requestId, savedAt: recorded, accountAlias: mapping.accountAlias, sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes,
    parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, ...bankImportTotals(prepared.rows), evidenceSha256: bankImportEvidenceHash([bankRow]), sameFilePreviouslySaved: false };
  const batch = { stableKey: batchKey, requestId, fingerprint: prepared.fingerprint, sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, parserVersion: BANK_IMPORT_PARSER_VERSION,
    mappingVersion: BANK_IMPORT_MAPPING_VERSION, accountAlias: mapping.accountAlias, delimiter: ';', mapping, receipt, createdAt: recorded };
  const invoice = (id: number, number: string): Row => ({ id, userId: source, customerId: 5, type: 'INVOICE', invoiceNumber: number, fileName: `${number}.pdf`, storedFileName: `${number}.pdf`,
    totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', paidAt: null, invoiceDate: date, dueDate: date, parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, netAmount: 120, grossAmount: 120, totalAmount: 120,
      items: [{ description: 'Synthetic complete zero-VAT source line', quantity: 1, unitPrice: 120, amount: 120, taxRate: 0, taxCategory: 'E' }],
      paymentTermSelection: { version: 1, source: 'MANUAL', days: null, invoiceDate: '2026-10-20', dueDate: '2026-10-20', customerId: 5 } } });
  const a = invoice(10, '2026-A'), b = invoice(11, '2026-B');
  if (amount === 120) { b.status = 'PAID'; b.paidAt = date; }
  if (kind === 'refund') b.status = 'CANCELLED';
  const root = { bankPaymentBindingStableKey: bindingKey, id: 30, invoiceId: 10, incomeId: 20, amountCents: String(amount * 100), currency: 'EUR', paidAt: date, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: `bank-row:${rowKey}`, idempotencyKey: 'root-once', createdAt: recorded };
  const bindingBasis = bankBindingBasisSnapshot(bankRow, a, { idempotencyKey: root.idempotencyKey, expectedLedgerVersion: token });
  const binding = { stableKey: bindingKey, rowStableKey: rowKey, originalPaymentKey: root.idempotencyKey, idempotencyKey: root.idempotencyKey,
    semanticFingerprint: financialHash(bindingBasis), basisSnapshot: bindingBasis, contractVersion: 1, createdAt: recorded };
  const changeBasis = allocationChangeBasisSnapshot(binding, root, a, b, null, { expectedAllocationRevision: 0, expectedSourceLedgerVersion: token, expectedTargetLedgerVersion: token, actionDate: '2026-10-21', reason: 'Falsche Rechnung korrigiert' });
  const change = { stableKey: changeKey, bindingStableKey: bindingKey, revision: 1, previousChangeStableKey: null, fromInvoiceId: 10, toInvoiceId: 11, amountCents: String(amount * 100), currency: 'EUR', actionDate: '2026-10-21T00:00:00.000Z', reason: 'Falsche Rechnung korrigiert', idempotencyKey: 'move-once', semanticFingerprint: financialHash(changeBasis), basisSnapshot: changeBasis, contractVersion: 1, recordedAt: recorded };
  const data: Row = { user: { id: source }, customers: [{ id: 5, name: 'Synthetic allocation customer', createdAt: date }], invoices: [a,b], incomes: [{ id: 20, manualRecordId: '54000000-0000-4000-8000-000000000020', manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: 'PAYMENT_JOURNAL', manualRecordRevision: 0, invoiceId: 10, customerId: 5, description: 'Ein echter Originaleingang', amount, date, taxRelevant: true }],
    manualFinancialRecordEvents: [],
    paymentJournalEvents: [root], paymentAdjustments: [], paymentOperations: [{ id: 40, idempotencyKey: 'root-once', kind: 'PAYMENT_RECEIVED', createdAt: recorded }, { id: 41, idempotencyKey: 'move-once', kind: 'PAYMENT_ALLOCATION_CHANGED', createdAt: recorded }],
    bankImportBatches: [batch], bankImportRows: [bankRow], bankPaymentBindings: [binding], paymentAllocationChanges: [change],
    bankMappingProfiles: [], bankMappingProfileRevisions: [], documentNumberingPolicies: [], quoteCreateReceipts: [],
    auditLogs: [], invoiceNumberCounters: [], suppliers: [], expenses: [], purchaseDocuments: [], purchaseValidationReports: [], serviceProjects: [], serviceArticles: [], serviceBillingPlans: [], serviceBillingPeriods: [] };
  if (kind !== 'move') {
    const basis: Row | null = kind === 'refund' ? { id: 12, userId: source, customerId: 5, type: 'CREDIT_NOTE', invoiceNumber: '2026-S', originalInvoiceId: 11, totalAmount: -120, status: 'SENT', issuanceState: 'ISSUED',
      invoiceDate: '2026-10-21T00:00:00.000Z', cancellationReason: 'Vollständig storniert', fileName: 'cancel.pdf', storedFileName: 'cancel.pdf', parsedData: { currency: 'EUR' } } : null;
    if (basis) (data.invoices as Row[]).push(basis);
    const allocationProof = allocationBasisSnapshot(binding, bankRow, root, a, b, change);
    const adjustment: Row = { id: 50, invoiceId: 11, originalPaymentId: 30, kind: kind === 'refund' ? 'CUSTOMER_REFUND' : 'PAYMENT_CORRECTION', amountCents: kind === 'refund' ? '1000' : '2000', currency: 'EUR',
      actionDate: '2026-10-22T00:00:00.000Z', accountingEffectiveOn: kind === 'refund' ? '2026-10-22T00:00:00.000Z' : date, reason: kind === 'refund' ? 'Tatsächliche Auszahlung' : 'Nachweislich nie eingegangen', reference: 'unique-evidence', payoutEvidenceIdentity: kind === 'refund' ? 'unique-evidence' : null,
      cancellationInvoiceId: basis?.id ?? null, basisSnapshot: basis ? adjustmentBasisSnapshot(b, basis) : null, idempotencyKey: 'adjust-once', contractVersion: 3, allocationBindingStableKey: bindingKey, allocationRevision: 1, allocationChangeStableKey: changeKey, allocationBasisSnapshot: allocationProof, recordedAt: recorded };
    adjustment.semanticFingerprint = adjustmentFingerprint(adjustment, root, adjustment.basisSnapshot);
    (data.paymentAdjustments as Row[]).push(adjustment);
    (data.paymentOperations as Row[]).push({ id: 42, idempotencyKey: adjustment.idempotencyKey, kind: adjustment.kind, createdAt: recorded });
    (data.auditLogs as Row[]).push({ id: 60, userId: source, action: adjustment.kind, entityType: 'Invoice', entityId: '11', createdAt: recorded,
      newValues: JSON.stringify({ paymentAdjustmentId: 50, originalPaymentId: 30, kind: adjustment.kind, amountCents: adjustment.amountCents }), metadata: JSON.stringify({ actorId: source, tenantId: source, operation: 'payment-adjustment.record', originalReference: 'synthetic', reason: 'Synthetic evidence' }) });
  }
  return data;
}
function appendLegacyRoot(data: Row, invoiceId: number, customerId: number, invoiceNumber = '2026-X') {
  if (!(data.invoices as Row[]).some(invoice => invoice.id === invoiceId)) {
    (data.invoices as Row[]).push({ ...(data.invoices as Row[])[0], id: invoiceId, customerId, invoiceNumber, fileName: 'legacy.pdf', storedFileName: 'legacy.pdf',
      status: 'PAID', paidAt: null, parsedData: { currency: 'EUR' } });
    (data.customers as Row[]).push({ id: customerId, name: 'Synthetic unrelated legacy customer X', createdAt: date });
  }
  (data.paymentJournalEvents as Row[]).push({ id: 31, invoiceId, incomeId: null, amountCents: '12000', currency: 'EUR', paidAt: null, dateCertainty: 'UNKNOWN',
    source: 'LEGACY_IMPORT', reference: 'Unveränderter historisch unklarer Zahlungsnachweis', idempotencyKey: 'legacy-root-x', createdAt: recorded, bankPaymentBindingStableKey: null });
  (data.paymentOperations as Row[]).push({ id: 45, idempotencyKey: 'legacy-root-x', kind: 'PAYMENT_RECEIVED', createdAt: recorded });
}
function pack(data: Row, sourceUserId = source) { return { version: '3.0', type: 'full', exportedAt: recorded, data, manifest: createBackupManifest({ sourceUserId, generatedAt: recorded, data }) }; }

describe('allocation backup portable complete graph', () => {
  it('adds one exact capability and requires both new arrays, without granting historical600 new semantics', () => {
    expect(BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION).toBe('20261023010000_add_bank_payment_allocations');
    expect(backupSchemaSupportsBankPaymentAllocations(PAYMENT_BANK_IMPORT_SCHEMA_VERSION)).toBe(false);
    expect(BACKUP_FEATURE_CAPABILITIES[PAYMENT_BANK_IMPORT_SCHEMA_VERSION]).not.toHaveProperty('bankPaymentAllocations');
    expect(() => bankAllocationsFromBackup({}, CURRENT_SCHEMA_VERSION)).toThrow(/Abschnitt/);
    expect(bankAllocationsFromBackup({ bankPaymentBindings: [], paymentAllocationChanges: [] }, CURRENT_SCHEMA_VERSION)).toEqual({ bindings: [], changes: [] });
    expect(() => bankAllocationsFromBackup({ bankPaymentBindings: [] }, PAYMENT_BANK_IMPORT_SCHEMA_VERSION)).toThrow(/Älteres/);
  });
  it('uses explicit root binding identity, never user-entered reference text, and detects omitted bindings', () => {
    const legacyText = fixture(); legacyText.bankPaymentBindings = []; legacyText.paymentAllocationChanges = [];
    (legacyText.paymentOperations as Row[]).splice(1); const root = (legacyText.paymentJournalEvents as Row[])[0]; root.bankPaymentBindingStableKey = null;
    expect(String(root.reference)).toMatch(/^bank-row:/);
    expect(() => validateBankAllocationGraph(legacyText, CURRENT_SCHEMA_VERSION)).not.toThrow();
    const omitted = fixture(); omitted.bankPaymentBindings = []; omitted.paymentAllocationChanges = [];
    expect(() => validateBankAllocationGraph(omitted, CURRENT_SCHEMA_VERSION)).toThrow(/widersprechen/);
    const missing = fixture(); delete (missing.paymentJournalEvents as Row[])[0].bankPaymentBindingStableKey;
    expect(() => validateBankAllocationGraph(missing, CURRENT_SCHEMA_VERSION)).toThrow(/fehlt/);
  });
  it('keeps40 cash once while moving A120 to B120 and supports current cancellation/real refund and truthful correction', () => {
    for (const kind of ['move','refund','correction'] as const) {
      const graph = validateBankAllocationGraph(fixture(kind), CURRENT_SCHEMA_VERSION);
      expect(graph.projections.get(10)?.ledger.originCash.originalReceivedCents).toBe('4000');
      expect(graph.projections.get(10)?.ledger.collectibleOpenCents).toBe('12000');
      expect(graph.projections.get(11)?.ledger.allocation.validAllocatedCents).toBe(kind === 'correction' ? '2000' : '4000');
      expect(graph.projections.get(11)?.ledger.refundDueCents).toBe(kind === 'refund' ? '3000' : '0');
      expect(graph.projections.get(11)?.ledger.originCash.originalReceivedCents).toBe('0');
    }
  });
  it('validates revision0 frozen proof without inventing a change or moving the origin receipt', () => {
    const data = fixture('correction'), root = (data.paymentJournalEvents as Row[])[0], binding = (data.bankPaymentBindings as Row[])[0];
    data.paymentAllocationChanges = []; data.paymentOperations = (data.paymentOperations as Row[]).filter(row => row.kind !== 'PAYMENT_ALLOCATION_CHANGED');
    const adjustment = (data.paymentAdjustments as Row[])[0], origin = (data.invoices as Row[])[0];
    Object.assign(adjustment, { invoiceId: origin.id, allocationRevision: 0, allocationChangeStableKey: null,
      allocationBasisSnapshot: allocationBasisSnapshot(binding, (data.bankImportRows as Row[])[0], root, origin, origin, null) });
    adjustment.semanticFingerprint = adjustmentFingerprint(adjustment, root, null);
    const graph = validateBankAllocationGraph(data, CURRENT_SCHEMA_VERSION);
    expect(graph.projections.get(10)?.ledger.allocation.validAllocatedCents).toBe('2000');
    expect(graph.proofByRoot.get(30)?.changeId).toBeNull();
  });
  it('excludes unrelated tenant legacy roots but preserves legacy rejection for historical chain touches', () => {
    const unrelated = fixture(); appendLegacyRoot(unrelated, 13, 6);
    const projected = validateBankAllocationGraph(unrelated, CURRENT_SCHEMA_VERSION);
    expect(projected.projections.get(10)?.ledger.collectibleOpenCents).toBe('12000');
    expect(projected.projections.get(11)?.ledger.allocation.validAllocatedCents).toBe('4000');
    const touched = fixture(), [a,b] = touched.invoices as Row[], binding = (touched.bankPaymentBindings as Row[])[0], root = (touched.paymentJournalEvents as Row[])[0], head = (touched.paymentAllocationChanges as Row[])[0];
    const basisSnapshot = allocationChangeBasisSnapshot(binding, root, b, a, head, { expectedAllocationRevision: 1, expectedSourceLedgerVersion: token, expectedTargetLedgerVersion: token, actionDate: '2026-10-22', reason: 'Historische Zwischenrechnung bleibt Teil des Graphen' });
    (touched.paymentAllocationChanges as Row[]).push({ ...head, stableKey: randomUUID(), revision: 2, previousChangeStableKey: head.stableKey, fromInvoiceId: 11, toInvoiceId: 10,
      actionDate: '2026-10-22T00:00:00.000Z', reason: 'Historische Zwischenrechnung bleibt Teil des Graphen', idempotencyKey: 'move-return', basisSnapshot, semanticFingerprint: financialHash(basisSnapshot) });
    (touched.paymentOperations as Row[]).push({ id: 44, idempotencyKey: 'move-return', kind: 'PAYMENT_ALLOCATION_CHANGED', createdAt: recorded });
    appendLegacyRoot(touched, 11, 5); b.status = 'PAID'; b.paidAt = null;
    expect(() => validateBankAllocationGraph(touched, CURRENT_SCHEMA_VERSION)).toThrow(/Legacy/);
  });
  it('permits origin cash above face only after movement and enforces root-wide exact adjustment capacity', () => {
    const data = fixture();
    const root = { ...(data.paymentJournalEvents as Row[])[0], id: 31, incomeId: 21, amountCents: '12000', reference: 'genuine-new-receipt', idempotencyKey: 'root-new', bankPaymentBindingStableKey: null };
    (data.paymentJournalEvents as Row[]).push(root);
    (data.incomes as Row[]).push({ ...(data.incomes as Row[])[0], id: 21, amount: 120 });
    (data.paymentOperations as Row[]).push({ id: 43, idempotencyKey: 'root-new', kind: 'PAYMENT_RECEIVED', createdAt: recorded });
    Object.assign((data.invoices as Row[])[0], { status: 'PAID', paidAt: date });
    const graph = validateBankAllocationGraph(data, CURRENT_SCHEMA_VERSION);
    expect(graph.projections.get(10)?.ledger.originCash.originalReceivedCents).toBe('16000');
    expect(graph.projections.get(10)?.ledger.allocation.validAllocatedCents).toBe('12000');
    const adjusted = fixture('refund'), first = (adjusted.paymentAdjustments as Row[])[0];
    const second: Row = { ...first, id: 51, idempotencyKey: 'adjust-second', reference: 'other-payout', payoutEvidenceIdentity: 'other-payout', amountCents: '3001' };
    second.semanticFingerprint = adjustmentFingerprint(second, (adjusted.paymentJournalEvents as Row[])[0], second.basisSnapshot);
    (adjusted.paymentAdjustments as Row[]).push(second);
    expect(() => validateBankAllocationGraph(adjusted, CURRENT_SCHEMA_VERSION)).toThrow();
  });
  it.each([
    (data: Row) => { (data.paymentAllocationChanges as Row[])[0].revision = 2; },
    (data: Row) => { (data.paymentAllocationChanges as Row[])[0].previousChangeStableKey = randomUUID(); },
    (data: Row) => { (data.paymentAllocationChanges as Row[])[0].toInvoiceId = 999; },
    (data: Row) => { (data.paymentAllocationChanges as Row[]).push({ ...(data.paymentAllocationChanges as Row[])[0] }); },
    (data: Row) => { (data.bankPaymentBindings as Row[])[0].rowStableKey = randomUUID(); },
    (data: Row) => { (data.paymentAdjustments as Row[])[0].allocationRevision = 0; },
    (data: Row) => { (data.paymentAdjustments as Row[])[0].amountCents = '4001'; },
    (data: Row) => { (data.invoices as Row[])[1].customerId = 6; },
    (data: Row) => { (data.paymentAllocationChanges as Row[])[0].amountCents = '3999'; },
  ])('rejects forged/missing/foreign/forked chain and frozen adjustment proof %#', mutate => {
    const data = fixture('refund'); mutate(data); expect(() => validateBankAllocationGraph(data, CURRENT_SCHEMA_VERSION)).toThrow();
  });
});

let db: ReturnType<typeof createTestDatabase>, directory: string, restore: typeof import('@/lib/backup-restore');
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-allocation-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try { restore = await import('@/lib/backup-restore'); } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await db?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });
const resolveFile = async () => new Uint8Array([37,80,68,70]);
async function owner(userId: string) { await db.client.user.create({ data: { id: userId, email: `${userId}@synthetic.invalid`, password: 'unused' } }); }

describe('allocation restore, not command execution', () => {
  it.each(['move','refund','correction'] as const)('cross-tenant restore, exact repeat and re-export to third tenant preserves %s evidence/fingerprints', async kind => {
    const original = pack(fixture(kind)), target = `restore-${kind}`, third = `third-${kind}`;
    await owner(target); await owner(third);
    const first = await restore.restoreBackupData({ userId: target, backup: original, overwrite: true, resolveFile });
    expect(first.bankPaymentBindings).toEqual({ imported: 1, skipped: 0 });
    expect(first.paymentAllocationChanges).toEqual({ imported: 1, skipped: 0 });
    const repeat = await restore.restoreBackupData({ userId: target, backup: original, overwrite: false, resolveFile });
    expect(repeat.bankPaymentBindings).toEqual({ imported: 0, skipped: 1 });
    expect(repeat.paymentAllocationChanges).toEqual({ imported: 0, skipped: 1 });
    const snapshot = JSON.parse(JSON.stringify((await readBackupSnapshot(target)).data)) as Row;
    // Preserve the old array-find projection byte for byte while exercising
    // real restored move/refund/correction graphs, not a duplicate mock graph.
    const [bindingRows, changeRows, adjustmentRows, paymentRows, bankRows] = await Promise.all([
      db.client.bankPaymentBinding.findMany({ where: { userId: target } }),
      db.client.paymentAllocationChange.findMany({ where: { userId: target } }),
      db.client.paymentAdjustment.findMany({ where: { userId: target }, orderBy: { id: 'asc' } }),
      db.client.paymentJournalEvent.findMany({ where: { userId: target }, orderBy: { id: 'asc' } }),
      db.client.bankImportRow.findMany({ where: { userId: target } }),
    ]);
    const oldFail = (message: string): never => { throw new Error(`Bank-Zahlungszuordnung: ${message}`); };
    const oldPortableBindings = (banks: Row[], roots: Row[]) => bindingRows.map(row => ({
      stableKey: String(row.stableKey), rowStableKey: String(banks.find(bank => bank.id === row.bankImportRowId)?.stableKey ?? oldFail('Bankzeile fehlt.')),
      originalPaymentKey: String(roots.find(root => root.id === row.paymentJournalEventId)?.idempotencyKey ?? oldFail('Originalzahlung fehlt.')),
      idempotencyKey: String(row.idempotencyKey), semanticFingerprint: String(row.semanticFingerprint), basisSnapshot: row.basisSnapshot,
      contractVersion: row.contractVersion, createdAt: evidenceDate(row.createdAt).toISOString(),
    })).sort((a, b) => a.stableKey.localeCompare(b.stableKey));
    for (const [banks, roots, message] of [[[], paymentRows, 'Bankzeile fehlt.'], [bankRows, [], 'Originalzahlung fehlt.'], [[], [], 'Bankzeile fehlt.']] as const) {
      expect(() => oldPortableBindings([...banks], [...roots])).toThrow(new Error(`Bank-Zahlungszuordnung: ${message}`));
      expect(() => portableBankAllocations(bindingRows, changeRows, [...banks], [...roots])).toThrow(new Error(`Bank-Zahlungszuordnung: ${message}`));
    }
    const oldProjection = {
      ...snapshot,
      bankPaymentBindings: oldPortableBindings(bankRows, paymentRows),
      paymentAdjustments: adjustmentRows.map(({ allocationBindingId, allocationChangeId, allocationRevision, allocationBasisSnapshot, ...item }) => ({ ...item, userId: undefined,
        ...(item.contractVersion === 3 ? { allocationBindingStableKey: bindingRows.find(binding => binding.id === allocationBindingId)?.stableKey, allocationRevision,
          allocationChangeStableKey: allocationChangeId == null ? null : changeRows.find(change => change.id === allocationChangeId)?.stableKey, allocationBasisSnapshot } : {}),
      })),
      paymentJournalEvents: paymentRows.map(item => ({ ...item, userId: undefined, bankPaymentBindingStableKey: bindingRows.find(binding => binding.paymentJournalEventId === item.id)?.stableKey ?? null })),
    };
    expect(JSON.stringify(snapshot)).toBe(JSON.stringify(oldProjection));
    expect(snapshot.bankPaymentBindings).toEqual(original.data.bankPaymentBindings);
    expect((snapshot.paymentAllocationChanges as Row[])[0].semanticFingerprint).toBe((original.data.paymentAllocationChanges as Row[])[0].semanticFingerprint);
    expect((snapshot.paymentAdjustments as Row[]).map(row => row.semanticFingerprint)).toEqual((original.data.paymentAdjustments as Row[]).map(row => row.semanticFingerprint));
    expect(snapshot.bankImportBatches).toEqual(original.data.bankImportBatches); expect(snapshot.bankImportRows).toEqual(original.data.bankImportRows);
    await restore.restoreBackupData({ userId: third, backup: pack(snapshot, target), overwrite: true, resolveFile });
    expect(await db.client.income.count({ where: { userId: third } })).toBe(1);
    const sourceIncome = await db.client.income.findFirstOrThrow({ where: { userId: target } });
    const copiedIncome = await db.client.income.findFirstOrThrow({ where: { userId: third } });
    expect(copiedIncome.manualRecordId).not.toBe(sourceIncome.manualRecordId);
    expect(copiedIncome.manualRecordOrigin).toBe('PAYMENT_JOURNAL');
    expect(await db.client.manualFinancialRecordEvent.count({ where: { userId: { in: [target, third] } } })).toBe(0);
    expect(await db.client.paymentJournalEvent.count({ where: { userId: third } })).toBe(1);
    expect(await db.client.expense.count({ where: { userId: third } })).toBe(0);
    expect(await db.client.cashTransaction.count({ where: { userId: third } })).toBe(0);
    const a = await db.client.invoice.findFirstOrThrow({ where: { userId: third, invoiceNumber: '2026-A' } });
    expect(a.id).not.toBe(10); expect(a.customerId).not.toBe(5); expect(a.status).toBe('SENT');
  }, 30_000);
  it('round trips A→B alongside unrelated legacy X/customer X without changing the legacy evidence', async () => {
    const data = fixture(); appendLegacyRoot(data, 13, 6); const target = 'restore-unrelated-legacy', third = 'third-unrelated-legacy';
    await owner(target); await owner(third);
    const backup = pack(data);
    const first = await restore.restoreBackupData({ userId: target, backup, overwrite: true, resolveFile });
    expect(first.paymentJournalEvents).toEqual({ imported: 2, skipped: 0 });
    expect(first.bankPaymentBindings).toEqual({ imported: 1, skipped: 0 });
    const repeated = await restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile });
    expect(repeated.paymentJournalEvents).toEqual({ imported: 0, skipped: 2 });
    const snapshot = JSON.parse(JSON.stringify((await readBackupSnapshot(target)).data)) as Row;
    expect((snapshot.paymentJournalEvents as Row[]).find(root => root.idempotencyKey === 'legacy-root-x')).toMatchObject({ source: 'LEGACY_IMPORT', dateCertainty: 'UNKNOWN', amountCents: '12000', paidAt: null, incomeId: null, bankPaymentBindingStableKey: null });
    await restore.restoreBackupData({ userId: third, backup: pack(snapshot, target), overwrite: true, resolveFile });
    const legacy = await db.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: third, idempotencyKey: 'legacy-root-x' }, include: { invoice: true } });
    expect(legacy.invoice).toMatchObject({ invoiceNumber: '2026-X', status: 'PAID', paidAt: null });
    expect(legacy.invoiceId).not.toBe(13); expect(legacy.invoice.customerId).not.toBe(6);
    expect(await db.client.income.count({ where: { userId: third } })).toBe(1);
    expect(await db.client.paymentJournalEvent.count({ where: { userId: third } })).toBe(2);
    const graph = validateBankAllocationGraph((await readBackupSnapshot(third)).data, CURRENT_SCHEMA_VERSION);
    const targetInvoice = await db.client.invoice.findFirstOrThrow({ where: { userId: third, invoiceNumber: '2026-B' } });
    expect(graph.projections.get(targetInvoice.id)?.ledger.allocation.validAllocatedCents).toBe('4000');
  });
  it('appends a verified newer chain and later current-target cancellation/refund without replaying commands', async () => {
    const target = 'restore-advancement'; await owner(target);
    const refund = fixture('refund'), move = structuredClone(refund), initial = structuredClone(refund);
    for (const ancestor of [move, initial]) {
      ancestor.paymentAdjustments = []; ancestor.auditLogs = [];
      ancestor.invoices = (ancestor.invoices as Row[]).filter(row => row.type === 'INVOICE');
      (ancestor.invoices as Row[])[1].status = 'SENT';
      ancestor.paymentOperations = (ancestor.paymentOperations as Row[]).filter(row => row.idempotencyKey !== 'adjust-once');
    }
    initial.paymentAllocationChanges = [];
    initial.paymentOperations = (initial.paymentOperations as Row[]).filter(row => row.kind !== 'PAYMENT_ALLOCATION_CHANGED');
    await restore.restoreBackupData({ userId: target, backup: pack(initial), overwrite: true, resolveFile });
    const moved = await restore.restoreBackupData({ userId: target, backup: pack(move), overwrite: false, resolveFile });
    expect(moved.paymentAllocationChanges).toEqual({ imported: 1, skipped: 0 });
    const refunded = await restore.restoreBackupData({ userId: target, backup: pack(refund), overwrite: false, resolveFile });
    expect(refunded.paymentAdjustments).toEqual({ imported: 1, skipped: 0 });
    const snapshot = await readBackupSnapshot(target), before = snapshot.data;
    const graph = validateBankAllocationGraph(before, CURRENT_SCHEMA_VERSION), b = (before.invoices as Row[]).find(row => row.invoiceNumber === '2026-B')!;
    expect(graph.projections.get(Number(b.id))?.ledger.refundDueCents).toBe('3000');
    expect(await db.client.income.count({ where: { userId: target } })).toBe(1);
    await expect(restore.restoreBackupData({ userId: target, backup: pack(move), overwrite: false, resolveFile })).rejects.toThrow(/zurücksetzen/);
    expect((await readBackupSnapshot(target)).data).toEqual(before);
  });
  it('restores a moved FULL receipt before legacy origin arithmetic and preserves A→B→A chain identity', async () => {
    const fullTarget = 'restore-full-move'; await owner(fullTarget);
    await restore.restoreBackupData({ userId: fullTarget, backup: pack(fixture('move', 120)), overwrite: true, resolveFile });
    const invoices = await db.client.invoice.findMany({ where: { userId: fullTarget }, orderBy: { invoiceNumber: 'asc' } });
    expect(invoices.map(row => row.status)).toEqual(['SENT','PAID']);
    expect(invoices[1].paidAt?.toISOString()).toBe(date);
    expect(await db.client.income.count({ where: { userId: fullTarget } })).toBe(1);
    const returned = fixture(), [a,b] = returned.invoices as Row[], binding = (returned.bankPaymentBindings as Row[])[0], root = (returned.paymentJournalEvents as Row[])[0], head = (returned.paymentAllocationChanges as Row[])[0];
    const basisSnapshot = allocationChangeBasisSnapshot(binding, root, b, a, head, { expectedAllocationRevision: 1, expectedSourceLedgerVersion: token, expectedTargetLedgerVersion: token, actionDate: '2026-10-22', reason: 'Zurück zum richtigen Original' });
    (returned.paymentAllocationChanges as Row[]).push({ ...head, stableKey: randomUUID(), revision: 2, previousChangeStableKey: head.stableKey, fromInvoiceId: 11, toInvoiceId: 10,
      actionDate: '2026-10-22T00:00:00.000Z', reason: 'Zurück zum richtigen Original', idempotencyKey: 'move-back', basisSnapshot, semanticFingerprint: financialHash(basisSnapshot) });
    (returned.paymentOperations as Row[]).push({ id: 44, idempotencyKey: 'move-back', kind: 'PAYMENT_ALLOCATION_CHANGED', createdAt: recorded });
    const target = 'restore-return'; await owner(target);
    const backup = pack(returned); await restore.restoreBackupData({ userId: target, backup, overwrite: true, resolveFile });
    const repeat = await restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile });
    expect(repeat.paymentAllocationChanges).toEqual({ imported: 0, skipped: 2 });
    const chain = await db.client.paymentAllocationChange.findMany({ where: { userId: target }, orderBy: { revision: 'asc' } });
    expect(chain[1].previousChangeId).toBe(chain[0].id);
    expect(chain[1].toInvoiceId).toBe(chain[0].fromInvoiceId);
    const graph = validateBankAllocationGraph((await readBackupSnapshot(target)).data, CURRENT_SCHEMA_VERSION);
    expect(graph.projections.get(chain[1].toInvoiceId)?.ledger.allocation.validAllocatedCents).toBe('4000');
    expect(graph.projections.get(chain[1].fromInvoiceId)?.ledger.allocation.validAllocatedCents).toBe('0');
  });
  it('rejects stable binding and operation collisions atomically without changing target financial evidence', async () => {
    const target = 'restore-collision'; await owner(target); const data = fixture();
    await restore.restoreBackupData({ userId: target, backup: pack(data), overwrite: true, resolveFile });
    const before = await readBackupSnapshot(target);
    const forged = structuredClone(data), binding = (forged.bankPaymentBindings as Row[])[0], change = (forged.paymentAllocationChanges as Row[])[0];
    binding.stableKey = randomUUID(); change.bindingStableKey = binding.stableKey; (forged.paymentJournalEvents as Row[])[0].bankPaymentBindingStableKey = binding.stableKey;
    (change.basisSnapshot as Row).bindingStableKey = binding.stableKey;
    change.semanticFingerprint = financialHash(change.basisSnapshot);
    await expect(restore.restoreBackupData({ userId: target, backup: pack(forged), overwrite: false, resolveFile })).rejects.toThrow(/abweichende|Abweichende|Kollision|abtrennen/);
    expect((await readBackupSnapshot(target)).data).toEqual(before.data);
    const collision = structuredClone(data); (collision.paymentOperations as Row[])[1].kind = 'PAYMENT_RECEIVED';
    await expect(restore.restoreBackupData({ userId: target, backup: pack(collision), overwrite: false, resolveFile })).rejects.toThrow();
    expect((await readBackupSnapshot(target)).data).toEqual(before.data);
  });
  it('atomically rejects shortened older history and overwrite of immutable bindings', async () => {
    const target = 'restore-old-chain'; await owner(target); const data = fixture(); const original = pack(data);
    await restore.restoreBackupData({ userId: target, backup: original, overwrite: true, resolveFile });
    const older = structuredClone(data); older.paymentAllocationChanges = []; older.paymentOperations = (older.paymentOperations as Row[]).filter(row => row.kind !== 'PAYMENT_ALLOCATION_CHANGED');
    const a = (older.invoices as Row[])[0], b = (older.invoices as Row[])[1]; a.status = 'SENT'; b.status = 'SENT';
    await expect(restore.restoreBackupData({ userId: target, backup: pack(older), overwrite: false, resolveFile })).rejects.toThrow(/Ältere|verkürzte|vollständige Zuordnungsevidenz/);
    await expect(restore.restoreBackupData({ userId: target, backup: original, overwrite: true, resolveFile })).rejects.toThrow(/unveränderliche/);
    expect(await db.client.paymentAllocationChange.count({ where: { userId: target } })).toBe(1);
    expect(await db.client.income.count({ where: { userId: target } })).toBe(1);
  });
});
