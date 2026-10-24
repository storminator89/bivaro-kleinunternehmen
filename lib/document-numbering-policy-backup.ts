import { QUOTE_CREATE_UUID, quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import type { Prisma } from '@prisma/client';
import { DOCUMENT_TYPES, defaultNumberingPolicy, numberingNamespacesOverlap, documentNumberCounterFloors, isDocumentType, MAX_NUMBERING_REVISIONS, validateNumberingFormat, type NumberingPolicy } from '@/lib/document-numbering-policy';
export { documentNumberCounterFloors } from '@/lib/document-numbering-policy';
export type NumberingPolicyBackup = NumberingPolicy & { createdAt: string };
export function numberingPoliciesFromBackup(data: Record<string, unknown>, supported: boolean): NumberingPolicyBackup[] {
  if (!supported) {
    if (data.documentNumberingPolicies !== undefined) throw new Error('Älteres Backupschema darf keine Nummernformat-Revisionen enthalten.');
    return [];
  }
  const input = data.documentNumberingPolicies;
  if (!Array.isArray(input) || input.length > MAX_NUMBERING_REVISIONS * DOCUMENT_TYPES.length) throw new Error('Ungültiger Nummernformat-Verlauf im Backup.');
  const rows = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Nummernformat-Revision.');
    const row = value as Record<string, unknown>;
    const allowed = ['type', 'revision', 'formatVersion', 'prefix', 'includeYear', 'sequenceWidth', 'startSequence', 'effectiveYear', 'createdAt'];
    if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error('Unbekanntes Feld in Nummernformat-Revision.');
    const date = row.createdAt instanceof Date ? row.createdAt : typeof row.createdAt === 'string' ? new Date(row.createdAt) : null;
    if (!date || !Number.isFinite(date.getTime()) || (typeof row.createdAt === 'string' && date.toISOString() !== row.createdAt)) throw new Error('Ungültiges Datum der Nummernformat-Revision.');
    if (!isDocumentType(row.type) || typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > MAX_NUMBERING_REVISIONS) throw new Error('Ungültige Nummernformat-Revision.');
    return { ...validateNumberingFormat(row), type: row.type, revision: row.revision, createdAt: date.toISOString() };
  });
  for (const type of DOCUMENT_TYPES) {
    const history = rows.filter(row => row.type === type).sort((a, b) => a.revision - b.revision);
    if (history.some((row, index) => row.revision !== index + 1 || (index > 0 && row.createdAt < history[index - 1].createdAt))) throw new Error('Nummernformat-Verlauf ist nicht vollständig oder enthält doppelte Revisionen.');
  }
  const current = DOCUMENT_TYPES.map(type => rows.filter(row => row.type === type).sort((a, b) => a.revision - b.revision).at(-1) ?? defaultNumberingPolicy(type, 2000));
  for (let left = 0; left < current.length; left++) for (let right = left + 1; right < current.length; right++) if (numberingNamespacesOverlap(current[left], current[right])) throw new Error('Nummernformate verschiedener Dokumentarten überschneiden sich im Backup.');
  return rows;
}
function identity(row: NumberingPolicy & { createdAt: Date | string }): string { return JSON.stringify({ type: row.type, revision: row.revision, ...validateNumberingFormat(row), createdAt: new Date(row.createdAt).toISOString() }); }
/** Call inside the restore transaction, before any deletion. Never erase current settings, even for overwrite. */
export async function restoreDocumentNumberingPolicies(tx: Prisma.TransactionClient, userId: string, rows: NumberingPolicyBackup[]): Promise<{ imported: number; skipped: number }> {
  const existing = await tx.documentNumberingPolicy.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { revision: 'asc' }], take: MAX_NUMBERING_REVISIONS * DOCUMENT_TYPES.length + 1 });
  if (existing.length > MAX_NUMBERING_REVISIONS * DOCUMENT_TYPES.length) throw new Error('Nummernformat-Verlauf im Ziel ist zu groß.');
  numberingPoliciesFromBackup({ documentNumberingPolicies: existing.map(({ userId: _userId, ...row }) => row) }, true);
  let imported = 0;
  for (const row of rows) {
    const previous = existing.find(value => value.type === row.type && value.revision === row.revision);
    if (previous && identity({ ...previous, type: previous.type as NumberingPolicy['type'], formatVersion: 1 }) !== identity(row)) throw new Error('Nummernformat-Revision weicht im Ziel ab. Wiederherstellung wurde blockiert.');
  }
  const combined = existing.map(({ userId: _userId, ...row }) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  for (const row of rows) if (!combined.some(value => value.type === row.type && value.revision === row.revision)) combined.push(row);
  numberingPoliciesFromBackup({ documentNumberingPolicies: combined }, true);
  // The high-water marks of documents about to be deleted must survive overwrite.
  const invoices = await tx.invoice.findMany({ where: { userId, invoiceNumber: { not: null } }, select: { type: true, invoiceNumber: true }, take: 10_001 });
  if (invoices.length > 10_000) throw new Error('Nummernprüfung ist für diesen Bestand zu groß.');
  const policies = [...existing.map(row => ({ ...validateNumberingFormat(row), type: row.type as NumberingPolicy['type'], revision: row.revision })), ...rows];
  for (const counter of documentNumberCounterFloors(invoices, policies)) {
    const key = { userId, type: counter.type, year: counter.year };
    const stored = await tx.invoiceNumberCounter.findUnique({ where: { userId_type_year: key } });
    await tx.invoiceNumberCounter.upsert({ where: { userId_type_year: key }, create: { ...key, value: counter.value }, update: { value: Math.max(stored?.value ?? 0, counter.value) } });
  }
  for (const row of rows) if (!existing.some(value => value.type === row.type && value.revision === row.revision)) {
    await tx.documentNumberingPolicy.create({ data: { userId, ...row, createdAt: new Date(row.createdAt) } });
    imported++;
  }
  return { imported, skipped: rows.length - imported };
}

/** Validate durable quote-create metadata against the portable source data itself. */
export function validateQuoteCreateIdentityFields(invoice: Record<string, unknown>, supported: boolean): { quoteCreateRequestId: string | null; quoteCreateFingerprint: string | null } {
  const id = invoice.quoteCreateRequestId;
  const fingerprint = invoice.quoteCreateFingerprint;
  if (id == null && fingerprint == null) return { quoteCreateRequestId: null, quoteCreateFingerprint: null };
  if (!supported) throw new Error('Älteres Backupschema unterstützt keine dauerhafte Angebotsanfrage-Identität.');
  if (invoice.type !== 'QUOTE' || typeof id !== 'string' || !QUOTE_CREATE_UUID.test(id) || id !== id.toLowerCase() || typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Ungültige dauerhafte Angebotsanfrage-Identität.');
  if (quoteCreateFingerprintForInvoice(invoice) !== fingerprint) throw new Error('Angebotsanfrage-Prüfsumme passt nicht zu den unveränderten Quelldaten.');
  return { quoteCreateRequestId: id, quoteCreateFingerprint: fingerprint };
}

export type QuoteCreateReceiptBackup = { requestId: string; fingerprint: string; pdfSha256: string; invoiceId: number | null; createdAt: string };
const HASH = /^[0-9a-f]{64}$/;
function readReceipt(value: unknown): QuoteCreateReceiptBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger Angebotsanfrage-Nachweis.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['requestId', 'fingerprint', 'pdfSha256', 'invoiceId', 'createdAt'].includes(key))) throw new Error('Unbekanntes Feld im Angebotsanfrage-Nachweis.');
  const date = row.createdAt instanceof Date ? row.createdAt : typeof row.createdAt === 'string' ? new Date(row.createdAt) : null;
  if (typeof row.requestId !== 'string' || !QUOTE_CREATE_UUID.test(row.requestId) || row.requestId !== row.requestId.toLowerCase() || typeof row.fingerprint !== 'string' || !HASH.test(row.fingerprint) || typeof row.pdfSha256 !== 'string' || !HASH.test(row.pdfSha256) || (row.invoiceId !== null && (typeof row.invoiceId !== 'number' || !Number.isSafeInteger(row.invoiceId) || row.invoiceId <= 0)) || !date || !Number.isFinite(date.getTime()) || (typeof row.createdAt === 'string' && date.toISOString() !== row.createdAt)) throw new Error('Ungültiger Angebotsanfrage-Nachweis.');
  return { requestId: row.requestId, fingerprint: row.fingerprint, pdfSha256: row.pdfSha256, invoiceId: row.invoiceId, createdAt: date.toISOString() };
}
export function quoteCreateReceiptsFromBackup(data: Record<string, unknown>, supported: boolean): QuoteCreateReceiptBackup[] {
  if (!supported) { if (data.quoteCreateReceipts !== undefined) throw new Error('Älteres Backupschema darf keine dauerhaften Angebotsanfrage-Nachweise enthalten.'); return []; }
  if (!Array.isArray(data.quoteCreateReceipts) || data.quoteCreateReceipts.length > 10_000) throw new Error('Ungültige oder zu viele Angebotsanfrage-Nachweise.');
  const rows = data.quoteCreateReceipts.map(readReceipt);
  if (new Set(rows.map(row => row.requestId)).size !== rows.length) throw new Error('Doppelte Angebotsanfrage-ID im Backup.');
  const linked = rows.filter(row => row.invoiceId !== null);
  if (new Set(linked.map(row => row.invoiceId)).size !== linked.length) throw new Error('Mehrere Angebotsanfragen verweisen auf dasselbe Dokument.');
  const invoices = Array.isArray(data.invoices) ? data.invoices as Record<string, unknown>[] : [];
  for (const row of linked) {
    const invoice = invoices.find(item => item.id === row.invoiceId);
    if (!invoice) throw new Error('Angebotsanfrage verweist auf ein fehlendes Angebot.');
    const identity = validateQuoteCreateIdentityFields(invoice, true);
    if (identity.quoteCreateRequestId !== row.requestId || identity.quoteCreateFingerprint !== row.fingerprint) throw new Error('Angebotsanfrage passt nicht zum unveränderten Quelldokument.');
  }
  for (const invoice of invoices) {
    const identity = validateQuoteCreateIdentityFields(invoice, true);
    if (identity.quoteCreateRequestId && !linked.some(row => row.invoiceId === invoice.id && row.requestId === identity.quoteCreateRequestId)) throw new Error('Dauerhafte Angebotsanfrage benötigt ihren eigenen verknüpften Nachweis.');
  }
  return rows;
}
