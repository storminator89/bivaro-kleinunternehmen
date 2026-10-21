import { Prisma, type PurchaseDocument } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { withProcessingSlot, ProcessingCapacityError } from '@/lib/processing-limit';
import { writeTenantFile, deleteTenantFile } from '@/lib/upload-path';
import { parsePurchaseBytes, PURCHASE_PARSER_VERSION } from './parser';
import { originalHash, readPurchaseOriginal, purchaseOriginalName } from './original';
import { PurchaseDocumentError } from './errors';
import type { IncomingDocument, IncomingDocumentList, PurchaseParsePreview, PurchaseParseStatus, PurchaseReviewStatus, PurchaseMediaType, PurchaseReviewDraft } from './types';
import { findPurchaseDuplicateHints } from './duplicates';
import { isPhotoMedia, type ManualPhotoSnapshot } from './manual-photo-contract';
import { PURCHASE_PARSE_STATUSES, PURCHASE_REVIEW_STATUSES } from './types';

// Paginated reads must not materialize lineItems (or any full parsedData JSON).
const SOURCE_METADATA_SELECT = {
  id: true, userId: true, originalFileName: true, originalSha256: true, originalByteCount: true,
  mediaType: true, uploadedAt: true, supplierName: true, invoiceNumber: true, invoiceDate: true,
  currency: true, parseStatus: true, parseErrorCode: true, parserVersion: true, reviewStatus: true,
  revision: true, expenseId: true, approvedAt: true, approvalRequestId: true, approvalFingerprint: true,
  reviewedSourceSnapshot: true, reviewDraft: true, reviewDraftSavedAt: true, dismissedAt: true, dismissalReason: true, supplierId: true, selectedSupplierSnapshot: true,
} satisfies Prisma.PurchaseDocumentSelect;
type SourceMetadata = Prisma.PurchaseDocumentGetPayload<{ select: typeof SOURCE_METADATA_SELECT }>;
type SourcePreviewSummary = Pick<PurchaseParsePreview, 'grossAmount' | 'parserWarnings' | 'approvalSupported'>
  & Partial<Pick<PurchaseParsePreview, 'sellerInfo' | 'buyerInfo'>>;
type ProjectedSourcePreview = { id: number; grossAmount: unknown; approvalSupported: unknown; parserWarnings: unknown };
const MAX_SUMMARY_WARNINGS_JSON = 220_000;
function exactProjectedGross(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 100 && /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
}
function projectedPreview(row: ProjectedSourcePreview | undefined): SourcePreviewSummary {
  const unavailable = [{ code: 'PREVIEW_SUMMARY_UNAVAILABLE', message: 'Prüfhinweise sind in der Liste nicht vollständig verfügbar. Bitte den Beleg öffnen.' }];
  let warnings = unavailable;
  try {
    if (typeof row?.parserWarnings !== 'string' || row.parserWarnings.length > MAX_SUMMARY_WARNINGS_JSON) throw new Error();
    const values: unknown = JSON.parse(row.parserWarnings);
    if (!Array.isArray(values) || values.length > 100 || !values.every(value => value && typeof value === 'object'
      && typeof value.code === 'string' && value.code.length <= 128 && typeof value.message === 'string' && value.message.length <= 2_000)) throw new Error();
    warnings = values;
  } catch { /* Never fetch the full source JSON to repair a missing summary. */ }
  const grossAmount = exactProjectedGross(row?.grossAmount);
  return { grossAmount, parserWarnings: warnings,
    approvalSupported: grossAmount !== null && warnings !== unavailable && (row?.approvalSupported === true || row?.approvalSupported === 1 || row?.approvalSupported === BigInt(1)) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseUploadRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new PurchaseDocumentError('uploadRequestId muss eine UUID sein.');
  return value.toLowerCase();
}
export function parseDocumentId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || (!Number.isSafeInteger(Number(value)) || Number(value) > 2_147_483_647)) throw new PurchaseDocumentError('Eingangsbeleg nicht gefunden.', 404, 'NOT_FOUND');
  return Number(value);
}
export function expectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new PurchaseDocumentError('Aktuelle Belegrevision ist erforderlich.');
  return value;
}
export function assertSourceState(document: SourceMetadata): void {
  if (!PURCHASE_REVIEW_STATUSES.includes(document.reviewStatus as PurchaseReviewStatus) || !PURCHASE_PARSE_STATUSES.includes(document.parseStatus as PurchaseParseStatus)) throw new PurchaseDocumentError('Belegstatus ist inkonsistent.', 409, 'SOURCE_STATE');
  const hasApproval = document.expenseId !== null && document.approvedAt !== null && document.approvalRequestId !== null && document.approvalFingerprint !== null;
  const noApproval = document.expenseId === null && document.approvedAt === null && document.approvalRequestId === null && document.approvalFingerprint === null;
  if (document.reviewStatus === 'BOOKED' ? !hasApproval : !noApproval) throw new PurchaseDocumentError('Belegverknüpfung ist inkonsistent.', 409, 'SOURCE_STATE');
  const manual = document.reviewedSourceSnapshot;
  if ((manual != null && (!isPhotoMedia(document.mediaType) || document.reviewStatus !== 'BOOKED' || typeof manual !== 'object' || Array.isArray(manual) || manual.ownerId !== document.userId || manual.originalSha256 !== document.originalSha256)) || (isPhotoMedia(document.mediaType) && document.reviewStatus === 'BOOKED' && manual == null)) throw new PurchaseDocumentError('Manuelle Originalfreigabe ist inkonsistent.', 409, 'SOURCE_STATE');
  const hasSupplier = typeof document.supplierId === 'number' && document.supplierId > 0 && document.selectedSupplierSnapshot !== null && typeof document.selectedSupplierSnapshot === 'object' && !Array.isArray(document.selectedSupplierSnapshot) && document.selectedSupplierSnapshot.id === document.supplierId;
  const noSupplier = document.supplierId === null && document.selectedSupplierSnapshot === null;
  if ((!hasSupplier && !noSupplier) || (document.reviewStatus === 'BOOKED' && !hasSupplier)) throw new PurchaseDocumentError('Lieferantenverknüpfung ist inkonsistent.', 409, 'SOURCE_STATE');
}
function previewOf(document: PurchaseDocument): PurchaseParsePreview | null {
  if (document.parseStatus !== 'PARSED' || !document.parsedData || typeof document.parsedData !== 'object' || Array.isArray(document.parsedData)) return null;
  return document.parsedData as unknown as PurchaseParsePreview;
}
function sourceDto(document: SourceMetadata, preview: SourcePreviewSummary | null, fullPreview: PurchaseParsePreview | null = null): IncomingDocument {
  assertSourceState(document);
  const warnings = [...(preview?.parserWarnings ?? [])];
  if (!preview) warnings.push({ code: document.parseErrorCode ?? 'PARSE_PENDING', message: document.parseStatus === 'PENDING' ? 'Original archiviert. Extraktion steht aus; bitte erneut auslesen.' : document.mediaType.startsWith('image/') ? 'Foto archiviert, kein OCR. Manuelle Angaben sind nur Entwürfe; eine Ausgabe erfordert eine getrennte ausdrückliche Original- und Zahlungsfreigabe.' : document.parseErrorCode === 'NO_EMBEDDED_XML' ? 'Original archiviert. Keine eingebettete E-Rechnungs-XML gefunden; keine OCR.' : 'Original archiviert. Keine sichere strukturierte Extraktion möglich; Original manuell prüfen.' });
  if (!preview) warnings.push({ code: 'NOT_VALIDATED', message: 'Original und Extraktion sind nicht auf fachliche Konformität geprüft.' });
  return {
    id: document.id, direction: 'INCOMING', reviewState: document.reviewStatus as PurchaseReviewStatus,
    reviewStatus: document.reviewStatus as PurchaseReviewStatus, parseStatus: document.parseStatus as PurchaseParseStatus,
    validationStatus: 'NOT_VALIDATED', revision: document.revision,
    reviewedSourceSnapshot: document.reviewedSourceSnapshot as ManualPhotoSnapshot | null,
    reviewDraft: document.reviewDraft as PurchaseReviewDraft | null, reviewDraftSavedAt: document.reviewDraftSavedAt?.toISOString() ?? null,
    originalRef: { id: document.id, fileName: document.originalFileName, sha256: document.originalSha256, bytes: document.originalByteCount, mediaType: document.mediaType as PurchaseMediaType, uploadedAt: document.uploadedAt.toISOString(), downloadUrl: `/api/purchase-documents/${document.id}/original` },
    supplierName: document.supplierName, invoiceNumber: document.invoiceNumber, invoiceDate: document.invoiceDate?.toISOString() ?? null,
    currency: document.currency, totalAmount: preview?.grossAmount ?? null,
    supplierId: document.supplierId, selectedSupplierSnapshot: document.selectedSupplierSnapshot as IncomingDocument['selectedSupplierSnapshot'],
    supplierCandidate: preview?.sellerInfo ?? null, buyerCandidate: preview?.buyerInfo ?? null,
    parserWarnings: warnings, parserVersion: document.parserVersion, parseErrorCode: document.parseErrorCode,
    preview: fullPreview, businessDuplicates: [], linkedExpenseId: document.expenseId,
    dismissedAt: document.dismissedAt?.toISOString() ?? null, dismissalReason: document.dismissalReason,
    approvalSupported: document.reviewStatus === 'REVIEW' && document.parserVersion === PURCHASE_PARSER_VERSION && !!preview?.approvalSupported,
  };
}
export async function requirePurchaseDocument(userId: string, id: number): Promise<PurchaseDocument> {
  const document = await prisma.purchaseDocument.findFirst({ where: { userId, id } });
  if (!document) throw new PurchaseDocumentError('Eingangsbeleg nicht gefunden.', 404, 'NOT_FOUND');
  assertSourceState(document);
  return document;
}
/** Conservative business hints, not supplier identity. Tenant predicate is never optional. */
export async function getPurchaseBusinessDuplicates(document: PurchaseDocument): Promise<IncomingDocument['businessDuplicates']> {
  const manual = isPhotoMedia(document.mediaType) ? (document.reviewedSourceSnapshot ?? document.reviewDraft) as { supplierName?: string; invoiceNumber?: string } | null : null;
  const matches = await findPurchaseDuplicateHints(prisma, document.userId, document.id, document.supplierName ?? manual?.supplierName ?? null, document.invoiceNumber ?? manual?.invoiceNumber ?? null);
  return matches.map(match => ({ id: match.id, supplierName: match.supplierName, invoiceNumber: match.invoiceNumber,
    invoiceDate: match.invoiceDate?.toISOString() ?? null, currency: match.currency, totalAmount: exactProjectedGross(match.grossAmount),
    reviewState: match.reviewStatus as PurchaseReviewStatus, revision: match.revision, linkedExpenseId: match.expenseId }));
}
export async function purchaseDocumentDetail(userId: string, id: number): Promise<IncomingDocument> {
  const document = await requirePurchaseDocument(userId, id);
  const preview = previewOf(document);
  const dto = sourceDto(document, preview, preview);
  dto.businessDuplicates = await getPurchaseBusinessDuplicates(document);
  if (dto.businessDuplicates.length) dto.parserWarnings.push({ code: 'BUSINESS_DUPLICATE_CANDIDATE', message: 'Andere Originale mit gleichem Lieferantennamen und gleicher Rechnungsnummer gefunden. Kein Beweis identischer Lieferanten oder Rechnungen; vor Erfassung prüfen.' });
  if (dto.businessDuplicates.length > 50) dto.parserWarnings.push({ code: 'DUPLICATE_LIST_LIMITED', message: 'Weitere mögliche Dubletten vorhanden; die Prüfung ist auf 51 Hinweise begrenzt.' });
  return dto;
}
export async function listPurchaseDocuments(userId: string, params: URLSearchParams): Promise<IncomingDocumentList> {
  const pageText = params.get('page') ?? '1';
  const limitText = params.get('limit') ?? '25';
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) throw new PurchaseDocumentError('Ungültige Seitenauswahl.');
  const page = Number(pageText), limit = Number(limitText);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new PurchaseDocumentError('Ungültige Seitenauswahl.');
  const reviewStatus = params.get('reviewStatus');
  if (reviewStatus && !PURCHASE_REVIEW_STATUSES.includes(reviewStatus as PurchaseReviewStatus)) throw new PurchaseDocumentError('Ungültiger Prüfstatus.');
  const search = params.get('search')?.trim() ?? '';
  if (search.length > 200) throw new PurchaseDocumentError('Suchtext ist zu lang.');
  const where: Prisma.PurchaseDocumentWhereInput = { userId, ...(reviewStatus ? { reviewStatus } : {}), ...(search ? { OR: [{ originalFileName: { contains: search } }, { supplierName: { contains: search } }, { invoiceNumber: { contains: search } }, { reviewDraftSearch: { contains: search } }] } : {}) };
  return prisma.$transaction(async tx => {
    const [documents, total] = await Promise.all([
      tx.purchaseDocument.findMany({ where, select: SOURCE_METADATA_SELECT, orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      tx.purchaseDocument.count({ where }),
    ]);
    const projections = documents.length ? await tx.$queryRaw<ProjectedSourcePreview[]>(Prisma.sql`
      SELECT "id",
        CASE WHEN json_type("parsedData", '$.grossAmount') = 'text'
          THEN substr(json_extract("parsedData", '$.grossAmount'), 1, 101) ELSE NULL END AS "grossAmount",
        CASE WHEN json_type("parsedData", '$.approvalSupported') = 'true' THEN 1 ELSE 0 END AS "approvalSupported",
        substr(json_extract("parsedData", '$.parserWarnings'), 1, ${MAX_SUMMARY_WARNINGS_JSON + 1}) AS "parserWarnings"
      FROM "PurchaseDocument" WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(documents.map(document => document.id))})
    `) : [];
    const previews = new Map(projections.map(row => [Number(row.id), row]));
    // List summaries deliberately omit preview and party candidates; the detail endpoint supplies those cards and line items.
    return { documents: documents.map(document => sourceDto(document, document.parseStatus === 'PARSED' ? projectedPreview(previews.get(document.id)) : null)), total, page, limit };
  });
}
async function findReplay(userId: string, requestId: string, sha256: string): Promise<PurchaseDocument | null> {
  const keyed = await prisma.purchaseDocument.findUnique({ where: { userId_uploadRequestId: { userId, uploadRequestId: requestId } } });
  if (keyed) {
    if (keyed.originalSha256 !== sha256) throw new PurchaseDocumentError('Dieser Uploadschlüssel wurde bereits für ein anderes Original verwendet.', 409, 'UPLOAD_REQUEST_CONFLICT');
    return keyed;
  }
  const duplicate = await prisma.purchaseDocument.findUnique({ where: { userId_originalSha256: { userId, originalSha256: sha256 } } });
  if (duplicate) throw new PurchaseDocumentError('Dieses Original ist bereits archiviert.', 409, 'EXACT_FILE_DUPLICATE', duplicate.id);
  return null;
}
async function cleanupNewFile(userId: string, storedFileName: string): Promise<void> {
  try {
    // Never delete after an ambiguous commit; failure to prove absence leaves a safe orphan.
    const referenced = await prisma.purchaseDocument.count({ where: { userId, storedFileName } });
    if (!referenced) await deleteTenantFile(userId, storedFileName);
  } catch { /* reference-aware best-effort cleanup only */ }
}
async function saveParseResult(document: PurchaseDocument, bytes: Buffer): Promise<void> {
  const result = await parsePurchaseBytes(document.mediaType, bytes);
  await inTransaction(async tx => {
    const changed = await tx.purchaseDocument.updateMany({
      where: { id: document.id, userId: document.userId, revision: document.revision, reviewStatus: 'REVIEW', expenseId: null, storedFileName: document.storedFileName, originalSha256: document.originalSha256 },
      data: { parseStatus: result.parseStatus, parseErrorCode: result.parseErrorCode, parserVersion: PURCHASE_PARSER_VERSION,
        parsedData: result.preview ? result.preview as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        supplierName: result.parsed?.sellerInfo.name ?? null, invoiceNumber: result.parsed?.invoiceNumber ?? null,
        invoiceDate: result.parsed?.invoiceDate ?? null, currency: result.parsed?.currency && /^[A-Z]{3}$/.test(result.parsed.currency) ? result.parsed.currency : null,
        totalAmount: result.parsed?.grossAmount ?? null, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    await createFinancialAuditLog({ userId: document.userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: document.id,
      newValues: { parseStatus: result.parseStatus, parseErrorCode: result.parseErrorCode, revision: document.revision + 1 },
      metadata: { actorId: document.userId, tenantId: document.userId, operation: 'purchase-document.parse', originalReference: document.originalSha256, reason: 'structured preview only; no posting' } }, tx);
  });
}
export async function intakePurchaseDocument(input: { userId: string; requestId: string; originalFileName: string; mediaType: PurchaseMediaType; bytes: Buffer }): Promise<{ document: IncomingDocument; replayed: boolean }> {
  const sha256 = originalHash(input.bytes);
  const replay = await findReplay(input.userId, input.requestId, sha256);
  if (replay) return { document: await purchaseDocumentDetail(input.userId, replay.id), replayed: true };
  let storedFileName: string | null = null;
  let created: PurchaseDocument;
  try {
    storedFileName = await writeTenantFile(input.userId, purchaseOriginalName(input.mediaType), input.bytes);
    created = await inTransaction(async tx => {
      const document = await tx.purchaseDocument.create({ data: { userId: input.userId, originalFileName: input.originalFileName, storedFileName: storedFileName!, originalSha256: sha256, originalByteCount: input.bytes.byteLength, mediaType: input.mediaType, uploadRequestId: input.requestId } });
      await createFinancialAuditLog({ userId: input.userId, action: 'CREATE', entityType: 'PurchaseDocument', entityId: document.id,
        newValues: { originalSha256: sha256, originalByteCount: input.bytes.byteLength, mediaType: input.mediaType, reviewStatus: 'REVIEW' },
        metadata: { actorId: input.userId, tenantId: input.userId, operation: 'purchase-document.intake', originalReference: sha256, reason: 'immutable incoming source archived; no posting' } }, tx);
      return document;
    });
  } catch (error) {
    if (storedFileName) await cleanupNewFile(input.userId, storedFileName);
    if ((error as { code?: string }).code === 'P2002') {
      const winner = await findReplay(input.userId, input.requestId, sha256);
      if (winner) return { document: await purchaseDocumentDetail(input.userId, winner.id), replayed: true };
    }
    throw error;
  }
  try {
    await withProcessingSlot(input.userId, () => saveParseResult(created, input.bytes), input.requestId);
  } catch (error) {
    // A committed immutable original survives capacity/process interruption. PENDING is explicitly retryable.
    if (!(error instanceof ProcessingCapacityError) && !(error instanceof PurchaseDocumentError && error.code === 'REVISION_CONFLICT')) throw error;
  }
  return { document: await purchaseDocumentDetail(input.userId, created.id), replayed: false };
}
export async function retryPurchaseParse(userId: string, id: number, revision: number): Promise<IncomingDocument> {
  const document = await requirePurchaseDocument(userId, id);
  if (document.reviewStatus !== 'REVIEW') throw new PurchaseDocumentError('Nur offene Eingangsbelege können erneut ausgelesen werden.', 409, 'STATE_CONFLICT');
  if (document.revision !== revision) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
  const bytes = await readPurchaseOriginal(document);
  await withProcessingSlot(userId, () => saveParseResult(document, bytes));
  return purchaseDocumentDetail(userId, id);
}
export async function changePurchaseReview(userId: string, id: number, revision: number, action: 'dismiss' | 'reopen', reason?: string): Promise<IncomingDocument> {
  await inTransaction(async tx => {
    const document = await tx.purchaseDocument.findFirst({ where: { userId, id } });
    if (!document) throw new PurchaseDocumentError('Eingangsbeleg nicht gefunden.', 404, 'NOT_FOUND');
    assertSourceState(document);
    if (document.reviewStatus === 'BOOKED') throw new PurchaseDocumentError('Erfasste Quellen können hier weder verworfen noch wieder geöffnet werden.', 409, 'SOURCE_LINKED');
    if (action === 'dismiss' && document.reviewStatus === 'DISMISSED') return;
    if (document.revision !== revision) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    if (action === 'reopen' && document.reviewStatus !== 'DISMISSED') throw new PurchaseDocumentError('Nur verworfene Eingangsbelege können wieder geöffnet werden.', 409, 'STATE_CONFLICT');
    const changed = await tx.purchaseDocument.updateMany({ where: { userId, id, revision, reviewStatus: action === 'dismiss' ? 'REVIEW' : 'DISMISSED', expenseId: null }, data: { reviewStatus: action === 'dismiss' ? 'DISMISSED' : 'REVIEW', dismissedAt: action === 'dismiss' ? new Date() : null, dismissalReason: action === 'dismiss' ? reason : null, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new PurchaseDocumentError('Beleg wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    await createFinancialAuditLog({ userId, action: 'REVIEW', entityType: 'PurchaseDocument', entityId: id,
      oldValues: { reviewStatus: document.reviewStatus, revision }, newValues: { reviewStatus: action === 'dismiss' ? 'DISMISSED' : 'REVIEW', revision: revision + 1, ...(action === 'dismiss' ? { dismissalReason: reason } : {}) },
      metadata: { actorId: userId, tenantId: userId, operation: `purchase-document.${action}`, originalReference: document.originalSha256, reason: action === 'dismiss' ? reason! : 'explicit source review reopened; no posting' } }, tx);
  });
  return purchaseDocumentDetail(userId, id);
}
