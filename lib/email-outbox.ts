import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { prisma } from '@/lib/prisma';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { Prisma, type EmailOutbox } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';

export const EMAIL_PROCESSING_LEASE_MS = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class EmailOutboxConflict extends Error {}
export function validateEmailRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new EmailOutboxConflict('Bitte die E-Mail erneut prüfen und bestätigen.');
  return value;
}
export function attachmentSha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
export function emailStorageScope(userId: string) { return attachmentSha256(Buffer.from(`email-outbox:${userId}`)); }
export type EmailEnvelope = Pick<EmailOutbox, 'userId' | 'invoiceId' | 'sourceInvoiceId' | 'documentType' | 'attachmentSha256' | 'storedFileName' | 'attachmentFileName' | 'from' | 'replyTo' | 'to' | 'cc' | 'bcc' | 'subject' | 'text'>;
export type EmailRetry = { outboxId: string; requestId: string; acknowledgeUnknown: boolean };

function unresolvedOutboxRisk(): Prisma.EmailOutboxWhereInput {
  return { OR: [
    { state: { in: ['PROCESSING', 'UNKNOWN'] } },
    { state: { in: ['FAILED', 'CANCELLED'] }, attempts: { some: { OR: [{ state: 'UNKNOWN' }, { uncertaintyRecordedAt: { not: null } }] } } },
  ] };
}
function originalScope(invoiceId: number | null, hash: string): Prisma.EmailOutboxWhereInput {
  return { OR: [{ invoiceId }, { invoiceId: null, attachmentSha256: hash }] };
}

/** Expiry records uncertainty only. It never claims work or contacts SMTP. */
async function recoverExpired(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const expired = await tx.emailOutbox.findMany({ where: { userId, state: 'PROCESSING', processingExpiresAt: { lte: now } } });
  for (const item of expired) {
    await tx.emailOutbox.updateMany({ where: { id: item.id, userId, state: 'PROCESSING', currentAttemptId: item.currentAttemptId },
      data: { state: 'UNKNOWN', errorCode: 'PROCESS_INTERRUPTED', processingExpiresAt: null } });
    if (item.currentAttemptId) await tx.emailOutboxAttempt.updateMany({ where: { id: item.currentAttemptId, state: 'PROCESSING' },
      data: { state: 'UNKNOWN', errorCode: 'PROCESS_INTERRUPTED', finishedAt: now, uncertaintyRecordedAt: now } });
  }
}

export async function prepareEmailOutbox(envelope: EmailEnvelope, requestId: string) {
  validateEmailRequestId(requestId);
  const fingerprint = attachmentSha256(Buffer.from(JSON.stringify(envelope)));
  return inTransaction(async tx => {
    await recoverExpired(tx, envelope.userId, new Date());
    const replay = await tx.emailOutbox.findUnique({ where: { userId_requestId: { userId: envelope.userId, requestId } } });
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new EmailOutboxConflict('Die bestätigte E-Mail wurde geändert. Bitte eine neue Vorschau prüfen.');
      return replay;
    }
    const same = await tx.emailOutbox.findUnique({ where: { userId_fingerprint: { userId: envelope.userId, fingerprint } } });
    if (same) return same;
    const unresolved = await tx.emailOutbox.findFirst({ where: { userId: envelope.userId, documentType: envelope.documentType,
      AND: [originalScope(envelope.invoiceId, envelope.attachmentSha256), unresolvedOutboxRisk()] } });
    if (unresolved) throw new EmailOutboxConflict('Ein Versandversuch ist noch offen oder unbekannt. Bitte zuerst den Versandverlauf prüfen.');
    return tx.emailOutbox.create({ data: { ...envelope, requestId, fingerprint } });
  });
}

export async function claimEmailOutbox(userId: string, id: string, retry?: EmailRetry) {
  return inTransaction(async tx => {
    const now = new Date();
    await recoverExpired(tx, userId, now);
    const item = await tx.emailOutbox.findFirst({ where: { id, userId } });
    if (!item || item.invoiceId === null) throw new EmailOutboxConflict('Versandauftrag nicht mehr mit dem Original verknüpft. Bitte eine neue Vorschau prüfen.');
    const attemptRequestId = retry ? validateEmailRequestId(retry.requestId) : item.requestId;
    if (await tx.emailOutboxAttempt.findUnique({ where: { outboxId_requestId: { outboxId: id, requestId: attemptRequestId } } })) return null;
    if (retry) {
      if (!['FAILED', 'UNKNOWN'].includes(item.state)) return null;
      const uncertainHistory = await tx.emailOutboxAttempt.count({ where: { outboxId: id, OR: [{ state: 'UNKNOWN' }, { uncertaintyRecordedAt: { not: null } }] } });
      if ((item.state === 'UNKNOWN' || uncertainHistory > 0) && !retry.acknowledgeUnknown) throw new EmailOutboxConflict('Ausgang unbekannt: Vor einer Wiederholung den Versand prüfen und das Doppelversandrisiko bestätigen.');
    } else if (item.state !== 'PREPARED') return null;
    const otherUnresolved = await tx.emailOutbox.findFirst({ where: { userId, documentType: item.documentType, id: { not: id },
      AND: [originalScope(item.invoiceId, item.attachmentSha256), unresolvedOutboxRisk()] } });
    if (otherUnresolved) throw new EmailOutboxConflict('Ein anderer Versandversuch für dieses Dokument ist noch offen. Bitte den Versandverlauf prüfen.');
    const attemptId = randomUUID();
    const claimed = await tx.emailOutbox.updateMany({ where: { id, userId, state: item.state, currentAttemptId: item.currentAttemptId },
      data: { state: 'PROCESSING', currentAttemptId: attemptId, processingExpiresAt: new Date(now.getTime() + EMAIL_PROCESSING_LEASE_MS), errorCode: null } });
    if (claimed.count !== 1) return null;
    const latest = await tx.emailOutboxAttempt.findFirst({ where: { outboxId: id }, orderBy: { sequence: 'desc' } });
    await tx.emailOutboxAttempt.create({ data: { id: attemptId, outboxId: id, requestId: attemptRequestId,
      sequence: (latest?.sequence ?? 0) + 1, duplicateRiskAcknowledged: retry?.acknowledgeUnknown === true, state: 'PROCESSING', startedAt: now } });
    return { item, attemptId };
  });
}

/** Only explicit negative acknowledgements or pre-envelope failures are safe to retry. */
export function classifyEmailTransportError(error: unknown): { state: 'FAILED' | 'UNKNOWN'; errorCode: string } {
  const info = error && typeof error === 'object' ? error as { code?: unknown; responseCode?: unknown; command?: unknown } : {};
  if (info.code === 'EAUTH') return { state: 'FAILED', errorCode: 'AUTH_REJECTED' };
  if (info.code === 'EENVELOPE') return { state: 'FAILED', errorCode: 'RECIPIENT_REJECTED' };
  if (typeof info.responseCode === 'number' && info.responseCode >= 400 && info.responseCode <= 599)
    return { state: 'FAILED', errorCode: 'SMTP_REJECTED' };
  if (['EDNS', 'ECONNECTION'].includes(String(info.code)) && info.command === 'CONN')
    return { state: 'FAILED', errorCode: 'CONNECTION_FAILED' };
  return { state: 'UNKNOWN', errorCode: 'TRANSPORT_UNCERTAIN' };
}

export async function finishEmailAttempt(userId: string, outboxId: string, attemptId: string,
  result: { state: 'ACCEPTED' | 'FAILED' | 'UNKNOWN'; errorCode?: string; messageId?: string }) {
  await inTransaction(async tx => {
    const item = await tx.emailOutbox.findFirst({ where: { id: outboxId, userId } });
    if (!item) throw new EmailOutboxConflict('Versandauftrag nicht gefunden.');
    const attempt = await tx.emailOutboxAttempt.findFirst({ where: { id: attemptId, outboxId } });
    await tx.emailOutboxAttempt.updateMany({ where: { id: attemptId, outboxId, state: { in: ['PROCESSING', 'UNKNOWN'] } },
      data: { ...result, finishedAt: new Date(), ...(result.state === 'UNKNOWN' ? { uncertaintyRecordedAt: attempt?.uncertaintyRecordedAt ?? new Date() } : {}) } });
    // A late outcome may refine its own old attempt, never overwrite a newer retry.
    await tx.emailOutbox.updateMany({ where: { id: outboxId, userId, currentAttemptId: attemptId, state: { in: ['PROCESSING', 'UNKNOWN'] } },
      data: { ...result, processingExpiresAt: null } });
  });
}

export async function readEmailOutbox(userId: string, id: string) {
  return inTransaction(async tx => {
    await recoverExpired(tx, userId, new Date());
    return tx.emailOutbox.findFirst({ where: { id, userId }, include: { attempts: { orderBy: { sequence: 'asc' } } } });
  });
}
export async function listEmailOutboxPage(userId: string, invoiceId: number, documentType: string) {
  // Resolve only through an owned current original. There is no arbitrary hash-history API.
  const owned = await prisma.invoice.findFirst({ where: { id: invoiceId, userId, type: documentType === 'quote' ? 'QUOTE' : { not: 'QUOTE' } } });
  if (!owned) throw new EmailOutboxConflict('Dokument nicht gefunden.');
  const originalPath = await findOwnedUploadedFile(userId, basename(owned.storedFileName));
  const hash = originalPath ? attachmentSha256(await readFile(originalPath)) : null;
  return inTransaction(async tx => {
    await recoverExpired(tx, userId, new Date());
    const current = await tx.invoice.findFirst({ where: { id: invoiceId, userId, storedFileName: owned.storedFileName } });
    if (!current) throw new EmailOutboxConflict('Original wurde geändert. Bitte Vorschau aktualisieren.');
    // One bounded ordering/count contract: risk cannot be paged away by newer
    // successful history. Window totals are computed before LIMIT, not inferred
    // from the displayed subset; no caller-provided hash or SQL is accepted.
    const ordered = await tx.$queryRaw<{ id: string; total: bigint; unresolvedCount: bigint }[]>(Prisma.sql`
      WITH matching AS (
        SELECT e.id, e.createdAt,
          CASE WHEN e.state IN ('PROCESSING', 'UNKNOWN') OR (
            e.state IN ('FAILED', 'CANCELLED') AND EXISTS (
              SELECT 1 FROM EmailOutboxAttempt a WHERE a.outboxId = e.id
                AND (a.state = 'UNKNOWN' OR a.uncertaintyRecordedAt IS NOT NULL)
            )
          ) THEN 1 ELSE 0 END AS unresolvedRisk
        FROM EmailOutbox e
        WHERE e.userId = ${userId} AND e.documentType = ${documentType}
          AND (e.invoiceId = ${invoiceId} OR (e.invoiceId IS NULL AND e.attachmentSha256 = ${hash}))
      )
      SELECT id, COUNT(*) OVER () AS total, SUM(unresolvedRisk) OVER () AS unresolvedCount
      FROM matching ORDER BY unresolvedRisk DESC, createdAt DESC, id DESC LIMIT 30
    `);
    const records = await tx.emailOutbox.findMany({ where: { userId, id: { in: ordered.map(row => row.id) } },
      include: { attempts: { orderBy: { sequence: 'asc' } } } });
    const byId = new Map(records.map(row => [row.id, row]));
    const items = ordered.flatMap(row => { const item = byId.get(row.id); return item ? [item] : []; });
    const total = Number(ordered[0]?.total ?? 0);
    return { items, total, unresolvedCount: Number(ordered[0]?.unresolvedCount ?? 0), hasMore: total > items.length };
  });
}

export async function listEmailOutbox(userId: string, invoiceId: number, documentType: string) {
  return (await listEmailOutboxPage(userId, invoiceId, documentType)).items;
}
