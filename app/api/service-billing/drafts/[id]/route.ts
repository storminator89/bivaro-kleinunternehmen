import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { isUnrenderedServiceBillingDraft, readServiceBillingDraftSeed, serviceBillingRecord, ServiceBillingError } from '@/lib/service-billing';
import { ownedServiceBillingDraft, serviceBillingDraftEdit, serviceBillingDraftToken } from '@/lib/server/service-billing-draft';
import { protectMutation } from '@/lib/request-security';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';

function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ServiceBillingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültiges JSON.' }, { status: 400 });
  console.error('Service draft request failed:', error);
  return NextResponse.json({ error: 'Der Entwurf konnte nicht verarbeitet werden.' }, { status: 500 });
}
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(); const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new ServiceBillingError('Ungültige Entwurfs-ID.');
    const invoice = await prisma.invoice.findFirst({ where: { id: Number(id), userId }, include: { serviceBillingPeriod: { include: { plan: true } }, incomes: true, paymentJournalEvents: true, billingNotes: { select: { id: true } }, reminders: { select: { id: true } }, creditNotes: { select: { id: true } }, convertedInvoice: { select: { id: true } } } });
    if (!invoice) throw new ServiceBillingError('Entwurf nicht gefunden.', 404);
    const seed = readServiceBillingDraftSeed(invoice.parsedData); const receipt = invoice.serviceBillingPeriod;
    if (!seed || !isUnrenderedServiceBillingDraft(invoice) || !receipt || receipt.userId !== userId || receipt.plan.userId !== userId || receipt.plan.stableKey !== seed.planStableKey
      || receipt.periodIndex !== seed.periodIndex || receipt.periodStart !== seed.periodStart || receipt.periodEnd !== seed.periodEnd || receipt.action !== 'GENERATED' || invoice.incomes.length || invoice.paymentJournalEvents.length) throw new ServiceBillingError('Dieser Entwurf wurde bereits weiterbearbeitet oder muss geprüft werden. Bitte die Rechnungsliste öffnen.', 409);
    return NextResponse.json({ id: invoice.id, customerId: invoice.customerId, parsedData: seed, draftToken: serviceBillingDraftToken(invoice.parsedData, invoice.customerId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
export const PATCH = protectMutation(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const userId = await requireUserId(); const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new ServiceBillingError('Ungültige Entwurfs-ID.');
    const input: unknown = await request.json(); const edit = serviceBillingDraftEdit(input);
    const saved = await inTransaction(async tx => {
      const { invoice, seed } = await ownedServiceBillingDraft(tx, userId, Number(id), serviceBillingRecord(input) ? input.draftToken : null);
      if (!await tx.customer.findFirst({ where: { id: edit.customerId, userId }, select: { id: true } })) throw new ServiceBillingError('Kunde nicht gefunden.', 404);
      const marker = { ...seed, items: edit.items, taxMode: edit.taxMode, customerAddress: edit.customerAddress, notes: edit.notes };
      const parsedData = { _serviceBillingDraft: marker, currency: 'EUR', documentType: 'INVOICE', netAmount: edit.amounts.netAmount, taxAmount: edit.amounts.taxAmount,
        grossAmount: edit.amounts.grossAmount, totalAmount: edit.amounts.grossAmount, lineItems: edit.items.map((item, index) => ({ ...item, positionNumber: String(index + 1), amount: edit.amounts.lines[index].netAmount })) } as unknown as Prisma.InputJsonValue;
      const changed = await tx.invoice.updateMany({ where: { id: invoice.id, userId, status: 'DRAFT', issuanceState: 'UNISSUED', storedFileName: '', customerId: invoice.customerId, parsedData: { equals: invoice.parsedData as Prisma.InputJsonValue } }, data: { parsedData, customerId: edit.customerId, totalAmount: edit.amounts.grossAmount } });
      if (changed.count !== 1) throw new ServiceBillingError('Der Entwurf wurde geändert. Bitte neu laden.', 409);
      await createFinancialAuditLog({ userId, action: 'UPDATE', entityType: 'Invoice', entityId: invoice.id,
        newValues: { status: 'DRAFT', issuanceState: 'UNISSUED', invoiceNumber: null }, metadata: { actorId: userId, tenantId: userId, operation: 'service-plan.edit-draft', originalReference: `${seed.planStableKey}:${seed.periodIndex}`, reason: 'explicit draft edit; no file, number, issuance, email or payment' } }, tx);
      return { draftToken: serviceBillingDraftToken(parsedData, edit.customerId), id: invoice.id };
    });
    return NextResponse.json(saved);
  } catch (error) { return failure(error); }
}, { maxBodyBytes: 160 * 1024 });
