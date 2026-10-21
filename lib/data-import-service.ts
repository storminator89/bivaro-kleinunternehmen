import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { parseImportCsv, normalizeImportRows, duplicateIdentity, ImportInputError, type ImportKind, type ImportColumnMapping } from '@/lib/data-import-contract';
import { serviceArticleNameKey } from '@/lib/service-articles';

export type ImportRequest = { kind: ImportKind; csv: string; mapping: ImportColumnMapping };
export type ImportPreviewRow = { line: number; data: Record<string, string | null>; errors: string[]; status: 'ready' | 'invalid' | 'duplicate'; reason?: string };
export type ImportPreview = { kind: ImportKind; fingerprint: string; rows: ImportPreviewRow[]; counts: { ready: number; invalid: number; duplicate: number } };
export type ImportResult = { kind: ImportKind; imported: number; skipped: number; createdIds: number[]; requestId: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function parseImportRequest(input: unknown): ImportRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImportInputError('Die Importanfrage muss ein Objekt sein.');
  const value = input as Record<string, unknown>;
  if (!['customers', 'articles'].includes(String(value.kind)) || typeof value.csv !== 'string'
    || !value.mapping || typeof value.mapping !== 'object' || Array.isArray(value.mapping)) throw new ImportInputError('Importart, CSV-Datei und Spaltenzuordnung sind erforderlich.');
  return { kind: value.kind as ImportKind, csv: value.csv, mapping: value.mapping as ImportColumnMapping };
}
export function parseImportRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) throw new ImportInputError('Ungültige Importkennung. Bitte die Vorschau neu öffnen.');
  return value;
}
async function previewInTransaction(tx: Prisma.TransactionClient, userId: string, input: ImportRequest): Promise<ImportPreview> {
  const normalized = normalizeImportRows(input.kind, parseImportCsv(input.csv), input.mapping);
  const records = input.kind === 'customers'
    ? await tx.customer.findMany({ where: { userId }, select: { name: true, email: true, address: true, zipCode: true, city: true } })
    : await tx.serviceArticle.findMany({ where: { userId }, select: { name: true } });
  const existing = new Set(records.map(row => duplicateIdentity(input.kind, row)));
  const seen = new Set<string>();
  const rows: ImportPreviewRow[] = normalized.map(row => {
    if (row.errors.length) return { ...row, status: 'invalid' };
    const identity = duplicateIdentity(input.kind, row.data);
    if (existing.has(identity)) return { ...row, status: 'duplicate', reason: 'Bereits im eigenen Bestand vorhanden; wird nicht verändert.' };
    if (seen.has(identity)) return { ...row, status: 'duplicate', reason: 'Bereits weiter oben in dieser Datei; nur die erste gültige Zeile wird übernommen.' };
    seen.add(identity);
    return { ...row, status: 'ready' };
  });
  const counts = { ready: rows.filter(row => row.status === 'ready').length, invalid: rows.filter(row => row.status === 'invalid').length, duplicate: rows.filter(row => row.status === 'duplicate').length };
  return { kind: input.kind, rows, counts, fingerprint: hash({ userId, kind: input.kind, rows }) };
}
export async function previewDataImport(userId: string, input: ImportRequest): Promise<ImportPreview> {
  // No persistent upload, draft, receipt or business record is written here.
  return inTransaction(tx => previewInTransaction(tx, userId, input));
}
export async function findImportResult(userId: string, requestId: string): Promise<ImportResult | null> {
  const batch = await prisma.dataImportBatch.findUnique({ where: { userId_requestId: { userId, requestId } } });
  return batch ? batch.result as unknown as ImportResult : null;
}
export async function confirmDataImport(userId: string, input: ImportRequest, requestId: string, reviewedFingerprint: string): Promise<ImportResult & { replayed: boolean }> {
  parseImportRequestId(requestId);
  if (!/^[a-f0-9]{64}$/.test(reviewedFingerprint)) throw new ImportInputError('Bitte zuerst die Vorschau prüfen.');
  const fingerprint = hash({ input, reviewedFingerprint });
  return inTransaction(async tx => {
    const prior = await tx.dataImportBatch.findUnique({ where: { userId_requestId: { userId, requestId } } });
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ImportInputError('Diese Importkennung wurde bereits für eine andere Auswahl verwendet.', 409);
      return { ...prior.result as unknown as ImportResult, replayed: true };
    }
    const preview = await previewInTransaction(tx, userId, input);
    if (preview.fingerprint !== reviewedFingerprint) throw new ImportInputError('Der Bestand hat sich geändert. Bitte die Vorschau erneut prüfen; es wurde nichts importiert.', 409);
    if (!preview.counts.ready) throw new ImportInputError('Keine neuen gültigen Zeilen zum Importieren.');
    const createdIds: number[] = [];
    for (const row of preview.rows.filter(row => row.status === 'ready')) {
      if (input.kind === 'customers') {
        const data = row.data;
        const customer = await tx.customer.create({ data: { userId, name: data.name!, email: data.email, address: data.address, zipCode: data.zipCode, city: data.city, contactPerson: data.contactPerson, phone: data.phone, taxNumber: data.taxNumber, noteVisibility: 'EDITOR' } });
        createdIds.push(customer.id);
      } else {
        const data = row.data;
        const article = await tx.serviceArticle.create({ data: { userId, name: data.name!, nameKey: serviceArticleNameKey(data.name!), description: data.description || '', unit: data.unit!, unitPriceCents: data.unitPriceCents!, sourcePriceCents: data.sourcePriceCents!, sourcePriceBasis: data.sourcePriceBasis!, taxRate: data.taxRate! } });
        createdIds.push(article.id);
      }
    }
    const result: ImportResult = { kind: input.kind, imported: createdIds.length, skipped: preview.counts.invalid + preview.counts.duplicate, createdIds, requestId };
    await tx.dataImportBatch.create({ data: { userId, requestId, fingerprint, kind: input.kind, result: result as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId, action: 'CSV_IMPORT', entityType: input.kind === 'customers' ? 'Customer' : 'ServiceArticle', entityId: requestId, metadata: JSON.stringify({ kind: input.kind, imported: result.imported, skipped: result.skipped, sourceSha256: createHash('sha256').update(input.csv, 'utf8').digest('hex'), createdIds }) } });
    return { ...result, replayed: false };
  });
}
