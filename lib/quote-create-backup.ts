import type { Prisma } from '@prisma/client';
import { customerBusinessIdentity } from '@/lib/customer-field-contract';
import { validateQuoteCreateIdentityFields } from '@/lib/document-numbering-policy-backup';
import { quoteCreateReceiptsFromBackup, type QuoteCreateReceiptBackup, type QuoteCreateReceiptRestoreState } from '@/lib/quote-create-receipt-backup';

type RecordValue = Record<string, unknown>;
/** Durable request receipts belong to the numbering capability, not legacy JSON markers. */
export function validateQuoteCreateBackup(data: RecordValue, supported: boolean): void {
  const ids = new Set<string>();
  quoteCreateReceiptsFromBackup(data, supported);
  if (!Array.isArray(data.invoices)) return;
  for (const value of data.invoices) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger Beleg der Angebotsanfrage.');
    const identity = validateQuoteCreateIdentityFields(value as RecordValue, supported);
    if (identity.quoteCreateRequestId) {
      if (ids.has(identity.quoteCreateRequestId)) throw new Error('Doppelte dauerhafte Angebotsanfrage-ID im Backup.');
      ids.add(identity.quoteCreateRequestId);
    }
  }
}

export type PreservedQuoteOriginal = { sourceInvoiceId: number; targetInvoiceId: number; requestId: string; storedFileName: string; pdfSha256: string };

/** Repeat before file staging and inside the write transaction, before overwrite deletion. */
export async function validateQuoteCreateRestoreTargets(client: Pick<Prisma.TransactionClient, 'invoice' | 'customer'>, userId: string, invoices: RecordValue[], customers: RecordValue[], previous: QuoteCreateReceiptRestoreState[], receipts: QuoteCreateReceiptBackup[]): Promise<PreservedQuoteOriginal[]> {
  const source = new Map<string, RecordValue>();
  for (const invoice of invoices) {
    const identity = validateQuoteCreateIdentityFields(invoice, true);
    if (identity.quoteCreateRequestId) source.set(identity.quoteCreateRequestId, invoice);
  }
  if (!source.size) return [];
  const originals: PreservedQuoteOriginal[] = [];
  const targets = await client.invoice.findMany({ where: { userId, quoteCreateRequestId: { not: null } }, select: {
    id: true, type: true, quoteCreateRequestId: true, quoteCreateFingerprint: true, invoiceNumber: true,
    fileName: true, storedFileName: true, invoiceDate: true, validUntil: true, totalAmount: true, parsedData: true, customerId: true,
  }, take: 10_001 });
  if (targets.length > 10_000) throw new Error('Angebotsanfrage-Historie im Ziel ist für diese Wiederherstellung zu groß.');
  for (const target of targets) {
    const targetIdentity = validateQuoteCreateIdentityFields(target, true);
    const incoming = source.get(targetIdentity.quoteCreateRequestId!);
    if (!incoming) continue;
    const incomingIdentity = validateQuoteCreateIdentityFields(incoming, true);
    if (incomingIdentity.quoteCreateFingerprint !== targetIdentity.quoteCreateFingerprint || incoming.invoiceNumber !== target.invoiceNumber) throw new Error('Dauerhafte Angebotsanfrage-ID verweist im Ziel auf ein anderes Angebot oder andere Quelldaten.');
    const receipt = receipts.find(row => row.requestId === targetIdentity.quoteCreateRequestId);
    const initial = previous.find(row => row.requestId === targetIdentity.quoteCreateRequestId);
    if (!receipt || !initial || initial.invoiceId !== target.id || receipt.fingerprint !== initial.fingerprint || receipt.pdfSha256 !== initial.pdfSha256) throw new Error('Angebotsanfrage und ursprünglicher Dateinachweis im Ziel stimmen nicht überein.');
    originals.push({ sourceInvoiceId: Number(incoming.id), targetInvoiceId: target.id, requestId: receipt.requestId, storedFileName: target.storedFileName, pdfSha256: receipt.pdfSha256 });
    const sourceCustomer = incoming.customerId == null ? null : customers.find(row => row.id === incoming.customerId);
    const targetCustomer = target.customerId === null ? null : await client.customer.findFirst({ where: { userId, id: target.customerId }, select: { name: true, email: true, address: true, zipCode: true, city: true } });
    if ((incoming.customerId != null && !sourceCustomer) || (target.customerId !== null && !targetCustomer) || (sourceCustomer === null) !== (targetCustomer === null) || (sourceCustomer && targetCustomer && customerBusinessIdentity(sourceCustomer) !== customerBusinessIdentity(targetCustomer))) throw new Error('Dauerhafte Angebotsanfrage-ID verweist auf eine andere oder fehlende Kundenidentität.');
  }
  return originals.sort((a, b) => a.sourceInvoiceId - b.sourceInvoiceId);
}

/** A complete archive must carry the original bytes named by each linked receipt. */
export function validateQuoteOriginalManifest(data: RecordValue, files: Array<{ kind: string; sourceName: string; sha256: string }>, required: boolean): void {
  if (!Array.isArray(data.quoteCreateReceipts) || !Array.isArray(data.invoices)) return;
  for (const value of data.quoteCreateReceipts) {
    const receipt = value as QuoteCreateReceiptBackup;
    if (receipt.invoiceId === null) continue;
    const invoice = (data.invoices as RecordValue[]).find(row => row.id === receipt.invoiceId);
    const file = files.find(row => row.kind === 'invoice' && row.sourceName === invoice?.storedFileName);
    if (!file && required) throw new Error('Vollständiges Backup enthält kein Original-PDF einer dauerhaften Angebotsanfrage.');
    if (file && file.sha256 !== receipt.pdfSha256) throw new Error('Dateimanifest widerspricht dem unveränderlichen Originalhash einer Angebotsanfrage.');
  }
}
