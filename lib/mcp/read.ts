import { McpOperationError } from './errors';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { readInvoiceList } from '@/lib/server/invoice-list';
import { assertPositiveOnlySnapshot } from '@/lib/payment-journal/consumer-guard';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { readPurchaseOriginal } from '@/lib/purchase-documents/original';
import { MCP_COLLECTIONS, type McpCollection } from './catalog';

export const collectionSchema = z.enum(Object.keys(MCP_COLLECTIONS) as [McpCollection, ...McpCollection[]]);
export const readSchema = z.object({ collection: collectionSchema, page: z.number().int().min(1).max(100_000).default(1), limit: z.number().int().min(1).max(50).default(20), id: z.union([z.number().int().positive(), z.string().min(1).max(128)]).optional(), search: z.string().max(200).optional() }).strict();
export const recordVersion = (row: unknown) => createHash('sha256').update(JSON.stringify(row)).digest('hex');
export const collectionSelect = (collection: McpCollection) => Object.fromEntries(MCP_COLLECTIONS[collection].fields.split(' ').map(field => [field, true]));
type Delegate = { findMany(args: unknown): Promise<Record<string, unknown>[]>; count(args: unknown): Promise<number> };

export async function readMcpCollection(userId: string, raw: z.input<typeof readSchema>) {
  const { collection, page, limit, id, search } = readSchema.parse(raw);
  if (collection === 'invoices') {
    if (id !== undefined && (typeof id !== 'number' || !Number.isSafeInteger(id))) throw new McpOperationError('Eine numerische Rechnungs-ID ist erforderlich.');
    const response = await readInvoiceList(userId, new Headers({ 'X-Bivaro-Payment-Contract': '3' }), { page, pageSize: limit, search, ...(id !== undefined ? { documentId: id } : {}) });
    const body = await response.json();
    if (!response.ok) throw new McpOperationError(body.error || 'Rechnungsauswahl nicht verfügbar.');
    // Parsed document data is available separately; list balances always use the validated ledger.
    const ids = body.items.map((row: { id: number }) => row.id);
    const sources = await prisma.invoice.findMany({ where: { userId, id: { in: ids } }, select: { id: true, parsedData: true } });
    const fields = [...MCP_COLLECTIONS.invoices.fields.split(' '), 'incomes', 'customer', 'paymentSummary', 'paymentLedger', 'paymentContractVersion', 'paymentReviewRequired', 'canRecordPayment', 'hasEInvoiceXml', 'hasPdfFile'];
    return { ...body, hasMore: page * limit < body.total, items: body.items.map((row: { id: number } & Record<string, unknown>) => ({ ...Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]])), parsedData: sources.find(item => item.id === row.id)?.parsedData })) };
  }
  if (collection === 'numbering' && id !== undefined) throw new McpOperationError('Nummernregeln über die Liste nach Typ und Revision lesen.');
  const definition = MCP_COLLECTIONS[collection];
  const where = { userId, ...(id !== undefined ? { id } : {}), ...(search && definition.search ? { [definition.search]: { contains: search } } : {}) };
  if (search && !definition.search) throw new McpOperationError('Diese Sammlung unterstützt keine Textsuche.');
  return prisma.$transaction(async tx => {
    if (collection === 'incomes' || collection === 'expenses') await assertPositiveOnlySnapshot(tx, userId);
    const delegate = (tx as unknown as Record<string, Delegate>)[definition.model];
    const [items, total] = await Promise.all([
      delegate.findMany({ where, select: collectionSelect(collection), orderBy: collection === 'numbering' ? [{ type: 'asc' }, { revision: 'asc' }] : { id: 'asc' }, skip: (page - 1) * limit, take: limit }),
      delegate.count({ where }),
    ]);
    return { items: items.map(row => ({ ...row, _version: recordVersion(row) })), total, page, pageSize: limit, hasMore: page * limit < total,
      interpretation: 'Quellnachweise sind keine zusätzlichen Buchungen. Originalzahlung und Einnahme nicht addieren; aktuelle Zahlungsstände mit bivaro_payment_journal lesen.' };
  });
}

export async function readMcpSettings(userId: string) {
  return prisma.settings.findUnique({ where: { userId }, select: { companyName: true, companyAddress: true, email: true, telephone: true, taxNumber: true, bankName: true, iban: true, bic: true, footerText: true, paymentTermDays: true, fiscalTaxRegime: true, fiscalEffectiveFrom: true, fiscalConfirmedAt: true } });
}

/** Ownership first, existing file resolvers, bounded byte ranges; no caller supplied path. */
export async function readMcpOriginal(userId: string, kind: 'invoice' | 'purchase', id: number, offset: number) {
  let bytes: Buffer;
  let fileName: string;
  let mediaType: string;
  if (kind === 'purchase') {
    const row = await prisma.purchaseDocument.findFirst({ where: { userId, id } });
    if (!row) throw new McpOperationError('Beleg nicht gefunden.');
    bytes = await readPurchaseOriginal(row);
    fileName = row.originalFileName; mediaType = row.mediaType;
  } else {
    const row = await prisma.invoice.findFirst({ where: { userId, id }, select: { storedFileName: true, fileName: true } });
    if (!row) throw new McpOperationError('Rechnung nicht gefunden.');
    const file = await findOwnedUploadedFile(userId, row.storedFileName);
    if (!file || (await stat(file)).size > 25 * 1024 * 1024) throw new McpOperationError('Original fehlt oder überschreitet 25 MiB.');
    bytes = await readFile(file); fileName = row.fileName; mediaType = fileName.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/pdf';
  }
  const length = 128 * 1024;
  if (offset > bytes.length) throw new McpOperationError('Offset außerhalb der Datei.');
  const chunk = bytes.subarray(offset, offset + length);
  return { fileName, mediaType, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, offset, base64: chunk.toString('base64'), nextOffset: offset + chunk.length < bytes.length ? offset + chunk.length : null };
}
