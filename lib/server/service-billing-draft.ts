import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import { isUnrenderedServiceBillingDraft, readServiceBillingDraftSeed, readServiceBillingItems, serviceBillingRecord, ServiceBillingError } from '@/lib/service-billing';

export function serviceBillingDraftToken(parsedData: unknown, customerId: number | null): string {
  const seed = readServiceBillingDraftSeed(parsedData);
  if (!seed) throw new ServiceBillingError('Ungültiger Serviceentwurf. Bitte die Rechnungsliste öffnen.', 409);
  return createHash('sha256').update(JSON.stringify({ seed, customerId })).digest('hex');
}
/** Re-read and compare inside the caller's transaction. Never authorize from UI state. */
export async function ownedServiceBillingDraft(tx: Prisma.TransactionClient, userId: string, invoiceId: number, token: unknown) {
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId }, include: { serviceBillingPeriod: { include: { plan: true } }, incomes: true, paymentJournalEvents: true, billingNotes: true, reminders: { select: { id: true } }, creditNotes: { select: { id: true } }, convertedInvoice: { select: { id: true } } } });
  if (!invoice) throw new ServiceBillingError('Entwurf nicht gefunden.', 404);
  const seed = readServiceBillingDraftSeed(invoice.parsedData); const receipt = invoice.serviceBillingPeriod;
  if (!isUnrenderedServiceBillingDraft(invoice) || !seed || !receipt || receipt.userId !== userId || receipt.plan.userId !== userId
    || receipt.plan.stableKey !== seed.planStableKey || receipt.periodIndex !== seed.periodIndex || receipt.periodStart !== seed.periodStart || receipt.periodEnd !== seed.periodEnd || receipt.action !== 'GENERATED'
    || invoice.paidAt || invoice.incomes.length || invoice.paymentJournalEvents.length || invoice.billingNotes.length) throw new ServiceBillingError('Dieser Entwurf wurde bereits weiterbearbeitet oder muss geprüft werden. Bitte die Rechnungsliste öffnen.', 409);
  if (typeof token !== 'string' || serviceBillingDraftToken(invoice.parsedData, invoice.customerId) !== token) throw new ServiceBillingError('Der Entwurf wurde zwischenzeitlich geändert. Bitte neu laden, bevor Sie speichern.', 409, 'STALE_SERVICE_DRAFT');
  if (!invoice.customerId || !await tx.customer.findFirst({ where: { id: invoice.customerId, userId }, select: { id: true } })) throw new ServiceBillingError('Kundenzuordnung muss geprüft werden.', 409);
  return { invoice, seed };
}
export function serviceBillingDraftEdit(input: unknown) {
  if (!serviceBillingRecord(input)) throw new ServiceBillingError('Ungültige Entwurfsdaten.');
  if (Object.hasOwn(input, 'billingNoteId') || Object.hasOwn(input, 'billingNoteIds')) throw new ServiceBillingError('Leistungsnotizen können in Serviceentwürfen nicht übernommen werden. Bitte dafür eine separate neue Rechnung verwenden.', 400, 'UNSUPPORTED_SERVICE_BILLING_NOTES');
  const { taxMode, customerAddress, notes, customerId } = input;
  if (!['small-business', 'standard'].includes(String(taxMode))) throw new ServiceBillingError('Bitte den Steuer-Modus klären.');
  if (typeof customerAddress !== 'string' || !customerAddress.trim() || customerAddress.length > 4000 || typeof notes !== 'string' || notes.length > 4000) throw new ServiceBillingError('Bitte Empfänger und Notiz prüfen (maximal 4000 Zeichen).');
  if (typeof customerId !== 'number' || !Number.isSafeInteger(customerId) || customerId <= 0) throw new ServiceBillingError('Bitte einen Kunden auswählen.');
  const mode = taxMode as 'small-business' | 'standard';
  const items = readServiceBillingItems(input.items, mode); const amounts = calculateInvoiceAmounts(items);
  return { customerId, customerAddress: customerAddress.trim(), notes, taxMode: mode, items, amounts };
}
