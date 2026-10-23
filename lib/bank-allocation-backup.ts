import { createFinancialAuditLog } from '@/lib/audit-log';
import type { Prisma } from '@prisma/client';
import { bankImportUuid } from '@/lib/bank-import-contract';
import { validateBankAllocationCapability, backupSchemaSupportsBankPaymentAllocations } from '@/lib/backup-manifest';
import { allocationBasisSnapshot, validateAllocationChain } from '@/lib/payment-journal/allocation-evidence';
import { MAX_ALLOCATION_GRAPH_RECORDS, reduceAllocationLedger, type AllocationRootState } from '@/lib/payment-journal/allocation-contract';
import { evidenceDate, financialHash, validateAdjustmentEvidence, type AdjustmentAllocationProof } from '@/lib/payment-journal/adjustment-evidence';
import { exactPaymentCents, paymentText } from '@/lib/payment-journal/contract';

type Row = Record<string, unknown>;
export type PortableBankPaymentBinding = {
  stableKey: string; rowStableKey: string; originalPaymentKey: string; idempotencyKey: string;
  semanticFingerprint: string; basisSnapshot: Prisma.InputJsonValue; contractVersion: 1; createdAt: string;
};
export type PortablePaymentAllocationChange = {
  stableKey: string; bindingStableKey: string; revision: number; previousChangeStableKey: string | null;
  fromInvoiceId: number; toInvoiceId: number; amountCents: string; currency: 'EUR'; actionDate: string; reason: string;
  idempotencyKey: string; semanticFingerprint: string; basisSnapshot: Prisma.InputJsonValue; contractVersion: 1; recordedAt: string;
};
export type BankAllocationBackup = { bindings: PortableBankPaymentBinding[]; changes: PortablePaymentAllocationChange[] };
const bindingFields = ['stableKey','rowStableKey','originalPaymentKey','idempotencyKey','semanticFingerprint','basisSnapshot','contractVersion','createdAt'];
const changeFields = ['stableKey','bindingStableKey','revision','previousChangeStableKey','fromInvoiceId','toInvoiceId','amountCents','currency','actionDate','reason','idempotencyKey','semanticFingerprint','basisSnapshot','contractVersion','recordedAt'];
function fail(message: string): never { throw new Error(`Bank-Zahlungszuordnung: ${message}`); }
function records(data: Row, key: string): Row[] {
  const value = data[key] ?? [];
  if (!Array.isArray(value) || (['bankPaymentBindings','paymentAllocationChanges','paymentJournalEvents','paymentAdjustments','paymentOperations'].includes(key) && value.length > MAX_ALLOCATION_GRAPH_RECORDS) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) fail(`${key}: unvollständiger oder zu umfangreicher Abschnitt.`);
  return value as Row[];
}
function closed(row: Row, fields: string[]) {
  if (Object.keys(row).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(row, key))) fail('Unbekannte oder fehlende Nachweisfelder.');
}
function uuid(value: unknown): string { const result = bankImportUuid(value); if (result !== value) fail('UUID ist nicht kanonisch.'); return result; }
function positiveId(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail('Ungültige Rechnungsidentität.'); return value; }
function unique(rows: Row[], key: string) { const values = rows.map(row => row[key]); if (new Set(values).size !== values.length) fail(`Doppelte ${key}-Identität.`); }

/** Exact additive portable boundary. Immutable bank JSON is never extended or rehashed here. */
export function bankAllocationsFromBackup(data: Row, schemaVersion?: string): BankAllocationBackup {
  validateBankAllocationCapability(data, schemaVersion);
  if (!backupSchemaSupportsBankPaymentAllocations(schemaVersion)) return { bindings: [], changes: [] };
  const bindings = records(data, 'bankPaymentBindings'), changes = records(data, 'paymentAllocationChanges');
  for (const binding of bindings) {
    closed(binding, bindingFields); uuid(binding.stableKey); uuid(binding.rowStableKey);
    if (binding.contractVersion !== 1 || paymentText(binding.originalPaymentKey, 'Zahlungsschlüssel', 128) !== binding.originalPaymentKey || binding.idempotencyKey !== binding.originalPaymentKey) fail('Ungültige Bindungsidentität.');
    evidenceDate(binding.createdAt);
    if (!binding.basisSnapshot || financialHash(binding.basisSnapshot) !== binding.semanticFingerprint) fail('Bindungsfingerprint widerspricht unveränderlichem Nachweis.');
  }
  for (const field of ['stableKey','rowStableKey','originalPaymentKey','idempotencyKey']) unique(bindings, field);
  for (const change of changes) {
    closed(change, changeFields); uuid(change.stableKey); uuid(change.bindingStableKey);
    if (change.previousChangeStableKey !== null) uuid(change.previousChangeStableKey);
    positiveId(change.fromInvoiceId); positiveId(change.toInvoiceId);
    if (!Number.isSafeInteger(change.revision) || Number(change.revision) <= 0 || change.contractVersion !== 1 || change.currency !== 'EUR'
      || paymentText(change.reason, 'Begründung', 1000) !== change.reason || paymentText(change.idempotencyKey, 'Aktionsschlüssel', 128) !== change.idempotencyKey) fail('Ungültiger Zuordnungswechsel.');
    evidenceDate(change.actionDate); evidenceDate(change.recordedAt);
    if (!change.basisSnapshot || financialHash(change.basisSnapshot) !== change.semanticFingerprint) fail('Zuordnungsfingerprint widerspricht Nachweis.');
  }
  unique(changes, 'stableKey'); unique(changes, 'idempotencyKey');
  const bindingKeys = new Set(bindings.map(row => row.stableKey));
  if (changes.some(row => !bindingKeys.has(row.bindingStableKey))) fail('Zuordnungskette ohne Bindung.');
  return { bindings: bindings as unknown as PortableBankPaymentBinding[], changes: changes as unknown as PortablePaymentAllocationChange[] };
}

/** Translate portable identities into temporary explicit IDs solely for the shared pure validator. */
export function validateBankAllocationGraph(data: Row, schemaVersion?: string, options: { validateProjection?: boolean } = {}) {
  const portable = bankAllocationsFromBackup(data, schemaVersion);
  if (backupSchemaSupportsBankPaymentAllocations(schemaVersion)) {
    const sourceRoots = data.paymentJournalEvents ?? [];
    if (!Array.isArray(sourceRoots)) fail('Originalzahlungsabschnitt ist ungültig.');
    for (const value of sourceRoots) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Originalzahlung ist ungültig.');
      const root = value as Row;
      if (!Object.hasOwn(root, 'bankPaymentBindingStableKey')) fail('Explizite nullable Bankbindungsidentität der Originalzahlung fehlt.');
      const key = root.bankPaymentBindingStableKey;
      if (key !== null) uuid(key);
      const matches = portable.bindings.filter(binding => binding.originalPaymentKey === root.idempotencyKey);
      if (key === null ? matches.length !== 0 : matches.length !== 1 || matches[0].stableKey !== key) fail('Portable Originalzahlung und Bankbindung widersprechen sich.');
    }
  }
  if (!portable.bindings.length) {
    if (Array.isArray(data.paymentAdjustments) && data.paymentAdjustments.some(row => row && typeof row === 'object' && (row as Row).contractVersion === 3)) fail('Erforderliche unveränderliche Bankbindung fehlt.');
    return { ...portable, affectedInvoiceIds: new Set<number>(), proofByRoot: new Map<number, AdjustmentAllocationProof>(), projections: new Map<number, ReturnType<typeof reduceAllocationLedger>>(), rootStates: [] as AllocationRootState[] };
  }
  const source = (data.user as Row | undefined)?.id;
  const owned = (row: Row): Row => { if (row.userId !== undefined && row.userId !== source) fail('Fremder Nachweis.'); return { ...row, userId: source }; };
  const invoices = records(data, 'invoices').map(owned), roots = records(data, 'paymentJournalEvents').map(owned), incomes = records(data, 'incomes').map(owned);
  const bankRows: Array<Row & { id: number }> = records(data, 'bankImportRows').map((row, index) => ({ ...row, id: index + 1, userId: source }));
  const byInvoice = new Map(invoices.map(row => [Number(row.id), row]));
  const bindings = portable.bindings.map((row, index) => ({ ...row, id: index + 1, userId: source,
    bankImportRowId: bankRows.find(bank => bank.stableKey === row.rowStableKey)?.id,
    paymentJournalEventId: roots.find(root => root.idempotencyKey === row.originalPaymentKey)?.id }));
  const changeIds = new Map(portable.changes.map((row, index) => [row.stableKey, index + 1]));
  const changes = portable.changes.map(row => ({ ...row, id: changeIds.get(row.stableKey)!, userId: source,
    bindingId: bindings.find(binding => binding.stableKey === row.bindingStableKey)?.id,
    previousChangeId: row.previousChangeStableKey === null ? null : changeIds.get(row.previousChangeStableKey) }));
  const proofByRoot = new Map<number, AdjustmentAllocationProof>();
  const affectedInvoiceIds = new Set<number>();
  const historicalRootIdsByInvoice = new Map<number, Set<number>>();
  const allocationByRoot = new Map<number, { invoiceId: number; binding: typeof bindings[number]; head: Row | null }>();
  const cashIncomeIds = new Set(records(data, 'cashTransactions').filter(row => row.incomeId != null).map(row => Number(row.incomeId)));
  const operations = records(data, 'paymentOperations');
  if (changes.some(change => roots.some(root => root.idempotencyKey === change.idempotencyKey))) fail('Wechselschlüssel kollidiert mit Originalzahlung.');
  for (const binding of bindings) {
    const root = roots.find(row => row.id === binding.paymentJournalEventId), bank = bankRows.find(row => row.id === binding.bankImportRowId);
    const origin = root && byInvoice.get(Number(root.invoiceId));
    if (!root || !bank || !origin || cashIncomeIds.has(Number(root.incomeId))) fail('Bindung ohne vollständigen Originalzahlungs-/Bankbezug.');
    if (operations.filter(row => row.idempotencyKey === binding.idempotencyKey && row.kind === 'PAYMENT_RECEIVED').length !== 1) fail('Bindung ohne Finanzaktionsnachweis.');
    const chain = changes.filter(row => row.bindingId === binding.id);
    for (const change of chain) if (operations.filter(row => row.idempotencyKey === change.idempotencyKey && row.kind === 'PAYMENT_ALLOCATION_CHANGED').length !== 1) fail('Wechsel ohne eindeutigen Finanzaktionsnachweis.');
    const state = validateAllocationChain(binding, bank, root, origin, chain, byInvoice);
    const snapshot = allocationBasisSnapshot(binding, bank, root, origin, state.currentInvoice, state.head);
    proofByRoot.set(Number(root.id), { bindingId: binding.id, revision: state.revision, changeId: state.head ? Number(state.head.id) : null, snapshot });
    allocationByRoot.set(Number(root.id), { invoiceId: Number(state.currentInvoice.id), binding, head: state.head });
    affectedInvoiceIds.add(Number(origin.id));
    for (const change of chain) for (const invoiceId of [change.fromInvoiceId, change.toInvoiceId]) {
      affectedInvoiceIds.add(invoiceId);
      const touchedRoots = historicalRootIdsByInvoice.get(invoiceId) ?? new Set<number>();
      touchedRoots.add(Number(root.id)); historicalRootIdsByInvoice.set(invoiceId, touchedRoots);
    }
  }
  const adjustments: Row[] = records(data, 'paymentAdjustments').map(row => {
    const binding = row.allocationBindingStableKey == null ? null : bindings.find(value => value.stableKey === row.allocationBindingStableKey);
    const changeId = row.allocationChangeStableKey == null ? null : changeIds.get(String(row.allocationChangeStableKey));
    if (row.contractVersion === 3 && (!binding || changeId === undefined)) fail('Berichtigung ohne portable Zuordnungsreferenz.');
    return { ...owned(row), allocationBindingId: binding?.id ?? null, allocationChangeId: changeId };
  });
  for (const root of roots) {
    const selected = adjustments.filter(row => row.originalPaymentId === root.id);
    const assignment = allocationByRoot.get(Number(root.id));
    if (selected.some(row => assignment ? row.contractVersion !== 3 || row.invoiceId !== assignment.invoiceId : row.contractVersion === 3)) fail('Berichtigung widerspricht aktueller eingefrorener Zuordnung.');
    if (assignment) {
      const income = incomes.find(row => row.id === root.incomeId), origin = byInvoice.get(Number(root.invoiceId));
      if (!income || income.invoiceId !== root.invoiceId || income.customerId !== origin?.customerId || exactPaymentCents(income.amount as number).toString() !== root.amountCents || evidenceDate(income.date).getTime() !== evidenceDate(root.paidAt).getTime()) fail('Originaleinnahme widerspricht dem einzigen Geldwurzelbeleg.');
    }
  }
  for (const invoice of invoices) {
    const selected = adjustments.filter(row => row.invoiceId === invoice.id);
    if (selected.length) validateAdjustmentEvidence(invoice, roots, selected, invoices, cashIncomeIds, proofByRoot);
  }
  const rootStates: AllocationRootState[] = roots.map(root => {
    const assignment = allocationByRoot.get(Number(root.id));
    return { root: root as unknown as AllocationRootState['root'], allocatedInvoiceId: assignment?.invoiceId ?? Number(root.invoiceId),
      adjustments: adjustments.filter(row => row.originalPaymentId === root.id) as unknown as AllocationRootState['adjustments'],
      bindingStableKey: assignment?.binding.stableKey ?? null, allocationRevision: assignment ? Number(assignment.head?.revision ?? 0) : null,
      allocationChangeStableKey: assignment?.head ? String(assignment.head.stableKey) : null };
  });
  const projections = new Map<number, ReturnType<typeof reduceAllocationLedger>>();
  for (const invoiceId of affectedInvoiceIds) {
    const invoice = byInvoice.get(invoiceId)!;
    // Match the shared loader's required closure: origin, effective target, and every
    // historical chain touch. Unrelated tenant legacy roots are not this invoice's graph.
    const invoiceRootStates = rootStates.filter(state => state.root.invoiceId === invoiceId || state.allocatedInvoiceId === invoiceId
      || historicalRootIdsByInvoice.get(invoiceId)?.has(state.root.id));
    const reduced = reduceAllocationLedger(invoice.totalAmount as number, invoiceId, String(invoice.status), invoiceRootStates);
    projections.set(invoiceId, reduced);
    if (options.validateProjection !== false && invoice.status !== 'CANCELLED' && (invoice.status !== (reduced.summary.paid ? 'PAID' : 'SENT')
      || (invoice.paidAt == null ? null : evidenceDate(invoice.paidAt).getTime()) !== (reduced.summary.paid ? reduced.settlementDate?.getTime() ?? null : null))) fail('Rechnungsprojektion widerspricht vollständiger aktueller Zuordnung.');
    const originRoots = roots.filter(root => root.invoiceId === invoiceId);
    if (incomes.filter(income => income.invoiceId === invoiceId).some(income => originRoots.filter(root => root.incomeId === income.id).length !== 1)) fail('Ungeklärte Originaleinnahme im Zuordnungsgraph.');
  }
  return { ...portable, affectedInvoiceIds, proofByRoot, projections, rootStates };
}

/** Raw DB rows become stable references; no local ID enters the portable financial proof. */
export function portableBankAllocations(bindings: Row[], changes: Row[], bankRows: Row[], roots: Row[]): BankAllocationBackup {
  const bindingById = new Map(bindings.map(row => [row.id, row])), changeById = new Map(changes.map(row => [row.id, row]));
  return {
    bindings: bindings.map(row => ({ stableKey: String(row.stableKey), rowStableKey: String(bankRows.find(bank => bank.id === row.bankImportRowId)?.stableKey ?? fail('Bankzeile fehlt.')),
      originalPaymentKey: String(roots.find(root => root.id === row.paymentJournalEventId)?.idempotencyKey ?? fail('Originalzahlung fehlt.')),
      idempotencyKey: String(row.idempotencyKey), semanticFingerprint: String(row.semanticFingerprint), basisSnapshot: row.basisSnapshot as Prisma.InputJsonValue,
      contractVersion: row.contractVersion as 1, createdAt: evidenceDate(row.createdAt).toISOString() })).sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
    changes: changes.map(row => ({ stableKey: String(row.stableKey), bindingStableKey: String(bindingById.get(row.bindingId)?.stableKey ?? fail('Bindung fehlt.')),
      previousChangeStableKey: row.previousChangeId == null ? null : String(changeById.get(row.previousChangeId)?.stableKey ?? fail('Vorgänger fehlt.')),
      revision: Number(row.revision), fromInvoiceId: Number(row.fromInvoiceId), toInvoiceId: Number(row.toInvoiceId), amountCents: String(row.amountCents), currency: 'EUR' as const,
      actionDate: evidenceDate(row.actionDate).toISOString(), reason: String(row.reason), idempotencyKey: String(row.idempotencyKey), semanticFingerprint: String(row.semanticFingerprint),
      basisSnapshot: row.basisSnapshot as Prisma.InputJsonValue, contractVersion: row.contractVersion as 1, recordedAt: evidenceDate(row.recordedAt).toISOString() })).sort((a, b) => a.bindingStableKey.localeCompare(b.bindingStableKey) || a.revision - b.revision),
  };
}

/** Import immutable evidence only, after roots/operations and before cash adjustments. */
export async function restoreBankAllocations(tx: Prisma.TransactionClient, userId: string, graph: BankAllocationBackup, invoiceMap: Map<number, number>, rootMap: Map<string, number>) {
  const counts = { bindings: { imported: 0, skipped: 0 }, changes: { imported: 0, skipped: 0 } };
  const bindingMap = new Map<string, number>(), changeMap = new Map<string, number>();
  const existingBindings = await tx.bankPaymentBinding.findMany({ where: { userId } });
  const existingChanges = await tx.paymentAllocationChange.findMany({ where: { userId }, orderBy: { revision: 'asc' } });
  const touched = new Set(invoiceMap.values());
  for (const existing of existingBindings) {
    const root = await tx.paymentJournalEvent.findFirstOrThrow({ where: { id: existing.paymentJournalEventId, userId } });
    const chain = existingChanges.filter(row => row.bindingId === existing.id);
    if ((touched.has(root.invoiceId) || chain.some(row => touched.has(row.fromInvoiceId) || touched.has(row.toInvoiceId))) && !graph.bindings.some(row => row.stableKey === existing.stableKey)) fail('Backup darf vorhandene unveränderliche Bankbindung nicht abtrennen.');
  }
  for (const source of graph.bindings) {
    const row = await tx.bankImportRow.findFirst({ where: { userId, stableKey: source.rowStableKey } });
    const rootId = rootMap.get(source.originalPaymentKey);
    if (!row || rootId === undefined) fail('Explizite Zeilen-/Zahlungsabbildung fehlt.');
    const matches = existingBindings.filter(value => value.stableKey === source.stableKey || value.bankImportRowId === row.id || value.paymentJournalEventId === rootId || value.idempotencyKey === source.idempotencyKey);
    const existing = matches[0];
    if (matches.length > 1) fail('Kollidierende Bindungsidentitäten.');
    if (existing) {
      if (existing.stableKey !== source.stableKey || existing.bankImportRowId !== row.id || existing.paymentJournalEventId !== rootId || existing.idempotencyKey !== source.idempotencyKey || existing.semanticFingerprint !== source.semanticFingerprint || financialHash(existing.basisSnapshot) !== financialHash(source.basisSnapshot) || existing.contractVersion !== source.contractVersion || existing.createdAt.getTime() !== evidenceDate(source.createdAt).getTime()) fail('Abweichende unveränderliche Bankbindung.');
      const sourceChain = graph.changes.filter(value => value.bindingStableKey === source.stableKey);
      if (existingChanges.filter(value => value.bindingId === existing.id).some(value => !sourceChain.some(change => change.stableKey === value.stableKey))) fail('Ältere oder verkürzte Zuordnungskette darf neueren Zielstand nicht zurücksetzen.');
      bindingMap.set(source.stableKey, existing.id); counts.bindings.skipped++;
    } else {
      const { rowStableKey: _row, originalPaymentKey: _root, createdAt, ...values } = source; void _row; void _root;
      const created = await tx.bankPaymentBinding.create({ data: { ...values, userId, bankImportRowId: row.id, paymentJournalEventId: rootId, createdAt: evidenceDate(createdAt) } });
      bindingMap.set(source.stableKey, created.id); counts.bindings.imported++;
      const root = await tx.paymentJournalEvent.findFirstOrThrow({ where: { id: rootId, userId } });
      await createFinancialAuditLog({ userId, action: 'RESTORE', entityType: 'Invoice', entityId: root.invoiceId,
        newValues: { bindingStableKey: source.stableKey, rowStableKey: source.rowStableKey, originalPaymentId: rootId, semanticFingerprint: source.semanticFingerprint },
        metadata: { actorId: userId, tenantId: userId, operation: 'bank-payment-binding.restore', originalReference: `binding:${source.stableKey}`, reason: 'Unveränderliche Bank-Zahlungsbindung wiederhergestellt; kein neuer Geldeingang.' } }, tx);
    }
  }
  for (const source of [...graph.changes].sort((a,b) => a.revision - b.revision)) {
    const bindingId = bindingMap.get(source.bindingStableKey), fromInvoiceId = invoiceMap.get(source.fromInvoiceId), toInvoiceId = invoiceMap.get(source.toInvoiceId);
    const previousChangeId = source.previousChangeStableKey === null ? null : changeMap.get(source.previousChangeStableKey);
    if (bindingId === undefined || fromInvoiceId === undefined || toInvoiceId === undefined || previousChangeId === undefined) fail('Explizite Zuordnungsabbildung fehlt.');
    const matches = existingChanges.filter(row => row.stableKey === source.stableKey || row.idempotencyKey === source.idempotencyKey || (row.bindingId === bindingId && row.revision === source.revision));
    if (matches.length > 1) fail('Kollidierende Wechselidentitäten.');
    const existing = matches[0];
    if (existing) {
      if (existing.stableKey !== source.stableKey || existing.bindingId !== bindingId || existing.previousChangeId !== previousChangeId || existing.fromInvoiceId !== fromInvoiceId || existing.toInvoiceId !== toInvoiceId || existing.revision !== source.revision || existing.idempotencyKey !== source.idempotencyKey || existing.amountCents !== source.amountCents || existing.currency !== source.currency || existing.reason !== source.reason || existing.semanticFingerprint !== source.semanticFingerprint || financialHash(existing.basisSnapshot) !== financialHash(source.basisSnapshot) || existing.contractVersion !== source.contractVersion || existing.actionDate.getTime() !== evidenceDate(source.actionDate).getTime() || existing.recordedAt.getTime() !== evidenceDate(source.recordedAt).getTime()) fail('Abweichende unveränderliche Zuordnungskette.');
      changeMap.set(source.stableKey, existing.id); counts.changes.skipped++;
    } else {
      const { bindingStableKey: _binding, previousChangeStableKey: _previous, actionDate, recordedAt, ...values } = source; void _binding; void _previous;
      const created = await tx.paymentAllocationChange.create({ data: { ...values, userId, bindingId, previousChangeId, fromInvoiceId, toInvoiceId, actionDate: evidenceDate(actionDate), recordedAt: evidenceDate(recordedAt) } });
      changeMap.set(source.stableKey, created.id); counts.changes.imported++;
      await createFinancialAuditLog({ userId, action: 'RESTORE', entityType: 'Invoice', entityId: toInvoiceId,
        newValues: { bindingStableKey: source.bindingStableKey, allocationChangeStableKey: source.stableKey, fromInvoiceId, toInvoiceId, revision: source.revision, semanticFingerprint: source.semanticFingerprint },
        metadata: { actorId: userId, tenantId: userId, operation: 'payment-allocation.restore', originalReference: `allocation:${source.stableKey}`, reason: 'Unveränderlicher Zuordnungsnachweis wiederhergestellt; keine Geldbewegung und keine neue Umzuordnung ausgeführt.' } }, tx);
    }
  }
  return { ...counts, bindingMap, changeMap };
}
