import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { deleteTenantFile, writeTenantFile } from '@/lib/upload-path';
import { getNextDocumentNumber } from '@/lib/invoice-numbers';
import { ProcessingCapacityError, withProcessingSlot } from '@/lib/processing-limit';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import {
  isRequestBodyWithinLimit,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_XML_INPUT_BYTES,
} from '@/lib/resource-limits';
import {
  extractEmbeddedEInvoiceXml,
  getEInvoiceImportRejection,
  parseEInvoiceXml,
  type ParsedEInvoice,
} from '@/lib/e-invoice-parser';
import {
  BillingNoteClaimError,
  BillingNoteInputError,
  MAX_BILLING_NOTES_PER_REQUEST,
  claimBillingNotesForInvoice,
  customerNameMatchesInvoiceBuyer,
  parsePositiveId,
} from '@/lib/billing-notes';

type SupportedInvoiceFileKind = 'pdf' | 'xml';

class QuoteConversionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'QuoteConversionError';
  }
}

class UploadIdempotencyConflictError extends Error {
  readonly status = 409;

  constructor() {
    super('Diese Upload-Anfrage wurde bereits mit anderen Rechnungsdaten verarbeitet.');
    this.name = 'UploadIdempotencyConflictError';
  }
}

const XML_MIME_TYPES = new Set([
  'application/xml',
  'text/xml',
  'application/x-xml',
  'application/octet-stream',
]);

function getSupportedFileKind(file: File): SupportedInvoiceFileKind | null {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (XML_MIME_TYPES.has(mimeType) || lowerName.endsWith('.xml')) return 'xml';
  return null;
}

function parseBillingNoteIds(value: FormDataEntryValue | null): number[] {
  if (value === null || value === '') return [];
  if (typeof value !== 'string') throw new BillingNoteInputError('Ungültige Leistungsnotizen');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BillingNoteInputError('billingNoteIds muss ein JSON-Array sein');
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_BILLING_NOTES_PER_REQUEST) {
    throw new BillingNoteInputError('Ungültige Leistungsnotizen');
  }
  return parsed.map(item => parsePositiveId(item, 'Leistungsnotiz-ID'));
}

function parseSelectedCustomerId(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new BillingNoteInputError('Ungültige Kunden-ID');
  return parsePositiveId(value, 'Kunden-ID');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parseGeneratedRequestId(value: FormDataEntryValue | null): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BillingNoteInputError('Ungültige Upload-Anfrage-ID');
  }
  return value.toLowerCase();
}

/** Stable identity for a retry of one generated upload request. */
function buildInvoiceUploadFingerprint(
  rawXml: string,
  customerId: number | null,
  billingNoteIds: number[],
  fromQuoteId: number | null,
): string {
  return createHash('sha256')
    .update(rawXml)
    .update('\0')
    .update(String(customerId ?? ''))
    .update('\0')
    .update(JSON.stringify([...billingNoteIds].sort((a, b) => a - b)))
    .update('\0')
    .update(String(fromQuoteId ?? ''))
    .digest('hex');
}

type UploadRequestMetadata = { requestId: string; fingerprint: string };

function getUploadRequestMetadata(value: unknown): UploadRequestMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = (value as Record<string, unknown>)._uploadRequest;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const requestId = (metadata as Record<string, unknown>).requestId;
  const fingerprint = (metadata as Record<string, unknown>).fingerprint;
  if (typeof requestId !== 'string' || typeof fingerprint !== 'string') return null;
  return { requestId, fingerprint };
}

async function findUploadRequestInvoice(
  db: Pick<Prisma.TransactionClient, 'invoice' | '$queryRaw'>,
  userId: string,
  requestId: string,
) {
  // Keep this lookup bounded by the tenant and request marker. SQLite's JSON1
  // function is available in the deployed SQLite runtime, while Prisma's
  // SQLite JSON path filter support is version-dependent.
  const matches = await db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id" FROM "Invoice"
    WHERE "userId" = ${userId}
      AND "type" = 'INVOICE'
      AND json_extract("parsedData", '$._uploadRequest.requestId') = ${requestId}
    LIMIT 1
  `);
  const match = matches[0];
  if (!match) return null;
  return db.invoice.findUnique({ where: { id: match.id }, include: { income: true } });
}

function decodeStandaloneXml(buffer: Buffer): string | null {
  const xmlContent = new TextDecoder().decode(buffer).replace(/^\uFEFF/, '').trim();
  return xmlContent.startsWith('<') ? xmlContent : null;
}

async function getInvoiceXmlContent(fileKind: SupportedInvoiceFileKind, buffer: Buffer): Promise<string | null> {
  if (fileKind === 'pdf') {
    return extractEmbeddedEInvoiceXml(buffer);
  }
  return decodeStandaloneXml(buffer);
}

async function findOrCreateCustomer(
  parsedInvoice: ParsedEInvoice,
  userId: string,
  db: Pick<Prisma.TransactionClient, 'customer'> = prisma,
) {
  const customerName = parsedInvoice.customerName;
  if (!customerName) return null;

  const existingCustomer = await db.customer.findFirst({
    where: { name: customerName, userId },
  });

  if (existingCustomer) return existingCustomer;

  return db.customer.create({
    data: {
      name: customerName,
      email: parsedInvoice.buyerInfo.email ?? undefined,
      address: parsedInvoice.buyerInfo.address ?? undefined,
      zipCode: parsedInvoice.buyerInfo.zipCode ?? undefined,
      city: parsedInvoice.buyerInfo.city ?? undefined,
      userId,
    },
  });
}

function toStoredParsedData(parsedInvoice: ParsedEInvoice, uploadRequest?: UploadRequestMetadata) {
  return {
    extractionStatus: parsedInvoice.extractionStatus,
    validationStatus: parsedInvoice.validationStatus,
    documentType: parsedInvoice.documentType,
    documentTypeCode: parsedInvoice.documentTypeCode,
    currency: parsedInvoice.currency,
    invoiceNumber: parsedInvoice.invoiceNumber,
    invoiceDate: parsedInvoice.invoiceDate ? parsedInvoice.invoiceDate.toISOString() : null,
    dueDate: parsedInvoice.dueDate ? parsedInvoice.dueDate.toISOString() : null,
    grossAmount: parsedInvoice.grossAmount,
    prepaidAmount: parsedInvoice.prepaidAmount,
    roundingAmount: parsedInvoice.roundingAmount,
    dueAmount: parsedInvoice.dueAmount,
    netAmount: parsedInvoice.netAmount,
    taxAmount: parsedInvoice.taxAmount,
    lineTotalAmount: parsedInvoice.lineTotalAmount,
    chargeTotalAmount: parsedInvoice.chargeTotalAmount,
    allowanceTotalAmount: parsedInvoice.allowanceTotalAmount,
    totalAmount: parsedInvoice.totalAmount,
    customerName: parsedInvoice.customerName,
    lineItems: parsedInvoice.lineItems,
    buyerInfo: parsedInvoice.buyerInfo,
    sellerInfo: parsedInvoice.sellerInfo,
    rawXml: parsedInvoice.rawXml,
    eInvoiceFormat: parsedInvoice.format,
    ...(uploadRequest ? { _uploadRequest: uploadRequest } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!isRequestBodyWithinLimit(request, MAX_INVOICE_UPLOAD_BYTES + 128 * 1024)) {
      return NextResponse.json({ error: 'Anfrage ist zu groß' }, { status: 413 });
    }
    const boundedBody = await readRequestBodyWithinLimit(request, MAX_INVOICE_UPLOAD_BYTES + 128 * 1024);
    const formData = await requestWithBody(request, boundedBody).formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    let selectedCustomerId: number | null;
    let billingNoteIds: number[];
    let generatedRequestId: string | null;
    try {
      selectedCustomerId = parseSelectedCustomerId(formData.get('selectedCustomerId'));
      billingNoteIds = parseBillingNoteIds(formData.get('billingNoteIds'));
      generatedRequestId = parseGeneratedRequestId(formData.get('generatedRequestId'));
    } catch (error) {
      if (error instanceof BillingNoteInputError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    if (billingNoteIds.length > 0 && selectedCustomerId === null) {
      return NextResponse.json({ error: 'Leistungsnotizen benötigen einen ausgewählten Kunden' }, { status: 400 });
    }

    const fileKind = getSupportedFileKind(file);
    if (!fileKind) {
      return NextResponse.json({ error: 'Nur PDF- oder XML-E-Rechnungen werden unterstützt' }, { status: 400 });
    }

    const maxFileBytes = fileKind === 'pdf' ? MAX_INVOICE_UPLOAD_BYTES : MAX_XML_INPUT_BYTES;
    if (file.size > maxFileBytes) {
      return NextResponse.json({ error: 'Datei ist zu groß' }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.byteLength > maxFileBytes) {
      return NextResponse.json({ error: 'Datei ist zu groß' }, { status: 413 });
    }
    let xmlContent: string | null = null;
    let parsedInvoice: ParsedEInvoice;
    try {
      const parsed = await withProcessingSlot(userId, async () => {
        const extracted = await getInvoiceXmlContent(fileKind, buffer);
        if (!extracted) return { extracted, parsed: null };
        return { extracted, parsed: await parseEInvoiceXml(extracted) };
      });
      xmlContent = parsed.extracted;
      if (!parsed.parsed) {
        const message = fileKind === 'pdf'
          ? 'Keine ZUGFeRD-/Factur-X-XML in der PDF-Datei gefunden'
          : 'Die XML-Datei konnte nicht als E-Rechnung gelesen werden';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      parsedInvoice = parsed.parsed;
    } catch (error) {
      if (error instanceof ProcessingCapacityError) {
        const response = NextResponse.json({ error: error.message }, { status: error.status });
        response.headers.set('Retry-After', '1');
        return response;
      }
      if (error instanceof RequestBodyLimitError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      const message = error instanceof Error ? error.message : 'Ungültige E-Rechnungs-XML';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const importRejection = getEInvoiceImportRejection(parsedInvoice);
    if (importRejection) {
      return NextResponse.json({ error: importRejection }, { status: 422 });
    }

    // Keep this explicit for type narrowing and to document that only the
    // bounded, parsed XML is persisted below.
    if (!xmlContent) return NextResponse.json({ error: 'Ungültige E-Rechnungs-XML' }, { status: 400 });

    const queryFromQuoteValue = new URL(request.url).searchParams.get('fromQuoteId');
    const formFromQuoteValue = formData.get('fromQuoteId');
    if (queryFromQuoteValue !== null && formFromQuoteValue !== null && String(formFromQuoteValue) !== queryFromQuoteValue) {
      return NextResponse.json({ error: 'Widersprüchliche Angebotsreferenz' }, { status: 400 });
    }
    const fromQuoteValue = queryFromQuoteValue ?? formFromQuoteValue;
    const fromQuoteId = fromQuoteValue === null || fromQuoteValue === '' ? null : Number(fromQuoteValue);
    if (fromQuoteId !== null && (!Number.isSafeInteger(fromQuoteId) || fromQuoteId <= 0)) {
      return NextResponse.json({ error: 'Ungültige Angebotsreferenz' }, { status: 400 });
    }

    let sourceQuote: { id: number; status: string; convertedInvoice?: { id: number } | null } | null = null;
    if (fromQuoteId !== null) {
      sourceQuote = await prisma.invoice.findFirst({
        where: { id: fromQuoteId, userId, type: 'QUOTE' },
        select: { id: true, status: true, convertedInvoice: { select: { id: true } } },
      });
      if (!sourceQuote) return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
      if (sourceQuote.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Stornierte Angebote können nicht umgewandelt werden' }, { status: 409 });
      }
      if (sourceQuote.convertedInvoice) {
        const existing = await prisma.invoice.findUnique({ where: { id: sourceQuote.convertedInvoice.id }, include: { income: true } });
        return NextResponse.json({ ...existing, idempotent: true });
      }
    }

    const invoiceDate = parsedInvoice.invoiceDate || new Date();
    if (Number.isNaN(invoiceDate.getTime()) || (parsedInvoice.dueDate && Number.isNaN(parsedInvoice.dueDate.getTime()))) {
      return NextResponse.json({ error: 'Ungültiges Rechnungsdatum' }, { status: 400 });
    }
    if (parsedInvoice.totalAmount !== null && !Number.isFinite(parsedInvoice.totalAmount)) {
      return NextResponse.json({ error: 'Ungültiger Rechnungsbetrag' }, { status: 400 });
    }

    let selectedCustomer: { id: number; name: string } | null = null;
    if (selectedCustomerId !== null) {
      selectedCustomer = await prisma.customer.findFirst({
        where: { id: selectedCustomerId, userId },
        select: { id: true, name: true },
      });
      if (!selectedCustomer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
      if (!customerNameMatchesInvoiceBuyer(selectedCustomer.name, parsedInvoice.customerName)) {
        return NextResponse.json({ error: 'Der ausgewählte Kunde entspricht nicht dem Rechnungsempfänger' }, { status: 409 });
      }
    }

    // An omitted selectedCustomerId remains null for both the first request
    // and its retry, even if findOrCreateCustomer creates a row meanwhile.
    const fingerprintCustomerId = selectedCustomerId;
    const uploadFingerprint = generatedRequestId
      ? buildInvoiceUploadFingerprint(parsedInvoice.rawXml, fingerprintCustomerId, billingNoteIds, fromQuoteId)
      : null;
    if (generatedRequestId && uploadFingerprint) {
      const existing = await findUploadRequestInvoice(prisma, userId, generatedRequestId);
      if (existing) {
        const metadata = getUploadRequestMetadata(existing.parsedData);
        if (!metadata || metadata.fingerprint !== uploadFingerprint) throw new UploadIdempotencyConflictError();
        return NextResponse.json({ ...existing, idempotent: true });
      }
    }

    if (parsedInvoice.invoiceNumber) {
      const existingInvoice = await prisma.invoice.findFirst({
        where: { invoiceNumber: parsedInvoice.invoiceNumber, userId },
      });

      if (existingInvoice) {
        return NextResponse.json(
          { error: `Eine Rechnung mit der Nummer ${parsedInvoice.invoiceNumber} existiert bereits.` },
          { status: 409 }
        );
      }
    }

    let storedFileName: string | null = null;
    try {
      storedFileName = await writeTenantFile(userId, file.name, buffer);
      const transactionResult = await inTransaction(async (tx) => {
        // Re-read and claim the quote in the same transaction as invoice
        // creation. The preflight check above is only an early response; it
        // must never authorize a stale status or conversion relation.
        const currentQuote = sourceQuote
          ? await tx.invoice.findFirst({
            where: { id: sourceQuote.id, userId, type: 'QUOTE' },
            select: { id: true, status: true, convertedInvoice: { select: { id: true } } },
          })
          : null;
        if (sourceQuote && !currentQuote) {
          throw new QuoteConversionError('Angebot nicht gefunden', 404);
        }
        if (currentQuote?.status === 'CANCELLED') {
          throw new QuoteConversionError('Stornierte Angebote können nicht umgewandelt werden', 409);
        }
        if (currentQuote?.convertedInvoice) {
          const existing = await tx.invoice.findUnique({
            where: { id: currentQuote.convertedInvoice.id },
            include: { income: true },
          });
          if (existing) return { invoice: existing, idempotent: true };
          throw new QuoteConversionError('Die Angebotsumwandlung ist inkonsistent', 409);
        }

        if (generatedRequestId && uploadFingerprint) {
          const existing = await findUploadRequestInvoice(tx, userId, generatedRequestId);
          if (existing) {
            const metadata = getUploadRequestMetadata(existing.parsedData);
            if (!metadata || metadata.fingerprint !== uploadFingerprint) throw new UploadIdempotencyConflictError();
            return { invoice: existing, idempotent: true };
          }
        }

        const conversionQuoteId = currentQuote?.id ?? null;
        if (conversionQuoteId) {
          const claimed = await tx.invoice.updateMany({
            where: {
              id: conversionQuoteId,
              userId,
              type: 'QUOTE',
              status: { not: 'CANCELLED' },
              convertedInvoice: { is: null },
            },
            data: { status: 'ACCEPTED' },
          });
          if (claimed.count !== 1) {
            const racedQuote = await tx.invoice.findFirst({
              where: { id: conversionQuoteId, userId, type: 'QUOTE' },
              select: { status: true, convertedInvoice: { select: { id: true } } },
            });
            if (racedQuote?.convertedInvoice) {
              const existing = await tx.invoice.findUnique({
                where: { id: racedQuote.convertedInvoice.id },
                include: { income: true },
              });
              if (existing) return { invoice: existing, idempotent: true };
            }
            if (racedQuote?.status === 'CANCELLED') {
              throw new QuoteConversionError('Stornierte Angebote können nicht umgewandelt werden', 409);
            }
            throw new QuoteConversionError('Das Angebot wurde bereits geändert. Bitte erneut versuchen.', 409);
          }
        }

        const customerRecord = selectedCustomer
          ? await tx.customer.findFirst({ where: { id: selectedCustomer.id, userId } })
          : await findOrCreateCustomer(parsedInvoice, userId, tx);
        if (selectedCustomer && (!customerRecord || !customerNameMatchesInvoiceBuyer(customerRecord.name, parsedInvoice.customerName))) {
          throw new BillingNoteClaimError('Der ausgewählte Kunde entspricht nicht dem Rechnungsempfänger', 409);
        }
        const invoiceNumber = parsedInvoice.invoiceNumber || await getNextDocumentNumber(tx, userId, 'INVOICE', invoiceDate.getFullYear());
        const created = await tx.invoice.create({
          data: {
            type: 'INVOICE',
            fileName: file.name,
            storedFileName: storedFileName!,
            invoiceNumber,
            invoiceDate,
            dueDate: parsedInvoice.dueDate,
            totalAmount: parsedInvoice.totalAmount ?? undefined,
            parsedData: toStoredParsedData(parsedInvoice, generatedRequestId && uploadFingerprint
              ? { requestId: generatedRequestId, fingerprint: uploadFingerprint }
              : undefined),
            customerId: customerRecord?.id,
            // Uploaded/imported documents have no trusted never-issued proof.
            issuanceState: 'UNKNOWN',
            userId,
            ...(conversionQuoteId ? { convertedFromQuoteId: conversionQuoteId } : {}),
          },
        });
        if (billingNoteIds.length > 0) {
          await claimBillingNotesForInvoice(tx, {
            userId,
            customerId: customerRecord!.id,
            invoiceId: created.id,
            billingNoteIds,
            lineItems: parsedInvoice.lineItems,
          });
        }
        await createFinancialAuditLog({
          userId,
          action: 'CREATE',
          entityType: 'Invoice',
          entityId: created.id,
          entityName: created.invoiceNumber || created.fileName,
          newValues: {
            status: created.status,
            issuanceState: created.issuanceState,
            invoiceNumber: created.invoiceNumber,
            billingNoteIds: billingNoteIds.length > 0 ? billingNoteIds : undefined,
          },
          metadata: {
            actorId: userId,
            tenantId: userId,
            operation: 'invoice.upload',
            originalReference: created.invoiceNumber ?? `invoice:${created.id}`,
            reason: 'invoice draft uploaded',
          },
        }, tx);
        return { invoice: created, idempotent: false };
      });

      if (transactionResult.idempotent && storedFileName) {
        try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort orphan cleanup */ }
        storedFileName = null;
      }
      return NextResponse.json({ ...transactionResult.invoice, ...(transactionResult.idempotent ? { idempotent: true } : {}) });
    } catch (error) {
      // A unique conversion race is idempotent: return the winner's invoice.
      if (sourceQuote && (error as { code?: string }).code === 'P2002') {
        const existing = await prisma.invoice.findFirst({ where: { convertedFromQuoteId: sourceQuote.id, userId }, include: { income: true } });
        if (existing) {
          if (storedFileName) {
            try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort cleanup */ }
          }
          return NextResponse.json({ ...existing, idempotent: true });
        }
      }
      if (generatedRequestId && uploadFingerprint && (error as { code?: string }).code === 'P2002') {
        const existing = await findUploadRequestInvoice(prisma, userId, generatedRequestId);
        if (existing) {
          const metadata = getUploadRequestMetadata(existing.parsedData);
          if (!metadata || metadata.fingerprint !== uploadFingerprint) throw new UploadIdempotencyConflictError();
          if (storedFileName) {
            try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort cleanup */ }
          }
          return NextResponse.json({ ...existing, idempotent: true });
        }
      }
      if (storedFileName) {
        try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort cleanup */ }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof QuoteConversionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BillingNoteClaimError || error instanceof BillingNoteInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof UploadIdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Die Rechnungsnummer ist bereits vergeben.' }, { status: 409 });
    }
    console.error('Fehler beim Hochladen der Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Verarbeiten der Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
