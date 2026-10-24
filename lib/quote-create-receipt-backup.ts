import type { Prisma } from '@prisma/client';
import { quoteCreateReceiptsFromBackup, validateQuoteCreateIdentityFields, type QuoteCreateReceiptBackup } from '@/lib/document-numbering-policy-backup';
export { quoteCreateReceiptsFromBackup };
export type { QuoteCreateReceiptBackup };
export type QuoteCreateReceiptRestoreState = QuoteCreateReceiptBackup;
/** Capture before overwrite deletion; only initially active identities may be relinked. */
export async function preflightQuoteCreateReceipts(tx: Prisma.TransactionClient, userId: string, rows: QuoteCreateReceiptBackup[]): Promise<QuoteCreateReceiptRestoreState[]> {
  const existing = await tx.quoteCreateReceipt.findMany({ where: { userId }, include: { invoice: true }, take: 10_001 });
  if (existing.length > 10_000) throw new Error('Zu viele Angebotsanfrage-Nachweise im Ziel.');
  const state = existing.map(row => ({ requestId: row.requestId, fingerprint: row.fingerprint, pdfSha256: row.pdfSha256, invoiceId: row.invoiceId, createdAt: row.createdAt.toISOString() }));
  // Validate portable fields without interpreting nullable links as source invoices.
  quoteCreateReceiptsFromBackup({ quoteCreateReceipts: state.map(row => ({ ...row, invoiceId: null })) }, true);
  for (const row of existing) if (row.invoice) {
    if (row.invoice.userId !== userId || row.invoiceUserId !== userId) throw new Error('Angebotsanfrage gehört nicht zum Zieldokument.');
    const identity = validateQuoteCreateIdentityFields(row.invoice as unknown as Record<string, unknown>, true);
    if (identity.quoteCreateRequestId !== row.requestId || identity.quoteCreateFingerprint !== row.fingerprint) throw new Error('Angebotsanfrage und Zieldokument weichen ab.');
  }
  for (const row of rows) {
    const previous = state.find(item => item.requestId === row.requestId);
    if (!previous) continue;
    if (previous.fingerprint !== row.fingerprint || previous.pdfSha256 !== row.pdfSha256 || previous.createdAt !== row.createdAt) throw new Error('Unveränderlicher Angebotsanfrage-Nachweis weicht im Ziel ab.');
    if (previous.invoiceId === null && row.invoiceId !== null) throw new Error('Ein gelöschtes Angebot darf durch Wiederherstellung keine verbrauchte Anfrage-ID reaktivieren.');
  }
  return state;
}
/** Never deletes receipts. Original target tombstones remain authoritative. */
export async function restoreQuoteCreateReceipts(tx: Prisma.TransactionClient, userId: string, rows: QuoteCreateReceiptBackup[], invoiceMap: ReadonlyMap<number, number>, previous: QuoteCreateReceiptRestoreState[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0, skipped = 0;
  for (const row of rows) {
    const initial = previous.find(item => item.requestId === row.requestId);
    const stored = await tx.quoteCreateReceipt.findUnique({ where: { userId_requestId: { userId, requestId: row.requestId } } });
    if (stored && (stored.fingerprint !== row.fingerprint || stored.pdfSha256 !== row.pdfSha256 || stored.createdAt.toISOString() !== row.createdAt)) throw new Error('Angebotsanfrage wurde zwischenzeitlich geändert.');
    if (row.invoiceId === null) {
      if (stored) { skipped++; continue; }
      await tx.quoteCreateReceipt.create({ data: { userId, requestId: row.requestId, fingerprint: row.fingerprint, pdfSha256: row.pdfSha256, createdAt: new Date(row.createdAt) } }); imported++; continue;
    }
    if (initial?.invoiceId === null || (stored?.invoiceId === null && !initial)) throw new Error('Verbrauchte Angebotsanfrage darf nicht reaktiviert werden.');
    const invoiceId = invoiceMap.get(row.invoiceId);
    if (!invoiceId) throw new Error('Wiederhergestelltes Angebot der Anfrage fehlt.');
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId, type: 'QUOTE' } });
    if (!invoice) throw new Error('Wiederhergestelltes Angebot gehört nicht zum Ziel.');
    const identity = validateQuoteCreateIdentityFields(invoice as unknown as Record<string, unknown>, true);
    if (identity.quoteCreateRequestId !== row.requestId || identity.quoteCreateFingerprint !== row.fingerprint) throw new Error('Wiederhergestellte Anfrage passt nicht zum Angebot.');
    if (stored) {
      if (stored.invoiceId === invoiceId) { skipped++; continue; }
      if (stored.invoiceId !== null) throw new Error('Angebotsanfrage ist bereits mit einem anderen Dokument verbunden.');
      await tx.quoteCreateReceipt.update({ where: { userId_requestId: { userId, requestId: row.requestId } }, data: { invoiceUserId: userId, invoiceId } }); imported++;
    } else { await tx.quoteCreateReceipt.create({ data: { userId, requestId: row.requestId, fingerprint: row.fingerprint, pdfSha256: row.pdfSha256, invoiceUserId: userId, invoiceId, createdAt: new Date(row.createdAt) } }); imported++; }
  }
  return { imported, skipped };
}
