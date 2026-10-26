import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import { isSafeStoredFileName } from '@/lib/upload-path';
import { ownerQuoteReleaseId, ownerQuoteReleaseInstant, type OwnerQuoteReleaseState, type OwnerQuoteReleaseHistoryItem } from '@/lib/quote-release-owner-contract';

const HISTORY_LIMIT = 20;
const SHA = /^[0-9a-f]{64}$/u;
type StateClient = Pick<PrismaClient, '$transaction'>;
export class OwnerQuoteReleaseStateError extends Error {
  constructor() { super('Der interne Versionsstand ist nicht konsistent. Bitte nicht erneut speichern.'); }
}
/** No authority creation, audit, rate-limit bucket, file I/O or mutation on GET. */
export async function readOwnerQuoteReleaseState(client: StateClient, userId: string, quoteId: number): Promise<OwnerQuoteReleaseState | null> {
  if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(userId) || !Number.isInteger(quoteId) || quoteId < 1 || quoteId > 2147483647) throw new OwnerQuoteReleaseStateError();
  return client.$transaction(async tx => {
    const quote = await tx.invoice.findFirst({ where: { id: quoteId, userId, type: 'QUOTE' }, select: {
      id: true, userId: true, type: true, status: true, customerId: true, fileName: true, storedFileName: true,
      invoiceNumber: true, invoiceDate: true, validUntil: true, totalAmount: true, parsedData: true, quoteCreateRequestId: true, quoteCreateFingerprint: true,
    } });
    if (!quote) return null;
    if (quote.userId !== userId || quote.id !== quoteId || quote.type !== 'QUOTE') throw new OwnerQuoteReleaseStateError();
    const authority = await tx.quoteReleaseAuthority.findFirst({ where: { userId, sourceUserId: userId, sourceInvoiceId: quoteId } });
    if (authority && (!ownerQuoteReleaseId(authority.id) || authority.userId !== userId || authority.sourceUserId !== userId || authority.sourceInvoiceId !== quoteId
      || authority.boundCustomerId !== quote.customerId || !Number.isInteger(authority.revision) || authority.revision < 0
      || (authority.currentReleaseId !== null && !ownerQuoteReleaseId(authority.currentReleaseId)))) throw new OwnerQuoteReleaseStateError();
    const totalVersions = authority ? await tx.quoteRelease.count({ where: { userId, authorityId: authority.id } }) : 0;
    const rows = authority ? await tx.quoteRelease.findMany({ where: { userId, authorityId: authority.id }, orderBy: { generation: 'desc' }, take: HISTORY_LIMIT, select: {
      id: true, userId: true, authorityId: true, generation: true, snapshotSha256: true, createdAt: true, expiresAt: true, revokedAt: true, restoredAccessDisabled: true,
    } }) : [];
    const responses = rows.length ? await tx.quoteElectronicResponse.findMany({ where: { userId, authorityId: authority!.id, releaseId: { in: rows.map(row => row.id) } }, take: HISTORY_LIMIT, select: { userId: true, authorityId: true, releaseId: true, decision: true, recordedAt: true } }) : [];
    const responseMap = new Map<string, { decision: 'ACCEPT' | 'REJECT'; recordedAt: string }>();
    for (const response of responses) {
      if (response.userId !== userId || response.authorityId !== authority?.id || !rows.some(row => row.id === response.releaseId)
        || !['ACCEPT', 'REJECT'].includes(response.decision) || !ownerQuoteReleaseInstant(response.recordedAt) || responseMap.has(response.releaseId)) throw new OwnerQuoteReleaseStateError();
      responseMap.set(response.releaseId, { decision: response.decision as 'ACCEPT' | 'REJECT', recordedAt: response.recordedAt });
    }
    const history: OwnerQuoteReleaseHistoryItem[] = rows.map(row => {
      if (!ownerQuoteReleaseId(row.id) || row.userId !== userId || row.authorityId !== authority?.id || !Number.isInteger(row.generation) || row.generation < 1
        || !SHA.test(row.snapshotSha256) || !ownerQuoteReleaseInstant(row.createdAt) || !ownerQuoteReleaseInstant(row.expiresAt)
        || (row.revokedAt !== null && !ownerQuoteReleaseInstant(row.revokedAt)) || ![0, 1].includes(row.restoredAccessDisabled)) throw new OwnerQuoteReleaseStateError();
      return { id: row.id, generation: row.generation, snapshotSha256: row.snapshotSha256, createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt,
        permanentlyClosed: row.restoredAccessDisabled === 1, current: row.id === authority?.currentReleaseId, response: responseMap.get(row.id) ?? null };
    });
    if (authority?.currentReleaseId !== null && authority?.currentReleaseId !== undefined) {
      const current = history.find(row => row.current);
      if (!current || current.generation !== authority.revision || current.revokedAt !== null || current.permanentlyClosed) throw new OwnerQuoteReleaseStateError();
    }
    let fingerprint: string | null = null;
    try { fingerprint = quoteCreateFingerprintForInvoice(quote); } catch { /* A legacy/changed source is visible but never made eligible. */ }
    const receipt = quote.quoteCreateRequestId ? await tx.quoteCreateReceipt.findFirst({ where: { userId, requestId: quote.quoteCreateRequestId, invoiceUserId: userId, invoiceId: quoteId }, select: {
      userId: true, requestId: true, invoiceUserId: true, invoiceId: true, fingerprint: true, pdfSha256: true,
    } }) : null;
    const eligible = !!fingerprint && ['DRAFT', 'SENT'].includes(quote.status) && isSafeStoredFileName(quote.storedFileName) && quote.storedFileName.endsWith('.pdf')
      && !!quote.invoiceNumber?.trim() && quote.invoiceDate !== null && typeof quote.totalAmount === 'number' && Number.isFinite(quote.totalAmount) && quote.totalAmount >= 0
      && receipt?.userId === userId && receipt.requestId === quote.quoteCreateRequestId && receipt.invoiceUserId === userId && receipt.invoiceId === quoteId
      && receipt.fingerprint === fingerprint && quote.quoteCreateFingerprint === fingerprint && SHA.test(receipt.pdfSha256)
      && (authority?.revision ?? 0) < 2147483646
      && await tx.invoice.count({ where: { convertedFromQuoteId: quoteId } }) === 0
      && (quote.customerId === null || !!await tx.customer.findFirst({ where: { id: quote.customerId, userId }, select: { id: true } }));
    return { quoteId, expected: eligible ? { authorityId: authority?.id ?? null, revision: authority?.revision ?? 0, currentReleaseId: authority?.currentReleaseId ?? null, sourceFingerprint: fingerprint! } : null,
      eligibility: eligible ? 'RECEIPT_BOUND' : 'UNAVAILABLE', validUntil: quote.validUntil?.toISOString() ?? null,
      totalVersions, history, hasMore: totalVersions > history.length, publicAccessEnabled: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 5_000 });
}
