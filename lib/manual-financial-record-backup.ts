import type { Prisma } from '@prisma/client';
import { MAX_MANUAL_RECORD_BACKUP_EVENTS, MAX_MANUAL_RECORD_EVENTS, MANUAL_RECORD_SHA256, MANUAL_RECORD_UUID, manualRecordAmount, manualRecordEventHash, manualRecordHash, type ManualRecordEventEvidence, type ManualRecordSnapshot } from '@/lib/manual-financial-record-evidence';
import { readManualRecordOriginal } from '@/lib/manual-financial-record-original';

/** Exact closed identity; historical identities must never gain this capability. */
export const MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION = '20261025090000_add_manual_financial_record_lifecycle';
export function supportsManualFinancialRecords(schemaVersion?: string): boolean { return schemaVersion === MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION; }
type Row = Record<string, unknown>;
type Data = Record<string, unknown>;
const FIELDS = ['manualRecordId', 'manualRecordState', 'manualRecordOrigin', 'manualRecordRevision'] as const;
const ORIGINS = ['MANUAL', 'LEGACY_UNKNOWN', 'PAYMENT_JOURNAL', 'INVOICE', 'CASHBOOK', 'PURCHASE_DOCUMENT', 'RECURRING'];
function fail(message: string): never { throw new Error(`Manueller Finanznachweis: ${message}`); }
function record(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Objekt fehlt.'); return value as Row; }
function rows(data: Data, key: string): Row[] { if (!Array.isArray(data[key])) return []; return (data[key] as unknown[]).map(record); }
function closed(value: Row, fields: string[], label: string) { if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) fail(`${label} hat fehlende oder unbekannte Felder.`); }
function nullableText(value: unknown, max: number) { return value === null || (typeof value === 'string' && value.length <= max); }
function dateIso(value: unknown): string { return new Date(value instanceof Date ? value.getTime() : String(value)).toISOString(); }
function iso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
/** Relations and sticky lineage, never a caller's MANUAL label, decide whether
 * this slice owns identity/replay. Source workflows keep their existing tenant
 * remap contract and allocate a fresh, non-financial technical UUID on create. */
function lifecycleClassification(row: Row, kind: 'income' | 'expense', data: Data): { owned: boolean; origin: string } {
  const durable = typeof row.manualRecordOrigin === 'string' ? row.manualRecordOrigin : 'LEGACY_UNKNOWN';
  const references = (value: unknown) => (typeof value === 'number' || typeof value === 'string') && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) === Number(row.id);
  if (kind === 'income') {
    if (rows(data, 'paymentJournalEvents').some(event => references(event.incomeId))) return { owned: false, origin: 'PAYMENT_JOURNAL' };
    if (row.invoiceId != null) return { owned: false, origin: durable === 'PAYMENT_JOURNAL' ? durable : 'INVOICE' };
  } else {
    if (rows(data, 'purchaseDocuments').some(source => references(source.expenseId))) return { owned: false, origin: 'PURCHASE_DOCUMENT' };
    if (row.recurringExpenseId != null || row.scheduledDate != null || durable === 'RECURRING') return { owned: false, origin: 'RECURRING' };
  }
  if (!['MANUAL', 'LEGACY_UNKNOWN'].includes(durable)) return { owned: false, origin: durable };
  if (rows(data, 'cashTransactions').some(cash => references(kind === 'income' ? cash.incomeId : cash.expenseId))) return { owned: false, origin: 'CASHBOOK' };
  if (kind === 'expense' && row.depreciationYears != null) return { owned: false, origin: durable };
  return { owned: true, origin: durable };
}
export function manualRecordEventsFromBackup(data: Data, schemaVersion?: string): ManualRecordEventEvidence[] {
  const supported = supportsManualFinancialRecords(schemaVersion);
  const sourceOwner = data.user && typeof data.user === 'object' && !Array.isArray(data.user) ? (data.user as Row).id : undefined;
  for (const key of ['incomes', 'expenses']) for (const row of rows(data, key)) {
    if (supported && row.userId !== undefined && row.userId !== sourceOwner) fail('Eintragsbesitzer widerspricht dem Quellmandanten.');
    if (!supported && FIELDS.some(field => Object.hasOwn(row, field))) fail('Ältere Schemaidentitäten dürfen keine Lifecycle-Felder enthalten, auch nicht null.');
    if (supported && (FIELDS.some(field => !Object.hasOwn(row, field)) || !MANUAL_RECORD_UUID.test(String(row.manualRecordId)) || !['LEGACY_UNREVIEWED', 'RECORDED', 'FINALIZED'].includes(String(row.manualRecordState)) || !ORIGINS.includes(String(row.manualRecordOrigin)) || !Number.isSafeInteger(row.manualRecordRevision) || Number(row.manualRecordRevision) < 0)) fail('Unvollständige aktuelle Lifecycle-Metadaten.');
  }
  if (!supported) {
    if (Object.hasOwn(data, 'manualFinancialRecordEvents')) fail('Ältere Schemaidentitäten dürfen keinen Verlauf enthalten, auch nicht null.');
    return [];
  }
  if (!Array.isArray(data.manualFinancialRecordEvents) || data.manualFinancialRecordEvents.length > MAX_MANUAL_RECORD_BACKUP_EVENTS) fail('Vollständiger Verlauf fehlt oder überschreitet 10.000 Nachweise.');
  const seenIds = new Set<string>(), seenMutations = new Set<string>(), portableIds = new Set<string>();
  const allRows = [...rows(data, 'incomes').map(row => ({ row, kind: 'income' as const })), ...rows(data, 'expenses').map(row => ({ row, kind: 'expense' as const }))];
  const byId = new Map(allRows.map(entry => [`${entry.kind}:${entry.row.id}`, entry]));
  for (const { row } of allRows) { if (portableIds.has(String(row.manualRecordId))) fail('Doppelte portable Eintragsidentität.'); portableIds.add(String(row.manualRecordId)); }
  const events = data.manualFinancialRecordEvents.map(value => {
    const row = record(value);
    closed(row, ['id', 'recordId', 'kind', 'incomeId', 'expenseId', 'sequence', 'operation', 'mutationId', 'semanticHash', 'previousHash', 'snapshot', 'hash', 'reason', 'createdAt'], 'Verlaufsereignis');
    if (!MANUAL_RECORD_UUID.test(String(row.id)) || !MANUAL_RECORD_UUID.test(String(row.recordId)) || !MANUAL_RECORD_UUID.test(String(row.mutationId)) || !['income', 'expense'].includes(String(row.kind)) || !['FINALIZE', 'CORRECT_AMOUNT'].includes(String(row.operation)) || !Number.isSafeInteger(row.sequence) || Number(row.sequence) <= 0 || !MANUAL_RECORD_SHA256.test(String(row.hash)) || !MANUAL_RECORD_SHA256.test(String(row.semanticHash)) || (row.previousHash !== null && !MANUAL_RECORD_SHA256.test(String(row.previousHash))) || !iso(row.createdAt)) fail('Ungültige Verlaufsidentität, Revision oder Hash.');
    if (seenIds.has(String(row.id)) || seenMutations.has(String(row.mutationId))) fail('Doppelte Ereignis- oder Vorgangs-ID.');
    seenIds.add(String(row.id)); seenMutations.add(String(row.mutationId));
    const sourceId = row.kind === 'income' ? row.incomeId : row.expenseId;
    if (!Number.isSafeInteger(sourceId) || Number(sourceId) <= 0 || (row.kind === 'income' ? row.expenseId : row.incomeId) !== null) fail('Ungültige lokale Eintragsverknüpfung.');
    const linked = byId.get(`${row.kind}:${sourceId}`);
    if (!linked || linked.row.manualRecordId !== row.recordId || linked.row.manualRecordState !== 'FINALIZED') fail('Verlauf ist keinem eindeutigen festgeschriebenen Eintrag zugeordnet.');
    const snapshot = record(row.snapshot);
    closed(snapshot, ['contractVersion', 'recordId', 'kind', 'amount', 'originalAmount', 'currency', 'description', 'paymentDate', 'date', 'taxRelevant', 'customer', 'category', 'taxDeductiblePercentage', 'receiptUrl', 'depreciationYears', 'original', 'legacyManualDeclaration'], 'Snapshot');
    if (snapshot.contractVersion !== 1 || snapshot.recordId !== row.recordId || snapshot.kind !== row.kind || snapshot.currency !== 'EUR' || typeof snapshot.description !== 'string' || !snapshot.description.trim() || snapshot.description.length > 10000 || !iso(snapshot.date) || snapshot.paymentDate !== snapshot.date.slice(0, 10) || typeof snapshot.taxRelevant !== 'boolean' || typeof snapshot.legacyManualDeclaration !== 'boolean' || !nullableText(snapshot.category, 10000) || !nullableText(snapshot.receiptUrl, 2000) || snapshot.depreciationYears !== null || (snapshot.taxDeductiblePercentage !== null && (typeof snapshot.taxDeductiblePercentage !== 'number' || !Number.isFinite(snapshot.taxDeductiblePercentage) || snapshot.taxDeductiblePercentage < 0 || snapshot.taxDeductiblePercentage > 100))) fail('Ungültiger vollständiger Snapshotkontext.');
    if (manualRecordAmount(snapshot.amount, true) !== snapshot.amount || manualRecordAmount(snapshot.originalAmount, true) !== snapshot.originalAmount) fail('Nichtkanonischer Centbetrag im Snapshot.');
    if (snapshot.customer !== null) {
      const customer = record(snapshot.customer); closed(customer, ['name', 'contactPerson', 'email', 'address', 'zipCode', 'city', 'taxNumber'], 'Kundensnapshot');
      if (typeof customer.name !== 'string' || customer.name.length > 10000 || Object.entries(customer).some(([key, value]) => key !== 'name' && !nullableText(value, 10000))) fail('Ungültiger Kundensnapshot.');
    }
    const original = record(snapshot.original); closed(original, ['status', 'fileName', 'sha256', 'byteCount'], 'Originalbindung');
    if (original.status === 'NONE') { if (original.fileName !== null || original.sha256 !== null || original.byteCount !== null) fail('Explizit kein Original muss vollständig leer sein.'); }
    else if (original.status !== 'ARCHIVED' || !nullableText(original.fileName, 10000) || !MANUAL_RECORD_SHA256.test(String(original.sha256)) || !Number.isSafeInteger(original.byteCount) || Number(original.byteCount) <= 0 || Number(original.byteCount) > 25 * 1024 * 1024) fail('Ungültige Originalbindung.');
    if (row.kind === 'income' && (original.status !== 'NONE' || snapshot.category !== null || snapshot.taxDeductiblePercentage !== null || snapshot.receiptUrl !== null || snapshot.depreciationYears !== null)) fail('Einnahmen unterstützen keine archivierte Originalbindung oder ausgabenspezifischen Kontext.');
    if (row.kind === 'expense' && snapshot.customer !== null) fail('Ausgaben unterstützen keinen eingefrorenen Einnahmen-Kundenkontext.');
    if (row.operation === 'FINALIZE' ? row.reason !== null : typeof row.reason !== 'string' || !row.reason.trim() || row.reason !== row.reason.trim() || row.reason.length > 1000) fail('Ungültige Korrekturbegründung.');
    const { incomeId: _incomeId, expenseId: _expenseId, hash, ...evidence } = row; void _incomeId; void _expenseId;
    if (manualRecordEventHash(evidence as unknown as Omit<ManualRecordEventEvidence, 'hash'>) !== hash) fail('Snapshot-/Ereignishash stimmt nicht.');
    return { ...evidence, hash } as unknown as ManualRecordEventEvidence;
  });
  const groups = new Map<string, ManualRecordEventEvidence[]>();
  for (const event of events) groups.set(event.recordId, [...(groups.get(event.recordId) ?? []), event]);
  const cashRows = rows(data, 'cashTransactions'), purchaseRows = rows(data, 'purchaseDocuments'), journalRows = rows(data, 'paymentJournalEvents');
  for (const { row, kind } of allRows) {
    const chain = (groups.get(String(row.manualRecordId)) ?? []).sort((a, b) => a.sequence - b.sequence);
    if (row.manualRecordState !== 'FINALIZED') { if (chain.length) fail('Nicht festgeschriebener Eintrag enthält Verlauf.'); continue; }
    if (!chain.length || chain.length > MAX_MANUAL_RECORD_EVENTS || chain.length > Number(row.manualRecordRevision)) fail('Vollständige Verlaufskette fehlt oder überschreitet das Limit.');
    if (!lifecycleClassification(row, kind, data).owned || !['MANUAL', 'LEGACY_UNKNOWN'].includes(String(row.manualRecordOrigin)) || row.invoiceId != null || row.recurringExpenseId != null || row.scheduledDate != null || row.depreciationYears != null || cashRows.some(cash => (kind === 'income' ? cash.incomeId : cash.expenseId) === row.id) || purchaseRows.some(source => kind === 'expense' && source.expenseId === row.id) || journalRows.some(source => kind === 'income' && source.incomeId === row.id)) fail('Ausgeschlossener Quell-, Serien-, Kassen- oder AfA-Eintrag wurde festgeschrieben.');
    const root = chain[0].snapshot;
    if (chain[0].operation !== 'FINALIZE' || chain[0].previousHash !== null || root.originalAmount !== root.amount || (row.manualRecordOrigin === 'LEGACY_UNKNOWN' && !root.legacyManualDeclaration)) fail('Ungültiger Original- oder Erklärungsnachweis.');
    for (const [index, event] of chain.entries()) {
      if (event.sequence !== index + 1 || (index > 0 && (event.operation !== 'CORRECT_AMOUNT' || event.previousHash !== chain[index - 1].hash || event.snapshot.amount === chain[index - 1].snapshot.amount))) fail('Lücke, abweichender Vorfahr oder wirkungslose Betragskorrektur.');
      const { amount: _a, ...base } = root, { amount: _b, ...context } = event.snapshot; void _a; void _b;
      if (manualRecordHash(base) !== manualRecordHash(context)) fail('Eine Betragskorrektur verändert eingefrorenen Kontext.');
    }
    const head = chain.at(-1)!.snapshot;
    if (manualRecordAmount(row.amount) !== head.amount || row.description !== root.description || dateIso(row.date) !== root.date || row.taxRelevant !== root.taxRelevant || (kind === 'income' && (row.customerId == null) !== (root.customer === null))) fail('Wirksame Projektion widerspricht dem unveränderlichen Verlauf.');
    if (kind === 'expense' && ((row.category ?? null) !== root.category || (row.taxDeductiblePercentage ?? null) !== root.taxDeductiblePercentage || (row.receiptUrl ?? null) !== root.receiptUrl || (row.receiptFileName ?? null) !== root.original.fileName || (root.original.status === 'ARCHIVED') !== (typeof row.storedReceiptFileName === 'string' && row.storedReceiptFileName.length > 0))) fail('Ausgabenkontext oder Originalbindung widerspricht dem Verlauf.');
  }
  return events;
}
export function validateManualRecordOriginalManifest(data: Data, fileManifest: Array<{ kind: string; sourceName: string; sha256: string; bytes: number; zipPath?: string }>, requireFiles: boolean): void {
  const events = rows(data, 'manualFinancialRecordEvents');
  for (const expense of rows(data, 'expenses').filter(row => row.manualRecordState === 'FINALIZED')) {
    const root = events.find(event => event.recordId === expense.manualRecordId && event.sequence === 1)?.snapshot as ManualRecordSnapshot | undefined;
    if (root?.original.status !== 'ARCHIVED') continue;
    const file = fileManifest.find(entry => entry.kind === 'receipt' && entry.sourceName === expense.storedReceiptFileName);
    if ((requireFiles && (!file || !file.zipPath)) || (file && (file.sha256 !== root.original.sha256 || file.bytes !== root.original.byteCount))) fail('Festgeschriebenes Original benötigt eine exakt hashgebundene ZIP-Datei; JSON enthält nur Metadaten.');
  }
}
type Client = Pick<Prisma.TransactionClient, 'income' | 'expense' | 'manualFinancialRecordEvent' | 'customer'>;
type RestorePlan = { income: Map<number, number>; expense: Map<number, number>; originals: Map<string, { storedName: string; sha256: string; bytes: number }> };
function projection(row: Row, kind: string, customer: Row | null) {
  return { description: row.description, amount: row.amount, date: dateIso(row.date), taxRelevant: row.taxRelevant,
    ...(Object.fromEntries(FIELDS.map(key => [key, row[key]]))),
    ...(kind === 'income' ? { customer: customer ? Object.fromEntries(['name', 'contactPerson', 'email', 'address', 'zipCode', 'city', 'taxNumber'].map(key => [key, customer[key] ?? null])) : null, invoiceLinked: row.invoiceId != null }
      : Object.fromEntries(['category', 'receiptUrl', 'taxDeductiblePercentage', 'receiptFileName', 'depreciationYears', 'scheduledDate'].map(key => [key, row[key] ?? null]))) };
}
/** Identity-only exact replay. Older/newer/divergent ancestors never merge and never duplicate finances. */
export async function preflightManualRecordRestore(client: Client, userId: string, data: Data, schemaVersion: string | undefined, overwrite: boolean, hasFiles: boolean): Promise<RestorePlan> {
  const events = manualRecordEventsFromBackup(data, schemaVersion);
  const historicalFinance = !supportsManualFinancialRecords(schemaVersion) && (rows(data, 'incomes').length > 0 || rows(data, 'expenses').length > 0);
  const hasFinalizedTarget = (overwrite || historicalFinance) && (await client.manualFinancialRecordEvent.count({ where: { userId } }) > 0 || await client.income.count({ where: { userId, manualRecordState: 'FINALIZED' } }) > 0 || await client.expense.count({ where: { userId, manualRecordState: 'FINALIZED' } }) > 0);
  if (overwrite && hasFinalizedTarget) fail('Überschreiben darf bestehenden Festschreibungsverlauf niemals löschen. Bitte zusammenführen oder ein leeres Ziel verwenden.');
  if (historicalFinance && hasFinalizedTarget) fail('Dieses ältere Finanzbackup enthält keine portablen Eintragsidentitäten. Zusammenführen mit festgeschriebenen manuellen Zieleinträgen könnte Geldbeträge duplizieren. Bitte in ein separates leeres Ziel wiederherstellen und prüfen; kein unscharfer Betrags-/Datums-/Namensabgleich.');
  const plan: RestorePlan = { income: new Map(), expense: new Map(), originals: new Map() };
  if (!supportsManualFinancialRecords(schemaVersion)) return plan;
  const sourceCustomers = new Map(rows(data, 'customers').map(row => [row.id, row]));
  for (const kind of ['income', 'expense'] as const) for (const source of rows(data, kind === 'income' ? 'incomes' : 'expenses')) {
    const portableId = String(source.manualRecordId);
    const [income, expense] = await Promise.all([client.income.findUnique({ where: { manualRecordId: portableId } }), client.expense.findUnique({ where: { manualRecordId: portableId } })]);
    const target = kind === 'income' ? income : expense, wrongKind = kind === 'income' ? expense : income;
    if (!lifecycleClassification(source, kind, data).owned) {
      // Excluded rows carry no manual history (the strict parser above rejects
      // it). An origin/source spoof must still never sidestep an existing
      // finalized manual identity, including a foreign owner's root.
      if (target?.manualRecordState === 'FINALIZED' || wrongKind?.manualRecordState === 'FINALIZED'
        || await client.manualFinancialRecordEvent.count({ where: { recordId: portableId } }) > 0) fail('Ausgeschlossene Quellzeile kollidiert mit einer festgeschriebenen manuellen Identität oder deren Verlauf.');
      continue;
    }
    if (wrongKind || (target && target.userId !== userId)) fail('Portable Identität gehört zu einem anderen Eintrag oder Mandanten.');
    const sourceEvents = events.filter(event => event.recordId === portableId).sort((a, b) => a.sequence - b.sequence);
    if (!target) {
      if (sourceEvents.length) {
        const collisions = await client.manualFinancialRecordEvent.count({ where: { OR: [{ id: { in: sourceEvents.map(event => event.id) } }, { userId, mutationId: { in: sourceEvents.map(event => event.mutationId) } }] } });
        if (collisions) fail('Ereignis-/Vorgangsidentität kollidiert mit anderem Zielverlauf.');
        if (sourceEvents[0].snapshot.original.status === 'ARCHIVED' && !hasFiles) fail('Neuer festgeschriebener Originalbezug erfordert ein vollständiges ZIP-Backup; JSON-Metadaten reichen nicht.');
      }
      continue;
    }
    if (overwrite) continue; // No finalized target can reach this branch; ordinary overwrite retains its old semantics.
    const sourceCustomer = kind === 'income' && source.customerId != null ? sourceCustomers.get(source.customerId) ?? null : null;
    const targetCustomer = 'customerId' in target && target.customerId !== null ? await client.customer.findFirst({ where: { id: target.customerId, userId } }) : null;
    if (manualRecordHash(projection(source, kind, sourceCustomer)) !== manualRecordHash(projection(target as unknown as Row, kind, targetCustomer as unknown as Row | null))) fail('Gleiche portable Identität hat eine abweichende wirksame Projektion. Kein unscharfer Betrags-/Namensabgleich.');
    const targetEvents = await client.manualFinancialRecordEvent.findMany({ where: { userId, recordId: portableId }, orderBy: { sequence: 'asc' }, take: MAX_MANUAL_RECORD_EVENTS + 1 });
    if (targetEvents.length !== sourceEvents.length || targetEvents.some((event, index) => event.id !== sourceEvents[index].id || event.hash !== sourceEvents[index].hash || manualRecordHash(event.snapshot) !== manualRecordHash(sourceEvents[index].snapshot) || event.mutationId !== sourceEvents[index].mutationId || event.semanticHash !== sourceEvents[index].semanticHash || event.createdAt.toISOString() !== sourceEvents[index].createdAt || event.reason !== sourceEvents[index].reason || event.previousHash !== sourceEvents[index].previousHash || event.operation !== sourceEvents[index].operation || event.sequence !== sourceEvents[index].sequence || event.kind !== kind)) fail('Zielverlauf ist älter, neuer oder abweichend. #54a erlaubt nur die exakt gleiche vollständige Kette; keine Vorfahren-Zusammenführung.');
    plan[kind].set(Number(source.id), target.id);
    const bound = sourceEvents[0]?.snapshot.original;
    if (bound?.status === 'ARCHIVED') {
      if (!('storedReceiptFileName' in target) || !target.storedReceiptFileName) fail('Gebundenes Zieloriginal fehlt.');
      await readManualRecordOriginal(userId, target.storedReceiptFileName, bound);
      plan.originals.set(String(source.storedReceiptFileName), { storedName: target.storedReceiptFileName, sha256: bound.sha256!, bytes: bound.byteCount! });
    }
  }
  return plan;
}
export function restoredManualRecordMetadata(row: Row, kind: 'income' | 'expense', data: Data, schemaVersion?: string) {
  if (supportsManualFinancialRecords(schemaVersion)) {
    const classification = lifecycleClassification(row, kind, data);
    return { ...(classification.owned ? { manualRecordId: String(row.manualRecordId) } : {}), manualRecordState: String(row.manualRecordState), manualRecordOrigin: classification.origin, manualRecordRevision: Number(row.manualRecordRevision) };
  }
  // Historical backups remain unreviewed. Only knowable source relations classify origin.
  const origin = kind === 'income'
    ? rows(data, 'paymentJournalEvents').some(event => event.incomeId === row.id) ? 'PAYMENT_JOURNAL' : row.invoiceId != null ? 'INVOICE' : rows(data, 'cashTransactions').some(cash => cash.incomeId === row.id) ? 'CASHBOOK' : 'LEGACY_UNKNOWN'
    : rows(data, 'purchaseDocuments').some(source => source.expenseId === row.id) ? 'PURCHASE_DOCUMENT' : row.recurringExpenseId != null || row.scheduledDate != null ? 'RECURRING' : rows(data, 'cashTransactions').some(cash => cash.expenseId === row.id) ? 'CASHBOOK' : 'LEGACY_UNKNOWN';
  return { manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: origin, manualRecordRevision: 0 };
}
export async function restoreManualRecordEvents(tx: Prisma.TransactionClient, userId: string, events: ManualRecordEventEvidence[], incomeMap: Map<number, number>, expenseMap: Map<number, number>, source: Data): Promise<void> {
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const row = rows(source, event.kind === 'income' ? 'incomes' : 'expenses').find(row => row.manualRecordId === event.recordId)!;
    const targetId = (event.kind === 'income' ? incomeMap : expenseMap).get(Number(row.id));
    if (!targetId) fail('Eintrags-ID konnte nicht mandantensicher remappt werden.');
    const existing = await tx.manualFinancialRecordEvent.findUnique({ where: { id: event.id } });
    if (existing) { if (existing.userId !== userId || existing.hash !== event.hash || (event.kind === 'income' ? existing.incomeId : existing.expenseId) !== targetId) fail('Abweichende Ereignisidentität im Ziel.'); continue; }
    await tx.manualFinancialRecordEvent.create({ data: { ...event, userId, createdAt: new Date(event.createdAt), snapshot: event.snapshot as unknown as Prisma.InputJsonValue, incomeId: event.kind === 'income' ? targetId : null, expenseId: event.kind === 'expense' ? targetId : null } });
  }
}
