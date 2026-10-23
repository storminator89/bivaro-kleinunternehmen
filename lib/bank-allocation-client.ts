import { BANK_IMPORT_HASH, BANK_IMPORT_UUID, type BankImportEvidence } from '@/lib/bank-import-contract';
import { BankAllocationError, parseBankAllocationSearchInput, parseBankRecordPaymentInput, parseBankReallocationInput,
  type BankAllocationInvoice, type BankAllocationOperationReceipt, type BankAllocationPreflight, type BankAllocationRecovery,
  type BankAllocationResult, type BankAllocationRowEnvelope, type BankAllocationSearchInput,
  type BankCurrentAssignment, type BankRecordPaymentInput, type BankReallocationInput } from '@/lib/bank-allocation-contract';
import { parseBusinessDate } from '@/lib/business-date';

const invalid = (): never => { throw new BankAllocationError('Der Zuordnungsstand konnte nicht sicher geprüft werden. Bitte erneut laden.', 502, 'BANK_ALLOCATION_RESPONSE_INVALID'); };
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function text(value: unknown, max = 255, empty = false): string { if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)) return invalid(); return value; }
function id(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(); return value; }
function revision(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid(); return value; }
function uuid(value: unknown): string { if (typeof value !== 'string' || !BANK_IMPORT_UUID.test(value)) return invalid(); return value; }
function hash(value: unknown): string { if (typeof value !== 'string' || !BANK_IMPORT_HASH.test(value)) return invalid(); return value; }
function cents(value: unknown, positive = false): string { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})$/u.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER) || (positive && value === '0')) return invalid(); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function instant(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value) return invalid(); return value; }
function date(value: unknown): string { try { parseBusinessDate(value); } catch { return invalid(); } return value as string; }
function strings(value: unknown): string[] { if (!Array.isArray(value) || value.length > 40) return invalid(); return value.map(item => text(item, 2000)); }
function evidenceText(value: unknown, max: number): string { if (typeof value !== 'string' || value.length > max) return invalid(); return value; }
function evidenceOf(value: unknown): BankImportEvidence {
  const evidence = record(value), fields = ['rowNumber', 'date', 'amountCents', 'currency', 'reference', 'counterparty', 'externalId', 'errors', 'warnings', 'duplicateWarnings', 'duplicate', 'priorMatches'];
  if (Object.keys(evidence).some(key => !fields.includes(key))) return invalid();
  const matches = record(evidence.priorMatches);
  if (Object.keys(matches).some(key => !['external', 'content', 'dayAmount'].includes(key))) return invalid();
  if (evidence.amountCents !== null && (typeof evidence.amountCents !== 'string' || !/^-?(?:0|[1-9]\d{0,15})$/u.test(evidence.amountCents))) return invalid();
  return { rowNumber: id(evidence.rowNumber), date: evidence.date === null ? null : date(evidence.date), amountCents: evidence.amountCents as string | null,
    currency: evidence.currency === null ? null : evidenceText(evidence.currency, 16), reference: evidenceText(evidence.reference, 2000), counterparty: evidenceText(evidence.counterparty, 255), externalId: evidenceText(evidence.externalId, 255),
    errors: strings(evidence.errors), warnings: strings(evidence.warnings), duplicateWarnings: strings(evidence.duplicateWarnings), duplicate: bool(evidence.duplicate),
    priorMatches: { external: revision(matches.external), content: revision(matches.content), dayAmount: revision(matches.dayAmount) } };
}
function invoiceOf(value: unknown): BankAllocationInvoice {
  const invoice = record(value);
  const result = { invoiceId: id(invoice.invoiceId), invoiceNumber: text(invoice.invoiceNumber), customerName: text(invoice.customerName, 255, true), ledgerVersion: hash(invoice.ledgerVersion), totalCents: cents(invoice.totalCents, true), paidCents: cents(invoice.paidCents), openCents: cents(invoice.openCents) };
  if (BigInt(result.paidCents) + BigInt(result.openCents) > BigInt(result.totalCents)) return invalid();
  return result;
}
function assignmentOf(value: unknown): BankCurrentAssignment {
  const assignment = record(value);
  if (assignment.currency !== 'EUR') return invalid();
  const result: BankCurrentAssignment = { bindingStableKey: uuid(assignment.bindingStableKey), originalPaymentId: id(assignment.originalPaymentId), originInvoiceId: id(assignment.originInvoiceId), originInvoiceNumber: text(assignment.originInvoiceNumber),
    allocatedInvoice: invoiceOf(assignment.allocatedInvoice), allocationRevision: revision(assignment.allocationRevision), allocationChangeStableKey: assignment.allocationChangeStableKey === null ? null : uuid(assignment.allocationChangeStableKey), amountCents: cents(assignment.amountCents, true), currency: 'EUR', paidAt: instant(assignment.paidAt), canReallocate: bool(assignment.canReallocate), reallocationReviewReason: assignment.reallocationReviewReason === null ? null : text(assignment.reallocationReviewReason, 2000) };
  if ((result.allocationRevision === 0) !== (result.allocationChangeStableKey === null) || result.canReallocate === (result.reallocationReviewReason !== null)) return invalid();
  return result;
}
export function readBankAllocationRowEnvelope(value: unknown, expectedRowStableKey?: string): BankAllocationRowEnvelope {
  const row = record(value);
  if (!['UNASSIGNED', 'ASSIGNED', 'REVIEW_REQUIRED'].includes(String(row.assignmentState))) return invalid();
  const result: BankAllocationRowEnvelope = { rowStableKey: uuid(row.rowStableKey), evidence: evidenceOf(row.evidence), rowEvidenceHash: hash(row.rowEvidenceHash),
    assignmentState: row.assignmentState as BankAllocationRowEnvelope['assignmentState'], bindingStableKey: row.bindingStableKey === null ? null : uuid(row.bindingStableKey),
    assignmentReviewReason: row.assignmentReviewReason === null ? null : text(row.assignmentReviewReason, 2000), assignment: row.assignment === null ? null : assignmentOf(row.assignment) };
  if (result.assignmentState === 'UNASSIGNED' ? result.assignment !== null || result.bindingStableKey !== null || result.assignmentReviewReason !== null
    : result.assignmentState === 'ASSIGNED' ? !result.assignment || result.bindingStableKey !== result.assignment.bindingStableKey || result.assignmentReviewReason !== null
    : result.assignment !== null || !result.bindingStableKey || !result.assignmentReviewReason) return invalid();
  if (expectedRowStableKey !== undefined && result.rowStableKey !== expectedRowStableKey) return invalid();
  return result;
}
function operationOf(value: unknown): BankAllocationOperationReceipt {
  const operation = record(value);
  if (operation.currency !== 'EUR') return invalid();
  const shared = { idempotencyKey: uuid(operation.idempotencyKey), bindingStableKey: uuid(operation.bindingStableKey), amountCents: cents(operation.amountCents, true), currency: 'EUR' as const, recordedAt: instant(operation.recordedAt) };
  if (operation.kind === 'BANK_PAYMENT_RECORDED') return { ...shared, kind: operation.kind, rowStableKey: uuid(operation.rowStableKey), originalPaymentId: id(operation.originalPaymentId), originInvoiceId: id(operation.originInvoiceId), originInvoiceNumber: text(operation.originInvoiceNumber), paidAt: instant(operation.paidAt), expectedLedgerVersion: hash(operation.expectedLedgerVersion), expectedRowEvidenceHash: hash(operation.expectedRowEvidenceHash) };
  if (operation.kind !== 'PAYMENT_ALLOCATION_CHANGED') return invalid();
  const result = { ...shared, kind: 'PAYMENT_ALLOCATION_CHANGED' as const, changeStableKey: uuid(operation.changeStableKey), revision: id(operation.revision), fromInvoiceId: id(operation.fromInvoiceId), fromInvoiceNumber: text(operation.fromInvoiceNumber), toInvoiceId: id(operation.toInvoiceId), toInvoiceNumber: text(operation.toInvoiceNumber), actionDate: date(operation.actionDate), reason: text(operation.reason, 1000), expectedSourceLedgerVersion: hash(operation.expectedSourceLedgerVersion), expectedTargetLedgerVersion: hash(operation.expectedTargetLedgerVersion) };
  if (result.fromInvoiceId === result.toInvoiceId) return invalid();
  return result;
}
function checkedRecovery(value: unknown, rowStableKey?: string, key?: string): BankAllocationRecovery {
  const input = record(value), row = readBankAllocationRowEnvelope(input.row, rowStableKey), operation = input.operation === null ? null : operationOf(input.operation);
  if (operation && (key !== undefined && operation.idempotencyKey !== key || row.bindingStableKey !== operation.bindingStableKey)) return invalid();
  if (operation?.kind === 'BANK_PAYMENT_RECORDED' && (operation.rowStableKey !== row.rowStableKey || row.assignment !== null && operation.originalPaymentId !== row.assignment.originalPaymentId)) return invalid();
  return { row, operation };
}
export function readBankAllocationPreflight(value: unknown): BankAllocationPreflight {
  const input = record(value);
  if (input.version !== 1 || !Array.isArray(input.invoices) || input.invoices.length > 20) return invalid();
  const result: BankAllocationPreflight = { version: 1, row: readBankAllocationRowEnvelope(input.row), invoices: input.invoices.map(invoiceOf), nextCursor: input.nextCursor === null ? null : id(input.nextCursor), selection: input.selection === null ? null : invoiceOf(input.selection), canConfirm: bool(input.canConfirm), reviewReasons: strings(input.reviewReasons), afterOpenCents: input.afterOpenCents === null ? null : cents(input.afterOpenCents), sourceAfterOpenCents: input.sourceAfterOpenCents === null ? null : cents(input.sourceAfterOpenCents) };
  if (result.row.assignmentState === 'UNASSIGNED' && result.sourceAfterOpenCents !== null || result.canConfirm && result.row.assignmentState === 'ASSIGNED' && result.sourceAfterOpenCents === null) return invalid();
  if (new Set(result.invoices.map(invoice => invoice.invoiceId)).size !== result.invoices.length || result.canConfirm && (!result.selection || result.reviewReasons.length > 0 || result.afterOpenCents === null || result.row.assignmentState === 'REVIEW_REQUIRED')) return invalid();
  return result;
}
async function response(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (!response.ok) { const error = record(value); throw new BankAllocationError(typeof error.error === 'string' ? error.error : 'Die Zuordnung konnte nicht bestätigt werden.', response.status, typeof error.code === 'string' ? error.code : 'BANK_ALLOCATION_FAILED'); }
  return value;
}
const rowPath = (row: string) => `/api/bank-imports/rows/${uuid(row)}/allocation`;
const bindingPath = (binding: string) => `/api/bank-allocations/${uuid(binding)}`;
function send(path: string, body: unknown, signal: AbortSignal, fetcher: typeof fetch) { return fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bivaro-Payment-Contract': '3' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body), signal }).then(response); }
function get(path: string, signal: AbortSignal, fetcher: typeof fetch) { return fetcher(path, { method: 'GET', headers: { 'X-Bivaro-Payment-Contract': '3' }, credentials: 'same-origin', cache: 'no-store', signal }).then(response); }
export async function loadBankAllocationPreflight(row: string, input: Partial<BankAllocationSearchInput>, signal: AbortSignal, fetcher: typeof fetch = fetch) { return readBankAllocationPreflight(await send(`${rowPath(row)}/preflight`, parseBankAllocationSearchInput(input), signal, fetcher)); }
export async function loadBankReallocationPreflight(binding: string, input: Partial<BankAllocationSearchInput>, signal: AbortSignal, fetcher: typeof fetch = fetch) { return readBankAllocationPreflight(await send(`${bindingPath(binding)}/preflight`, parseBankAllocationSearchInput(input), signal, fetcher)); }
export async function recoverBankPayment(row: string, key: string | null, signal: AbortSignal, fetcher: typeof fetch = fetch) { return checkedRecovery(await get(`${rowPath(row)}${key ? `?idempotencyKey=${uuid(key)}` : ''}`, signal, fetcher), row, key ?? undefined); }
export async function recoverBankReallocation(binding: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const result = checkedRecovery(await get(`${bindingPath(binding)}/changes?idempotencyKey=${uuid(key)}`, signal, fetcher), undefined, key);
  if (result.row.bindingStableKey !== binding) return invalid(); return result;
}
async function result(value: unknown, key: string, expectedRow?: string): Promise<BankAllocationResult> {
  const input = record(value), recovery = checkedRecovery(value, expectedRow, key);
  if (!recovery.operation) return invalid(); return { ...recovery, operation: recovery.operation, replayed: bool(input.replayed) };
}
export async function recordBankPayment(row: string, input: BankRecordPaymentInput, signal: AbortSignal, fetcher: typeof fetch = fetch) { const saved = await result(await send(rowPath(row), parseBankRecordPaymentInput(input), signal, fetcher), input.idempotencyKey, row); const operation = saved.operation; if (operation.kind !== 'BANK_PAYMENT_RECORDED' || operation.originInvoiceId !== input.invoiceId || operation.expectedLedgerVersion !== input.expectedLedgerVersion || operation.expectedRowEvidenceHash !== input.expectedRowEvidenceHash) return invalid(); return saved; }
export async function reallocateBankPayment(binding: string, input: BankReallocationInput, signal: AbortSignal, fetcher: typeof fetch = fetch) { const saved = await result(await send(`${bindingPath(binding)}/changes`, parseBankReallocationInput(input), signal, fetcher), input.idempotencyKey); const operation = saved.operation; if (saved.row.bindingStableKey !== binding || operation.kind !== 'PAYMENT_ALLOCATION_CHANGED' || operation.toInvoiceId !== input.invoiceId || operation.revision !== input.expectedAllocationRevision + 1 || operation.expectedSourceLedgerVersion !== input.expectedSourceLedgerVersion || operation.expectedTargetLedgerVersion !== input.expectedTargetLedgerVersion || operation.actionDate !== input.actionDate || operation.reason !== input.reason.normalize('NFC').trim()) return invalid(); return saved; }
/** The caller retains the SAME in-memory payload/key while an outcome is unknown. No storage and no automatic POST on reload. */
export async function resolveBankPayment(row: string, input: BankRecordPaymentInput, uncertain: boolean, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankAllocationResult> {
  if (uncertain) { const recovered = await recoverBankPayment(row, input.idempotencyKey, signal, fetcher); if (recovered.operation) { if (recovered.operation.kind !== 'BANK_PAYMENT_RECORDED' || recovered.operation.originInvoiceId !== input.invoiceId || recovered.operation.expectedLedgerVersion !== input.expectedLedgerVersion || recovered.operation.expectedRowEvidenceHash !== input.expectedRowEvidenceHash) return invalid(); return { ...recovered, operation: recovered.operation, replayed: true }; } }
  return recordBankPayment(row, input, signal, fetcher);
}
export async function resolveBankReallocation(binding: string, input: BankReallocationInput, uncertain: boolean, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankAllocationResult> {
  if (uncertain) { const recovered = await recoverBankReallocation(binding, input.idempotencyKey, signal, fetcher); if (recovered.operation) { if (recovered.operation.kind !== 'PAYMENT_ALLOCATION_CHANGED' || recovered.operation.toInvoiceId !== input.invoiceId || recovered.operation.expectedSourceLedgerVersion !== input.expectedSourceLedgerVersion || recovered.operation.expectedTargetLedgerVersion !== input.expectedTargetLedgerVersion || recovered.operation.revision !== input.expectedAllocationRevision + 1 || recovered.operation.actionDate !== input.actionDate || recovered.operation.reason !== input.reason.normalize('NFC').trim()) return invalid(); return { ...recovered, operation: recovered.operation, replayed: true }; } }
  return reallocateBankPayment(binding, input, signal, fetcher);
}
