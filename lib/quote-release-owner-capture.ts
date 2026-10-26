import 'server-only';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { Prisma, type PrismaClient, type QuoteReleaseAuthority } from '@prisma/client';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import { createQuoteReleaseSnapshot, type QuoteReleaseSnapshot } from '@/lib/quote-release-contract';
import { readQuoteReleaseOriginal, quoteReleaseOriginalVersion, stageQuoteReleaseOriginal } from '@/lib/quote-release-original';
import { deleteTenantFile, getTenantUploadPath, isSafeStoredFileName } from '@/lib/upload-path';
import { MAX_INVOICE_UPLOAD_BYTES } from '@/lib/resource-limits';

/** Internal service only: no HTTP consumer, token, public URL or delivery. */
export type OwnerQuoteCaptureCommand = Readonly<{
  userId: string;
  quoteId: number;
  expected: Readonly<{ authorityId: string | null; revision: number; currentReleaseId: string | null; sourceFingerprint: string }>;
  expiresAt: string;
  reason: string;
}>;
export type OwnerQuoteCaptureReceipt = QuoteReleaseSnapshot & Readonly<{
  authorityId: string;
  releaseId: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
}>;
type CaptureClient = Pick<PrismaClient, '$transaction' | 'quoteRelease' | 'invoice' | 'purchaseDocument' | 'expense' | 'settings' | 'emailOutbox'>;
type CaptureCode = 'INVALID_COMMAND' | 'SOURCE_UNAVAILABLE' | 'SOURCE_INVALID' | 'STALE_CAPTURE' | 'ORIGINAL_UNAVAILABLE' | 'CAPTURE_INVARIANT';
export class QuoteOwnerCaptureError extends Error {
  readonly status = 409;
  constructor(readonly code: CaptureCode, cause?: unknown) {
    super('Das Angebotsoriginal konnte nicht unverändert und atomar freigegeben werden. Bitte den eigenen Angebotsstand erneut prüfen.', { cause });
    this.name = 'QuoteOwnerCaptureError';
  }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const MAX_REVISION = 2147483647;
function fail(code: CaptureCode, cause?: unknown): never { throw new QuoteOwnerCaptureError(code, cause); }
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return descriptor.enumerable && 'value' in descriptor;
  });
}
function command(input: OwnerQuoteCaptureCommand): OwnerQuoteCaptureCommand {
  if (!closed(input, ['userId', 'quoteId', 'expected', 'expiresAt', 'reason']) || !closed(input.expected, ['authorityId', 'revision', 'currentReleaseId', 'sourceFingerprint'])) fail('INVALID_COMMAND');
  const expected = input.expected;
  if (typeof input.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.userId) || !Number.isInteger(input.quoteId) || input.quoteId < 1 || input.quoteId > MAX_REVISION
    || (expected.authorityId !== null && (typeof expected.authorityId !== 'string' || !UUID.test(expected.authorityId))) || !Number.isInteger(expected.revision) || expected.revision < 0 || expected.revision >= MAX_REVISION - 1
    || (expected.currentReleaseId !== null && (typeof expected.currentReleaseId !== 'string' || !UUID.test(expected.currentReleaseId))) || typeof expected.sourceFingerprint !== 'string' || !SHA.test(expected.sourceFingerprint)
    || (expected.authorityId === null && (expected.revision !== 0 || expected.currentReleaseId !== null))
    || !instant(input.expiresAt) || Date.parse(input.expiresAt) <= Date.now()
    || typeof input.reason !== 'string' || input.reason.trim().length < 1 || input.reason.length > 500 || /[\0-\x1f\x7f]/u.test(input.reason)) fail('INVALID_COMMAND');
  // Copy scalar guards before asynchronous work; mutable caller objects cannot
  // silently change owner, revision/pointer, expiry or audit reason mid-capture.
  return Object.freeze({ userId: input.userId, quoteId: input.quoteId, expected: Object.freeze({ ...expected }), expiresAt: input.expiresAt, reason: input.reason.trim() });
}

async function sourceState(tx: Prisma.TransactionClient, input: OwnerQuoteCaptureCommand) {
  const quote = await tx.invoice.findFirst({ where: { id: input.quoteId, userId: input.userId, type: 'QUOTE' }, select: {
    id: true, userId: true, type: true, status: true, customerId: true, fileName: true, storedFileName: true,
    invoiceNumber: true, invoiceDate: true, validUntil: true, totalAmount: true, parsedData: true,
    quoteCreateRequestId: true, quoteCreateFingerprint: true,
  } });
  if (!quote || quote.userId !== input.userId || quote.type !== 'QUOTE' || !['DRAFT', 'SENT'].includes(quote.status)
    || !quote.quoteCreateRequestId || !quote.quoteCreateFingerprint || !isSafeStoredFileName(quote.storedFileName) || !quote.storedFileName.endsWith('.pdf')
    || typeof quote.invoiceNumber !== 'string' || !quote.invoiceNumber.trim() || quote.invoiceDate === null
    || typeof quote.totalAmount !== 'number' || !Number.isFinite(quote.totalAmount) || quote.totalAmount < 0) fail('SOURCE_UNAVAILABLE');
  if (await tx.invoice.count({ where: { convertedFromQuoteId: quote.id } }) > 0) fail('SOURCE_UNAVAILABLE');
  if (quote.customerId !== null && !await tx.customer.findFirst({ where: { id: quote.customerId, userId: input.userId }, select: { id: true } })) fail('SOURCE_UNAVAILABLE');
  const receipt = await tx.quoteCreateReceipt.findFirst({ where: { userId: input.userId, requestId: quote.quoteCreateRequestId, invoiceUserId: input.userId, invoiceId: quote.id } });
  let sourceFingerprint: string;
  try { sourceFingerprint = quoteCreateFingerprintForInvoice(quote); } catch (error) { fail('SOURCE_INVALID', error); }
  if (!receipt || receipt.userId !== input.userId || receipt.invoiceUserId !== input.userId || receipt.invoiceId !== quote.id
    || receipt.requestId !== quote.quoteCreateRequestId || receipt.fingerprint !== sourceFingerprint || quote.quoteCreateFingerprint !== sourceFingerprint || !SHA.test(receipt.pdfSha256)) fail('SOURCE_INVALID');
  if (sourceFingerprint !== input.expected.sourceFingerprint) fail('STALE_CAPTURE');
  // Conservative exact-instant policy. Do not invent end-of-day validity or
  // permit an access window beyond the stored offer's own non-null validity.
  if (quote.validUntil !== null && Date.parse(input.expiresAt) > quote.validUntil.getTime()) fail('SOURCE_INVALID');
  const sourcePayload = JSON.stringify({ version: 1, sourceQuoteIdAtCapture: quote.id, boundCustomerIdAtCapture: quote.customerId,
    document: { type: quote.type, fileName: quote.fileName, invoiceNumber: quote.invoiceNumber, invoiceDate: quote.invoiceDate?.toISOString() ?? null,
      validUntil: quote.validUntil?.toISOString() ?? null, totalAmount: quote.totalAmount, parsedData: quote.parsedData } });
  if (Buffer.byteLength(sourcePayload, 'utf8') > 1024 * 1024) fail('SOURCE_INVALID');
  // Recipient display stays in frozen quote parsedData; never read a live
  // Customer name/address/email to build this retained source payload.
  return { quote, receipt, sourceFingerprint, sourcePayload };
}
function authorityMatches(row: QuoteReleaseAuthority | null, input: OwnerQuoteCaptureCommand, authorityId: string, customerId: number | null): asserts row is QuoteReleaseAuthority {
  if (!row || row.id !== authorityId || row.userId !== input.userId || row.sourceUserId !== input.userId || row.sourceInvoiceId !== input.quoteId
    || row.boundCustomerId !== customerId || row.revision !== input.expected.revision || row.currentReleaseId !== input.expected.currentReleaseId) fail('STALE_CAPTURE');
}
async function audit(tx: Prisma.TransactionClient, input: OwnerQuoteCaptureCommand, operation: string, reference: string) {
  await createFinancialAuditLog({ userId: input.userId, action: 'CREATE', entityType: 'Quote', entityId: input.quoteId,
    metadata: { actorId: input.userId, tenantId: input.userId, operation, originalReference: reference, reason: input.reason } }, tx);
}

/**
 * Capture existing durable quote bytes only. Initial authority preflight is
 * separately audited and deliberately retained if later file/capture work fails:
 * its revision clock must exist before I/O to prevent source A→B→A stale capture.
 * No caller currently invokes this service and it exposes no public capability.
 */
export async function captureOwnerQuoteRelease(client: CaptureClient, raw: OwnerQuoteCaptureCommand): Promise<OwnerQuoteCaptureReceipt> {
  const input = command(raw);
  const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 };
  const prepared = await client.$transaction(async tx => {
    const source = await sourceState(tx, input);
    let authorityId = input.expected.authorityId;
    if (authorityId === null) {
      if (await tx.quoteReleaseAuthority.findFirst({ where: { sourceUserId: input.userId, sourceInvoiceId: input.quoteId } })) fail('STALE_CAPTURE');
      authorityId = randomUUID();
      const row = await tx.quoteReleaseAuthority.create({ data: { id: authorityId, userId: input.userId, sourceUserId: input.userId, sourceInvoiceId: input.quoteId, boundCustomerId: source.quote.customerId } });
      authorityMatches(row, input, authorityId, source.quote.customerId);
      await audit(tx, input, 'quote.release.authority.preflight', `quote:${input.quoteId}:authority:${authorityId}:inactive-preflight`);
    } else authorityMatches(await tx.quoteReleaseAuthority.findUnique({ where: { id: authorityId } }), input, authorityId, source.quote.customerId);
    return { ...source, authorityId };
  }, options);

  const releaseId = randomUUID(), archiveName = `${randomUUID()}.pdf`;
  let created = false, stagedVersion: string | undefined;
  try {
    let original;
    try {
      // lstat only obtains a bounded declared size; the reused strict reader
      // independently rejects symlinks/non-regular paths and verifies receipt hash.
      const stat = await lstat(getTenantUploadPath(input.userId, prepared.quote.storedFileName));
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > MAX_INVOICE_UPLOAD_BYTES) fail('ORIGINAL_UNAVAILABLE');
      original = await readQuoteReleaseOriginal(input.userId, { originalArchiveName: prepared.quote.storedFileName, originalSha256: prepared.receipt.pdfSha256, originalBytes: stat.size });
    } catch (error) { throw error instanceof QuoteOwnerCaptureError ? error : new QuoteOwnerCaptureError('ORIGINAL_UNAVAILABLE', error); }
    const snapshot = createQuoteReleaseSnapshot(prepared.quote, original.bytes);
    if (snapshot.sourceFingerprint !== prepared.sourceFingerprint || snapshot.originalSha256 !== prepared.receipt.pdfSha256) fail('SOURCE_INVALID');
    const binding = { originalArchiveName: archiveName, originalSha256: snapshot.originalSha256, originalBytes: snapshot.originalBytes };
    const staged = await stageQuoteReleaseOriginal(input.userId, binding, original.bytes, name => { if (name !== archiveName || created) fail('CAPTURE_INVARIANT'); created = true; });
    stagedVersion = staged.sourceVersion;
    return await client.$transaction(async tx => {
      const current = await sourceState(tx, input);
      authorityMatches(await tx.quoteReleaseAuthority.findUnique({ where: { id: prepared.authorityId } }), input, prepared.authorityId, current.quote.customerId);
      if (current.quote.storedFileName !== prepared.quote.storedFileName || current.receipt.requestId !== prepared.receipt.requestId
        || current.receipt.fingerprint !== prepared.receipt.fingerprint || current.receipt.pdfSha256 !== prepared.receipt.pdfSha256
        || current.receipt.createdAt.getTime() !== prepared.receipt.createdAt.getTime() || current.sourcePayload !== prepared.sourcePayload) fail('STALE_CAPTURE');
      if (await quoteReleaseOriginalVersion(input.userId, prepared.quote.storedFileName) !== original.sourceVersion) fail('ORIGINAL_UNAVAILABLE');
      // Required timestamps have no ORM/default stand-in. The fixed parameterized
      // statement uses the SAME database clock expression as the insert trigger.
      // Never substitute an application Date or engine-introspected string literal.
      const inserted = await tx.$executeRaw(Prisma.sql`INSERT INTO "QuoteRelease"
        ("id","userId","authorityId","generation","previousReleaseId","version","sourceFingerprint","originalSha256","originalBytes","snapshotSha256","originalArchiveName","sourcePayload","createdAt","expiresAt","restoredAccessDisabled")
        VALUES (${releaseId},${input.userId},${prepared.authorityId},${input.expected.revision + 1},${input.expected.currentReleaseId},${snapshot.version},${snapshot.sourceFingerprint},${snapshot.originalSha256},${snapshot.originalBytes},${snapshot.snapshotSha256},${archiveName},${prepared.sourcePayload},strftime('%Y-%m-%dT%H:%M:%fZ','now'),${input.expiresAt},0)`);
      if (inserted !== 1) fail('CAPTURE_INVARIANT');
      const release = await tx.quoteRelease.findUnique({ where: { id: releaseId } });
      if (!release) fail('CAPTURE_INVARIANT');
      // SQL is the only authority-advance path; do not pre-increment in a helper.
      const advanced = await tx.quoteReleaseAuthority.findUnique({ where: { id: prepared.authorityId } });
      if (!advanced || advanced.userId !== input.userId || advanced.revision !== input.expected.revision + 1 || advanced.currentReleaseId !== releaseId
        || advanced.sourceUserId !== input.userId || advanced.sourceInvoiceId !== input.quoteId || advanced.boundCustomerId !== prepared.quote.customerId
        || release.id !== releaseId || release.userId !== input.userId || release.authorityId !== prepared.authorityId || release.generation !== advanced.revision
        || release.snapshotSha256 !== snapshot.snapshotSha256 || release.restoredAccessDisabled !== 0 || release.revokedAt !== null || !instant(release.createdAt)) fail('CAPTURE_INVARIANT');
      if (await quoteReleaseOriginalVersion(input.userId, prepared.quote.storedFileName) !== original.sourceVersion
        || await quoteReleaseOriginalVersion(input.userId, archiveName) !== stagedVersion) fail('ORIGINAL_UNAVAILABLE');
      await audit(tx, input, input.expected.currentReleaseId === null ? 'quote.release.capture' : 'quote.release.replace', `quote-release:${releaseId}:snapshot:${snapshot.snapshotSha256}`);
      return Object.freeze({ ...snapshot, authorityId: prepared.authorityId, releaseId, revision: advanced.revision, createdAt: release.createdAt, expiresAt: release.expiresAt });
    }, options);
  } catch (error) {
    // Only this call's exclusively created, completely verified, unchanged
    // archive may be removed. Partial/uncertain stages remain safe orphans.
    if (created && stagedVersion) try {
      if (await quoteReleaseOriginalVersion(input.userId, archiveName) === stagedVersion) {
        const counts = await Promise.all([
          client.quoteRelease.count({ where: { userId: input.userId, originalArchiveName: archiveName } }),
          client.invoice.count({ where: { userId: input.userId, storedFileName: archiveName } }),
          client.purchaseDocument.count({ where: { userId: input.userId, storedFileName: archiveName } }),
          client.expense.count({ where: { userId: input.userId, storedReceiptFileName: archiveName } }),
          client.settings.count({ where: { userId: input.userId, OR: [{ logoUrl: `/api/files/logo?file=${encodeURIComponent(archiveName)}` }, { logoUrl: `/uploads/${archiveName}` }] } }),
          client.emailOutbox.count({ where: { userId: input.userId, storedFileName: archiveName } }),
        ]);
        if (counts.every(value => value === 0) && await quoteReleaseOriginalVersion(input.userId, archiveName) === stagedVersion) await deleteTenantFile(input.userId, archiveName);
      }
    } catch { /* Retain uncertain or referenced evidence; preserve original error. */ }
    throw error;
  }
}
