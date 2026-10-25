import type { ManualFinancialRecordDto, ManualFinancialRecordKind, ManualFinancialRecordMutation, ManualFinancialRecordState } from '@/lib/manual-financial-record-contract';

export const MANUAL_HISTORY_LIMIT = 256;
const amountPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u;
const hashPattern = /^[a-f\d]{64}$/u;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu;

export function correctionAmount(input: string): string {
  const amount = input.trim().replace(',', '.');
  if (!amountPattern.test(amount)) throw new Error('Bitte einen nicht negativen EUR-Betrag mit höchstens zwei Nachkommastellen eingeben.');
  const [whole, fraction = ''] = amount.split('.');
  const canonical = `${whole}.${fraction.padEnd(2, '0')}`;
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Der Betrag liegt außerhalb des sicher darstellbaren Bereichs.');
  return canonical;
}
export function isUnchangedCorrection(input: string, current: string | null): boolean {
  return current !== null && correctionAmount(input) === correctionAmount(current);
}
/** A stale local observation can never weaken a fresh finalized list state. */
export function protectedManualRecordState(list: ManualFinancialRecordState | undefined, observed: ManualFinancialRecordState | undefined): ManualFinancialRecordState | undefined {
  return list === 'FINALIZED' || observed === 'FINALIZED' ? 'FINALIZED' : list;
}
export function recordStorageKey(session: string, kind: ManualFinancialRecordKind, id: number): string {
  return `bivaro:manual-record:pending:v1:${encodeURIComponent(session)}:${kind}:${id}`;
}
export type PendingIdentity = Pick<ManualFinancialRecordMutation, 'mutationId' | 'operation' | 'expectedRevision' | 'fingerprint'>;
export function pendingIdentity(command: ManualFinancialRecordMutation): PendingIdentity {
  const { mutationId, operation, expectedRevision, fingerprint } = command;
  return { mutationId, operation, expectedRevision, fingerprint };
}
export function readPendingIdentity(raw: string | null): PendingIdentity | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const item = value as PendingIdentity;
    return uuidPattern.test(item.mutationId) && ['FINALIZE', 'CORRECT_AMOUNT'].includes(item.operation) && Number.isSafeInteger(item.expectedRevision) && item.expectedRevision >= 0 && hashPattern.test(item.fingerprint) ? pendingIdentity(item as ManualFinancialRecordMutation) : null;
  } catch { return null; }
}
/** Increment for EVERY input event, even when the value returns to an old value. */
export function createDraftClock() {
  let generation = 0; let cleanGeneration = 0;
  return {
    edit: () => ++generation,
    snapshot: () => generation,
    isDirty: () => generation !== cleanGeneration,
    canAdopt: (startedAt: number) => generation === startedAt && generation === cleanGeneration,
    markClean: (submittedAt: number) => { if (generation === submittedAt) { cleanGeneration = generation; return true; } return false; },
  };
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value: unknown, max = 4000): value is string { return typeof value === 'string' && value.length <= max; }
function nullableString(value: unknown, max?: number) { return value === null || bounded(value, max); }
/** A malformed/lost success is uncertain, never a saved confirmation. */
export function readManualRecordResponse(value: unknown, kind: ManualFinancialRecordKind, id: number): ManualFinancialRecordDto {
  const record = object(value) ? value.record : undefined;
  if (!object(record) || record.contractVersion !== 1 || record.kind !== kind || record.id !== id || !bounded(record.recordId, 80) || !['LEGACY_UNREVIEWED', 'RECORDED', 'FINALIZED'].includes(String(record.state)) || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0 || !bounded(record.fingerprint, 64) || !hashPattern.test(record.fingerprint) || !bounded(record.description) || !bounded(record.origin, 200) || !bounded(record.paymentDate, 40) || !/^\d{4}-\d{2}-\d{2}/u.test(record.paymentDate) || !(record.effectiveAmount === null || (bounded(record.effectiveAmount, 40) && amountPattern.test(record.effectiveAmount))) || record.currency !== 'EUR' || typeof record.canFinalize !== 'boolean' || typeof record.canCorrectAmount !== 'boolean' || typeof record.requiresLegacyDeclaration !== 'boolean' || !nullableString(record.readOnlyReason) || !object(record.original) || !['NONE', 'ARCHIVED', 'UNVERIFIED'].includes(String(record.original.status)) || !nullableString(record.original.fileName) || !(record.original.sha256 === null || (bounded(record.original.sha256, 64) && hashPattern.test(record.original.sha256))) || !(record.original.byteCount === null || (Number.isSafeInteger(record.original.byteCount) && Number(record.original.byteCount) >= 0)) || !Array.isArray(record.history) || record.history.length > MANUAL_HISTORY_LIMIT) throw new Error('Keine verlässlichen Datensatzdetails erhalten. Bitte den Nachweis erneut laden.');
  for (const entry of record.history) {
    if (!object(entry) || !bounded(entry.id, 80) || !Number.isSafeInteger(entry.sequence) || Number(entry.sequence) < 1 || !['FINALIZE', 'CORRECT_AMOUNT'].includes(String(entry.operation)) || !bounded(entry.mutationId, 36) || !uuidPattern.test(entry.mutationId) || !bounded(entry.amount, 40) || !amountPattern.test(entry.amount) || !bounded(entry.originalAmount, 40) || !amountPattern.test(entry.originalAmount) || !bounded(entry.paymentDate, 40) || !bounded(entry.description) || !nullableString(entry.reason, 1000) || !bounded(entry.createdAt, 40) || !bounded(entry.hash, 64) || !hashPattern.test(entry.hash) || !(entry.previousHash === null || (bounded(entry.previousHash, 64) && hashPattern.test(entry.previousHash)))) throw new Error('Der vollständige Verlauf konnte nicht bestätigt werden. Bitte erneut laden.');
  }
  return record as ManualFinancialRecordDto;
}
export function hasConfirmedMutation(record: ManualFinancialRecordDto, identity: PendingIdentity): boolean {
  return record.state === 'FINALIZED' && record.history.some(entry => entry.mutationId === identity.mutationId && entry.operation === identity.operation);
}
export class ManualRecordRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); }
}
export function manualRecordFailure(code: string | null, status: number): string {
  switch (code) {
    case 'FINALIZED_RECORD': return 'Dieser Datensatz ist bereits festgeschrieben. Bitte Original und Verlauf erneut laden.';
    case 'MANUAL_RECORD_STALE': return 'Der Datensatz wurde zwischenzeitlich geändert. Eingaben bleiben erhalten; aktuelle Details laden und erneut prüfen.';
    case 'MANUAL_RECORD_UNSUPPORTED': return 'Dieser Datensatz gehört zu einem anderen Quell- oder Buchungsablauf. Keine manuelle Festschreibung oder Korrektur möglich.';
    case 'MANUAL_RECORD_MUTATION_CONFLICT': return 'Diese Anfragekennung gehört zu anderen Daten. Keine neue Anfrage senden; den gespeicherten Verlauf prüfen.';
    case 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE': return 'Das unveränderte Original ist nicht verlässlich verfügbar. Festschreibung/Korrektur nicht bestätigt.';
    case 'MANUAL_RECORD_HISTORY_LIMIT': return 'Die Grenze des vollständigen Verlaufs ist erreicht. Keine weitere Korrektur möglich.';
    default: return status === 404 ? 'Datensatz nicht gefunden oder nicht mehr zugänglich.' : status === 400 ? 'Betrag, Begründung oder Altbestand-Erklärung prüfen. Es wurde keine Änderung bestätigt.' : 'Keine verlässliche Speicherbestätigung. Die Anfragekennung bleibt für die Nachweisprüfung erhalten.';
  }
}
async function responseJson(response: Response): Promise<unknown> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('Die Serverantwort konnte nicht verlässlich gelesen werden. Bitte den Nachweis prüfen.'); }
  if (!response.ok) {
    const code = object(value) && typeof value.code === 'string' ? value.code : null;
    throw new ManualRecordRequestError(manualRecordFailure(code, response.status), response.status, code);
  }
  return value;
}
export async function loadManualRecord(kind: ManualFinancialRecordKind, id: number, signal: AbortSignal) {
  const response = await fetch(`/api/manual-financial-records?${new URLSearchParams({ kind, id: String(id) })}`, { cache: 'no-store', signal });
  return readManualRecordResponse(await responseJson(response), kind, id);
}
export async function saveManualRecord(command: ManualFinancialRecordMutation, signal: AbortSignal) {
  const response = await fetch('/api/manual-financial-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal });
  const record = readManualRecordResponse(await responseJson(response), command.kind, command.id);
  if (!hasConfirmedMutation(record, command)) throw new Error('Die Speicherbestätigung enthält den angefragten Verlaufseintrag nicht. Bitte den Nachweis prüfen.');
  return record;
}

// Memory only: correction reasons/amounts are never written to browser storage.
// A reload can recover the UUID through GET, but cannot invent a replacement body.
const commands = new Map<string, ManualFinancialRecordMutation>();
export function rememberCommand(key: string, command: ManualFinancialRecordMutation) { commands.set(key, command); }
export function rememberedCommand(key: string) { return commands.get(key) ?? null; }
export function forgetCommand(key: string) { commands.delete(key); }
