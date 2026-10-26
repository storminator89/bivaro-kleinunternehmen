import { createHash } from 'node:crypto';
import { quoteCreateFingerprintForInvoice, quoteCreatePdfSha256 } from '@/lib/quote-create-request';
import { MAX_INVOICE_UPLOAD_BYTES } from '@/lib/resource-limits';

/** Development contract only: these functions do not grant access or persist a response. */
export const QUOTE_RELEASE_CONTRACT_VERSION = 1;
export const MAX_QUOTE_RELEASE_METADATA_BYTES = 512 * 1024;
export const MAX_QUOTE_RESPONSE_COMMENT_LENGTH = 500;
const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class QuoteReleaseContractError extends Error {
  constructor(message = 'Ungültiger Angebotsfreigabe-Vertrag.') {
    super(message);
    this.name = 'QuoteReleaseContractError';
  }
}
export type QuoteReleaseSnapshot = Readonly<{
  version: 1;
  sourceFingerprint: string;
  originalSha256: string;
  originalBytes: number;
  snapshotSha256: string;
}>;
export type QuoteResponseCommand = Readonly<{
  version: 1;
  requestId: string;
  releaseId: string;
  snapshotSha256: string;
  decision: 'ACCEPT' | 'REJECT';
  comment: string | null;
}>;
export type QuoteResponseReceipt = QuoteResponseCommand & Readonly<{ recordedAt: string }>;
export type QuoteResponseRelease = Readonly<{
  releaseId: string;
  snapshotSha256: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Target-owned, non-restored authority must explicitly confirm this. */
  restoredAccessDisabled: boolean;
}>;
export type QuoteResponsePlan =
  | { kind: 'UNAVAILABLE'; reason: 'RESTORED' | 'REVOKED' | 'EXPIRED' | 'NOT_CURRENT' | 'NOT_YET_ACTIVE' }
  | { kind: 'CONFLICT' }
  | { kind: 'REPLAY'; receipt: QuoteResponseReceipt }
  | { kind: 'APPEND'; receipt: QuoteResponseReceipt };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new QuoteReleaseContractError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw new QuoteReleaseContractError();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new QuoteReleaseContractError();
  return row;
}
function hash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function snapshotHash(sourceFingerprint: string, originalSha256: string, originalBytes: number): string {
  return createHash('sha256').update('bivaro.quote-release.snapshot.v1\0').update(JSON.stringify([sourceFingerprint, originalSha256, originalBytes])).digest('hex');
}

/** Reject JSON coercion/collisions and bound work before using the existing source identity. */
function boundedJson(input: unknown): Json {
  let nodes = 0, bytes = 0;
  function account(text: string) {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_QUOTE_RELEASE_METADATA_BYTES) throw new QuoteReleaseContractError('Angebotsmetadaten sind zu groß.');
  }
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 20_000 || depth > 32) throw new QuoteReleaseContractError('Angebotsmetadaten sind zu komplex.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { account(value); return value; }
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) throw new QuoteReleaseContractError();
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new QuoteReleaseContractError();
        return visit(descriptor.value, depth + 1);
      });
    }
    const row = object(value);
    return Object.fromEntries(Object.entries(row).map(([key, item]) => { account(key); return [key, visit(item, depth + 1)]; }));
  }
  return visit(input, 0);
}

/** Hash exact supplied original bytes, not regenerated PDFs, filenames or mutable workflow state. */
export function createQuoteReleaseSnapshot(source: unknown, original: Uint8Array): QuoteReleaseSnapshot {
  const row = object(source);
  if (row.type !== 'QUOTE' || typeof row.fileName !== 'string' || !row.fileName.trim() || row.fileName.length > 255 || typeof row.invoiceNumber !== 'string' || !row.invoiceNumber.trim() || row.invoiceNumber.length > 255 || /[\u0000-\u001f\u007f]/u.test(row.fileName + row.invoiceNumber) || typeof row.totalAmount !== 'number' || !Number.isFinite(row.totalAmount) || row.totalAmount < 0 || Object.is(row.totalAmount, -0) || !Object.hasOwn(row, 'validUntil') || !(original instanceof Uint8Array) || original.byteLength < 1 || original.byteLength > MAX_INVOICE_UPLOAD_BYTES) throw new QuoteReleaseContractError();
  const date = (value: unknown): string => {
    const text = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value;
    if (!instant(text)) throw new QuoteReleaseContractError('Ungültiger gespeicherter Angebotszeitpunkt.');
    return text;
  };
  const parsedData = boundedJson(row.parsedData);
  if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) throw new QuoteReleaseContractError();
  const sourceFingerprint = quoteCreateFingerprintForInvoice({ fileName: row.fileName, invoiceNumber: row.invoiceNumber, invoiceDate: date(row.invoiceDate), validUntil: row.validUntil === null ? null : date(row.validUntil), totalAmount: row.totalAmount, parsedData });
  const originalSha256 = quoteCreatePdfSha256(original);
  return Object.freeze({ version: 1, sourceFingerprint, originalSha256, originalBytes: original.byteLength, snapshotSha256: snapshotHash(sourceFingerprint, originalSha256, original.byteLength) });
}

/** Shape/integrity check only; a hash is not authentication, provenance or PDF conformity. */
export function parseQuoteReleaseSnapshot(input: unknown): QuoteReleaseSnapshot {
  const row = exact(input, ['version', 'sourceFingerprint', 'originalSha256', 'originalBytes', 'snapshotSha256']);
  if (row.version !== 1 || !hash(row.sourceFingerprint) || !hash(row.originalSha256) || !hash(row.snapshotSha256) || typeof row.originalBytes !== 'number' || !Number.isInteger(row.originalBytes) || row.originalBytes < 1 || row.originalBytes > MAX_INVOICE_UPLOAD_BYTES || snapshotHash(row.sourceFingerprint, row.originalSha256, row.originalBytes) !== row.snapshotSha256) throw new QuoteReleaseContractError();
  return Object.freeze({ version: 1, sourceFingerprint: row.sourceFingerprint, originalSha256: row.originalSha256, originalBytes: row.originalBytes, snapshotSha256: row.snapshotSha256 });
}

export function parseQuoteResponseCommand(input: unknown): QuoteResponseCommand {
  const row = exact(input, ['version', 'requestId', 'releaseId', 'snapshotSha256', 'decision', 'comment']);
  if (row.version !== 1 || !uuid(row.requestId) || !uuid(row.releaseId) || !hash(row.snapshotSha256) || !['ACCEPT', 'REJECT'].includes(row.decision as string) || (row.comment !== null && (typeof row.comment !== 'string' || row.comment.length > MAX_QUOTE_RESPONSE_COMMENT_LENGTH || row.comment !== row.comment.trim() || !row.comment || /[\u0000-\u001f\u007f]/u.test(row.comment)))) throw new QuoteReleaseContractError();
  return Object.freeze({ version: 1, requestId: row.requestId, releaseId: row.releaseId, snapshotSha256: row.snapshotSha256, decision: row.decision as 'ACCEPT' | 'REJECT', comment: row.comment as string | null });
}

/**
 * Pure transaction planner, never an authorization check. Caller must establish
 * owner/recipient access, explicit POST confirmation, CSRF/rate limits and an
 * atomic unique response per release + audit transaction before using APPEND.
 * Current release authority must be target-owned and invalidated on replacement
 * or source changes; equal content must never reactivate a retired release.
 */
export function planQuoteResponse(input: {
  release: QuoteResponseRelease;
  /** Authoritative active release slot, not inferred from the source hash. */
  currentReleaseId: string | null;
  currentSnapshotSha256: string;
  command: unknown;
  previous: QuoteResponseReceipt | null;
  now: string;
}): QuoteResponsePlan {
  const release = exact(input.release, ['releaseId', 'snapshotSha256', 'createdAt', 'expiresAt', 'revokedAt', 'restoredAccessDisabled']);
  if (!uuid(release.releaseId) || !hash(release.snapshotSha256) || (input.currentReleaseId !== null && !uuid(input.currentReleaseId)) || !hash(input.currentSnapshotSha256) || !instant(input.now) || !instant(release.createdAt) || !instant(release.expiresAt) || release.expiresAt <= release.createdAt || (release.revokedAt !== null && (!instant(release.revokedAt) || release.revokedAt < release.createdAt)) || typeof release.restoredAccessDisabled !== 'boolean') throw new QuoteReleaseContractError();
  const command = parseQuoteResponseCommand(input.command);
  let previous: QuoteResponseReceipt | null = null;
  let previousCommand: QuoteResponseCommand | null = null;
  if (input.previous !== null) {
    const stored = exact(input.previous, ['version', 'requestId', 'releaseId', 'snapshotSha256', 'decision', 'comment', 'recordedAt']);
    const { recordedAt, ...storedCommand } = stored;
    previousCommand = parseQuoteResponseCommand(storedCommand);
    if (!instant(recordedAt) || recordedAt < release.createdAt || recordedAt >= release.expiresAt || recordedAt > input.now || previousCommand.releaseId !== release.releaseId || previousCommand.snapshotSha256 !== release.snapshotSha256) throw new QuoteReleaseContractError('Widersprüchlicher vorhandener Antwortbeleg.');
    previous = Object.freeze({ ...previousCommand, recordedAt });
  }
  // Unavailable access never discloses an old receipt, even for an exact replay.
  if (release.restoredAccessDisabled) return { kind: 'UNAVAILABLE', reason: 'RESTORED' };
  if (release.revokedAt !== null) return { kind: 'UNAVAILABLE', reason: 'REVOKED' };
  if (input.now < release.createdAt) return { kind: 'UNAVAILABLE', reason: 'NOT_YET_ACTIVE' };
  if (input.now >= release.expiresAt) return { kind: 'UNAVAILABLE', reason: 'EXPIRED' };
  if (release.releaseId !== input.currentReleaseId || release.snapshotSha256 !== input.currentSnapshotSha256 || command.releaseId !== release.releaseId || command.snapshotSha256 !== release.snapshotSha256) return { kind: 'UNAVAILABLE', reason: 'NOT_CURRENT' };
  if (previous) return JSON.stringify(command) === JSON.stringify(previousCommand)
    ? { kind: 'REPLAY', receipt: previous } : { kind: 'CONFLICT' };
  return { kind: 'APPEND', receipt: Object.freeze({ ...command, recordedAt: input.now }) };
}
