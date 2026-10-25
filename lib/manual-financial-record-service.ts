import { readManualRecordOriginal } from '@/lib/manual-financial-record-original';
export { readManualRecordOriginal, readManualRecordOriginalBytes, finalizedManualRecordOriginal } from '@/lib/manual-financial-record-original';
import { MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, manualRecordEventsFromBackup } from '@/lib/manual-financial-record-backup';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import type { ManualFinancialRecordDto, ManualFinancialRecordKind, ManualFinancialRecordMutation, ManualFinancialRecordResponse } from '@/lib/manual-financial-record-contract';
import { MAX_MANUAL_RECORD_EVENTS, MANUAL_RECORD_SHA256, MANUAL_RECORD_UUID, ManualFinancialRecordError, manualRecordAmount, manualRecordEventHash, manualRecordHash, type ManualRecordEventEvidence, type ManualRecordOriginalEvidence, type ManualRecordSnapshot } from '@/lib/manual-financial-record-evidence';

export { ManualFinancialRecordError } from '@/lib/manual-financial-record-evidence';
type Income = Prisma.IncomeGetPayload<{ include: { customer: true; cashTransaction: true; paymentJournalEvent: true } }>;
type Expense = Prisma.ExpenseGetPayload<{ include: { cashTransaction: true; purchaseDocument: true } }>;
type Row = (Income | Expense) & { manualRecordId: string };
type Event = Prisma.ManualFinancialRecordEventGetPayload<Record<string, never>>;

async function loadRow(tx: Prisma.TransactionClient, userId: string, kind: ManualFinancialRecordKind, id: number): Promise<Row> {
  const row = kind === 'income'
    ? await tx.income.findFirst({ where: { id, userId }, include: { customer: true, cashTransaction: true, paymentJournalEvent: true } })
    : await tx.expense.findFirst({ where: { id, userId }, include: { cashTransaction: true, purchaseDocument: true } });
  if (!row) throw new ManualFinancialRecordError(404, 'NOT_FOUND', 'Finanzeintrag nicht gefunden.');
  if ('customer' in row && row.customer && row.customer.userId !== userId) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_UNSUPPORTED', 'Der Kundenbezug gehört nicht zum Mandanten.');
  if (!row.manualRecordId || !MANUAL_RECORD_UUID.test(row.manualRecordId)) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_UNSUPPORTED', 'Die portable Eintragsidentität ist nicht verfügbar.');
  return row as Row;
}
function unsupported(row: Row): string | null {
  // Relations, not client-supplied metadata, are authoritative. Even malformed cross-owner links count.
  if ('invoiceId' in row && (row.invoiceId !== null || row.paymentJournalEvent)) return 'Rechnungs- und Zahlungsjournal-Einträge verwenden ihren eigenen unveränderlichen Verlauf.';
  if (row.cashTransaction) return 'Kassenbuch-Einträge werden im Kassenbuch bearbeitet.';
  if ('purchaseDocument' in row && row.purchaseDocument) return 'Diese Ausgabe wird durch ihr Eingangsoriginal gesteuert.';
  if ('recurringExpenseId' in row && (row.recurringExpenseId !== null || row.scheduledDate !== null || row.manualRecordOrigin === 'RECURRING')) return 'Wiederkehrende Ausgaben und ihre Ausführungen sind hier ausgeschlossen, auch nach Entfernen der Serie.';
  if ('depreciationYears' in row && row.depreciationYears !== null) return 'AfA-Ausgaben sind für diese manuelle Festschreibung nicht unterstützt.';
  if (!['MANUAL', 'LEGACY_UNKNOWN'].includes(row.manualRecordOrigin)) return 'Dieser Eintrag stammt aus einem anderen Buchungsablauf.';
  if (!['LEGACY_UNREVIEWED', 'RECORDED', 'FINALIZED'].includes(row.manualRecordState)) return 'Unbekannter technischer Erfassungsstatus.';
  try { manualRecordAmount(row.amount); } catch { return 'Der bestehende Betrag ist nicht nichtnegativ und centgenau sicher darstellbar. Er wird nicht gerundet.'; }
  return null;
}
function eventEvidence(event: Event): ManualRecordEventEvidence {
  return { id: event.id, recordId: event.recordId, kind: event.kind as ManualFinancialRecordKind, sequence: event.sequence, operation: event.operation as ManualRecordEventEvidence['operation'], mutationId: event.mutationId, semanticHash: event.semanticHash, previousHash: event.previousHash, snapshot: event.snapshot as unknown as ManualRecordSnapshot, hash: event.hash, reason: event.reason, createdAt: event.createdAt.toISOString() };
}
async function history(tx: Prisma.TransactionClient, userId: string, row: Row): Promise<ManualRecordEventEvidence[]> {
  const sizes = await tx.$queryRaw<{ bytes: number | bigint }[]>(Prisma.sql`SELECT COALESCE(SUM(length(CAST("snapshot" AS BLOB)) + COALESCE(length(CAST("reason" AS BLOB)),0)),0) AS bytes FROM "ManualFinancialRecordEvent" WHERE "userId"=${userId} AND "recordId"=${row.manualRecordId}`);
  if (Number(sizes[0]?.bytes ?? 0) > 2 * 1024 * 1024) throw new ManualFinancialRecordError(413, 'MANUAL_RECORD_HISTORY_LIMIT', 'Der vollständige Verlauf überschreitet das Metadatenlimit von 2 MiB.');
  const rows = await tx.manualFinancialRecordEvent.findMany({ where: { userId, recordId: row.manualRecordId }, orderBy: { sequence: 'asc' }, take: MAX_MANUAL_RECORD_EVENTS + 1 });
  if (rows.length > MAX_MANUAL_RECORD_EVENTS) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_HISTORY_LIMIT', 'Der vollständige Verlauf überschreitet das unterstützte Limit. Keine Kürzung oder Änderung vorgenommen.');
  const events = rows.map(eventEvidence);
  validateHistoryProjection(row, events);
  return events;
}
function validateHistoryProjection(row: Row, events: ManualRecordEventEvidence[]) {
  const kind = 'invoiceId' in row ? 'income' : 'expense';
  try {
    manualRecordEventsFromBackup({ user: { id: row.userId }, incomes: kind === 'income' ? [row] : [], expenses: kind === 'expense' ? [row] : [],
      manualFinancialRecordEvents: events.map(event => ({ ...event, incomeId: kind === 'income' ? row.id : null, expenseId: kind === 'expense' ? row.id : null })),
      cashTransactions: row.cashTransaction ? [row.cashTransaction] : [], purchaseDocuments: 'purchaseDocument' in row && row.purchaseDocument ? [row.purchaseDocument] : [],
      paymentJournalEvents: 'paymentJournalEvent' in row && row.paymentJournalEvent ? [row.paymentJournalEvent] : [] }, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION);
  } catch { throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_UNSUPPORTED', 'Der vollständige Verlauf und die wirksame Projektion sind inkonsistent oder nicht unterstützt. Keine Daten geändert.'); }
}
function context(row: Row, kind: ManualFinancialRecordKind) {
  const customer = 'customer' in row ? row.customer : null;
  return {
    description: row.description, paymentDate: row.date.toISOString().slice(0, 10), date: row.date.toISOString(), taxRelevant: row.taxRelevant,
    customer: customer ? { name: customer.name, contactPerson: customer.contactPerson, email: customer.email, address: customer.address, zipCode: customer.zipCode, city: customer.city, taxNumber: customer.taxNumber } : null,
    category: kind === 'expense' && 'category' in row ? row.category : null,
    taxDeductiblePercentage: 'taxDeductiblePercentage' in row ? row.taxDeductiblePercentage : null,
    receiptUrl: 'receiptUrl' in row ? row.receiptUrl : null, depreciationYears: 'depreciationYears' in row ? row.depreciationYears : null,
  };
}
function fingerprint(row: Row, kind: ManualFinancialRecordKind, events: ManualRecordEventEvidence[]): string {
  return manualRecordHash({ contractVersion: 1, kind, recordId: row.manualRecordId, state: row.manualRecordState, origin: row.manualRecordOrigin,
    revision: row.manualRecordRevision, amount: row.amount, context: context(row, kind),
    customerId: 'customerId' in row ? row.customerId : null, invoiceId: 'invoiceId' in row ? row.invoiceId : null,
    receiptFileName: 'receiptFileName' in row ? row.receiptFileName : null, storedReceiptFileName: 'storedReceiptFileName' in row ? row.storedReceiptFileName : null,
    recurringExpenseId: 'recurringExpenseId' in row ? row.recurringExpenseId : null, scheduledDate: 'scheduledDate' in row ? row.scheduledDate?.toISOString() : null,
    cashTransactionId: row.cashTransaction?.id ?? null, sourceId: 'purchaseDocument' in row ? row.purchaseDocument?.id ?? null : row.paymentJournalEvent?.id ?? null,
    historyHash: events.at(-1)?.hash ?? null });
}
async function original(row: Row, events: ManualRecordEventEvidence[]): Promise<ManualFinancialRecordDto['original']> {
  const bound = events[0]?.snapshot.original;
  if (bound?.status === 'NONE') return { ...bound };
  if ('storedReceiptFileName' in row && row.storedReceiptFileName) {
    try {
      const evidence = await readManualRecordOriginal(row.userId, row.storedReceiptFileName, bound);
      return { ...evidence, fileName: bound?.fileName ?? row.receiptFileName };
    } catch { return { status: 'UNVERIFIED', fileName: bound?.fileName ?? row.receiptFileName, sha256: bound?.sha256 ?? null, byteCount: bound?.byteCount ?? null }; }
  }
  if (bound?.status === 'ARCHIVED' || ('receiptUrl' in row && (row.receiptUrl || row.receiptFileName))) return { status: 'UNVERIFIED', fileName: bound?.fileName ?? ('receiptFileName' in row ? row.receiptFileName : null), sha256: bound?.sha256 ?? null, byteCount: bound?.byteCount ?? null };
  return { status: 'NONE', fileName: null, sha256: null, byteCount: null };
}
async function dto(tx: Prisma.TransactionClient, userId: string, kind: ManualFinancialRecordKind, row: Row): Promise<ManualFinancialRecordDto> {
  const events = await history(tx, userId, row);
  const file = await original(row, events);
  const reason = unsupported(row) ?? (events.length >= MAX_MANUAL_RECORD_EVENTS ? 'Das unterstützte Limit von 256 unveränderlichen Nachweisen ist erreicht.' : null) ?? (row.manualRecordState === 'FINALIZED' && events.length === 0 ? 'Der vollständige Festschreibungsnachweis fehlt.' : null) ?? (file.status === 'UNVERIFIED' ? 'Das angegebene Original ist nicht unverändert im privaten Mandantenspeicher nachgewiesen.' : null);
  let effectiveAmount: string | null = null;
  try { effectiveAmount = manualRecordAmount(row.amount); } catch { /* Never round historical values. */ }
  return { contractVersion: 1, kind, id: row.id, recordId: row.manualRecordId, state: row.manualRecordState as ManualFinancialRecordDto['state'], origin: row.manualRecordOrigin, revision: row.manualRecordRevision,
    description: row.description, paymentDate: row.date.toISOString().slice(0, 10), fingerprint: fingerprint(row, kind, events), effectiveAmount, currency: 'EUR',
    canFinalize: reason === null && row.manualRecordState !== 'FINALIZED', canCorrectAmount: reason === null && row.manualRecordState === 'FINALIZED' && events.length > 0,
    readOnlyReason: reason, requiresLegacyDeclaration: row.manualRecordState === 'LEGACY_UNREVIEWED', original: file,
    history: events.map(event => ({ id: event.id, sequence: event.sequence, operation: event.operation, mutationId: event.mutationId, amount: event.snapshot.amount,
      originalAmount: event.snapshot.originalAmount, paymentDate: event.snapshot.paymentDate, description: event.snapshot.description, reason: event.reason, createdAt: event.createdAt, hash: event.hash, previousHash: event.previousHash })) };
}
export async function getManualFinancialRecord(userId: string, kind: ManualFinancialRecordKind, id: number): Promise<ManualFinancialRecordDto> {
  // A read transaction only. UUIDs are preallocated in migration/create, never by GET.
  return inTransaction(async tx => dto(tx, userId, kind, await loadRow(tx, userId, kind, id)));
}
export function parseManualFinancialRecordMutation(value: unknown): ManualFinancialRecordMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualFinancialRecordError(400, 'VALIDATION_ERROR', 'Ungültige Anfrage.');
  const input = value as Record<string, unknown>;
  const allowed = ['kind', 'id', 'operation', 'expectedRevision', 'fingerprint', 'mutationId', 'legacyManualDeclaration', 'amount', 'reason'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || !['income', 'expense'].includes(String(input.kind)) || !Number.isSafeInteger(input.id) || Number(input.id) <= 0
    || !['FINALIZE', 'CORRECT_AMOUNT'].includes(String(input.operation)) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0
    || typeof input.fingerprint !== 'string' || !MANUAL_RECORD_SHA256.test(input.fingerprint) || typeof input.mutationId !== 'string' || !MANUAL_RECORD_UUID.test(input.mutationId)
    || (input.legacyManualDeclaration !== undefined && input.legacyManualDeclaration !== true)) throw new ManualFinancialRecordError(400, 'VALIDATION_ERROR', 'Ungültiger Revisions-, Fingerabdruck- oder Vorgangsnachweis.');
  if (input.operation === 'FINALIZE' && (input.amount !== undefined || input.reason !== undefined)) throw new ManualFinancialRecordError(400, 'VALIDATION_ERROR', 'Festschreibung ändert keine Finanzwerte.');
  if (input.operation === 'CORRECT_AMOUNT') {
    input.amount = manualRecordAmount(input.amount, true);
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 1000 || input.legacyManualDeclaration !== undefined) throw new ManualFinancialRecordError(400, 'VALIDATION_ERROR', 'Die reine Betragskorrektur benötigt eine Begründung (1–1000 Zeichen).');
    input.reason = input.reason.trim();
  }
  return input as ManualFinancialRecordMutation;
}
export async function mutateManualFinancialRecord(userId: string, raw: ManualFinancialRecordMutation): Promise<ManualFinancialRecordResponse> {
  const input = parseManualFinancialRecordMutation(raw);
  return inTransaction(async tx => {
    const row = await loadRow(tx, userId, input.kind, input.id);
    const semanticHash = manualRecordHash({ contractVersion: 1, kind: input.kind, recordId: row.manualRecordId, operation: input.operation, expectedRevision: input.expectedRevision,
      fingerprint: input.fingerprint, legacyManualDeclaration: input.legacyManualDeclaration === true, amount: input.amount ?? null, reason: input.reason ?? null });
    // Accepted semantic retries must succeed even when their preview revision is now stale.
    const replay = await tx.manualFinancialRecordEvent.findUnique({ where: { userId_mutationId: { userId, mutationId: input.mutationId } } });
    if (replay) {
      if (replay.semanticHash !== semanticHash || replay.recordId !== row.manualRecordId) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_MUTATION_CONFLICT', 'Diese Vorgangs-ID wurde bereits für einen anderen Inhalt verwendet.');
      return { record: await dto(tx, userId, input.kind, row), replayed: true };
    }
    const events = await history(tx, userId, row);
    if (row.manualRecordRevision !== input.expectedRevision || fingerprint(row, input.kind, events) !== input.fingerprint) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_STALE', 'Der Eintrag wurde verändert. Bitte den aktuellen Nachweis neu laden und prüfen.');
    if (events.length >= MAX_MANUAL_RECORD_EVENTS) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_HISTORY_LIMIT', 'Maximal 256 unveränderliche Nachweise pro Eintrag. Keine weitere Korrektur vorgenommen.');
    const reason = unsupported(row);
    if (reason) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_UNSUPPORTED', reason);
    if (input.operation === 'FINALIZE' && row.manualRecordState === 'FINALIZED') throw new ManualFinancialRecordError(409, 'FINALIZED_RECORD', 'Dieser Eintrag ist bereits festgeschrieben.');
    if (input.operation === 'CORRECT_AMOUNT' && (row.manualRecordState !== 'FINALIZED' || events.length === 0)) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_UNSUPPORTED', 'Nur bereits festgeschriebene unterstützte manuelle Einträge können im Betrag korrigiert werden.');
    if (input.operation === 'FINALIZE' && row.manualRecordState === 'LEGACY_UNREVIEWED' && input.legacyManualDeclaration !== true) throw new ManualFinancialRecordError(400, 'MANUAL_RECORD_LEGACY_DECLARATION_REQUIRED', 'Bitte ausdrücklich bestätigen, dass dieser alte Eintrag eine einzelne manuell erfasste EUR-Zahlung ohne ausgeschlossene Quelle ist. Dies ersetzt keine steuerliche Prüfung.');
    const file = await original(row, events);
    if (file.status === 'UNVERIFIED') throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE', 'Das angegebene Original fehlt oder sein Hash stimmt nicht überein.');
    const oldAmount = manualRecordAmount(row.amount);
    const amount = input.operation === 'CORRECT_AMOUNT' ? input.amount! : oldAmount;
    if (input.operation === 'CORRECT_AMOUNT' && amount === oldAmount) throw new ManualFinancialRecordError(400, 'VALIDATION_ERROR', 'Der Korrekturbetrag muss vom aktuellen Betrag abweichen.');
    const snapshot: ManualRecordSnapshot = input.operation === 'CORRECT_AMOUNT'
      ? { ...events[0].snapshot, amount }
      : { contractVersion: 1, recordId: row.manualRecordId, kind: input.kind, amount, originalAmount: oldAmount, currency: 'EUR', ...context(row, input.kind), original: file as ManualRecordOriginalEvidence, legacyManualDeclaration: input.legacyManualDeclaration === true };
    const evidence: Omit<ManualRecordEventEvidence, 'hash'> = { id: randomUUID(), recordId: row.manualRecordId, kind: input.kind, sequence: events.length + 1, operation: input.operation,
      mutationId: input.mutationId, semanticHash, previousHash: events.at(-1)?.hash ?? null, snapshot, reason: input.reason ?? null, createdAt: new Date().toISOString() };
    const hash = manualRecordEventHash(evidence);
    validateHistoryProjection({ ...row, amount: Number(amount), manualRecordState: 'FINALIZED', manualRecordRevision: row.manualRecordRevision + 1 }, [...events, { ...evidence, hash }]);
    if (Buffer.byteLength(JSON.stringify([...events, { ...evidence, hash }])) > 2 * 1024 * 1024) throw new ManualFinancialRecordError(413, 'MANUAL_RECORD_HISTORY_LIMIT', 'Der vollständige Verlauf überschreitet das Metadatenlimit von 2 MiB.');
    await tx.manualFinancialRecordEvent.create({ data: { ...evidence, kind: input.kind, hash, snapshot: snapshot as unknown as Prisma.InputJsonValue, createdAt: new Date(evidence.createdAt), userId,
      incomeId: input.kind === 'income' ? row.id : null, expenseId: input.kind === 'expense' ? row.id : null } });
    const data = { amount: Number(amount), manualRecordState: 'FINALIZED', manualRecordRevision: { increment: 1 } };
    const changed = input.kind === 'income'
      ? await tx.income.updateMany({ where: { id: row.id, userId, manualRecordRevision: input.expectedRevision, manualRecordState: row.manualRecordState }, data })
      : await tx.expense.updateMany({ where: { id: row.id, userId, manualRecordRevision: input.expectedRevision, manualRecordState: row.manualRecordState }, data });
    if (changed.count !== 1) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_STALE', 'Der Eintrag wurde gleichzeitig verändert.');

    await createFinancialAuditLog({ userId, action: input.operation === 'FINALIZE' ? 'STATUS_CHANGED' : 'UPDATE', entityType: input.kind === 'income' ? 'Income' : 'Expense', entityId: row.id,
      entityName: row.description, oldValues: { amount: oldAmount, revision: row.manualRecordRevision }, newValues: { amount, revision: row.manualRecordRevision + 1, eventId: evidence.id, hash },
      metadata: { actorId: userId, tenantId: userId, operation: `manual-record.${input.operation.toLowerCase()}`, originalReference: row.manualRecordId, reason: input.reason ?? 'Explicit integrity finalization; no financial posting or fiscal review' } }, tx);
    return { record: await dto(tx, userId, input.kind, await loadRow(tx, userId, input.kind, row.id)), replayed: false };
  });
}
