import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { getEInvoiceBookingRejection } from '@/lib/e-invoice-parser';
import { formatMoneyEUR } from '@/lib/money';
import { exactPaymentCents, paymentDate, paymentSummary, paymentText, PaymentJournalError, type FullPaymentInput } from './contract';

async function ownedInvoice(tx: Prisma.TransactionClient, userId: string, invoiceId: number) {
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new PaymentJournalError('Ungültige Rechnungs-ID');
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId }, include: { income: { include: { cashTransaction: true } }, paymentJournalEvent: true } });
  if (!invoice) throw new PaymentJournalError('Rechnung nicht gefunden', 404, 'INVOICE_NOT_FOUND');
  if (invoice.customerId !== null && !await tx.customer.findFirst({ where: { id: invoice.customerId, userId }, select: { id: true } })) {
    throw new PaymentJournalError('Die Kundenzuordnung der Rechnung muss vor der Zahlung geprüft werden.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }
  return invoice;
}

async function assertBookable(invoice: Awaited<ReturnType<typeof ownedInvoice>>) {
  if (invoice.type !== 'INVOICE') throw new PaymentJournalError('Nur Rechnungen unterstützen diese Zahlung.', 409, 'UNSUPPORTED_DOCUMENT');
  const parsed = invoice.parsedData;
  const currency = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.currency : null;
  if (currency != null && currency !== 'EUR') throw new PaymentJournalError('Rechnungswährung wird nicht unterstützt; nur EUR ist buchbar.', 409, 'UNSUPPORTED_CURRENCY');
  const rejection = await getEInvoiceBookingRejection(parsed);
  if (rejection) throw new PaymentJournalError(`Die Zahlung kann nicht gebucht werden: ${rejection}`, 409, 'PAYMENT_REVIEW_REQUIRED');
  return exactPaymentCents(invoice.totalAmount);
}

async function auditPayment(tx: Prisma.TransactionClient, userId: string, invoiceId: number, invoiceNumber: string | null, values: Record<string, unknown>, legacy: boolean) {
  await createFinancialAuditLog({ userId, action: legacy ? 'IMPORT' : 'PAYMENT_RECEIVED', entityType: 'Invoice', entityId: invoiceId,
    entityName: invoiceNumber ?? undefined, newValues: values,
    metadata: { actorId: userId, tenantId: userId, operation: legacy ? 'invoice.payment-legacy-import' : 'invoice.payment',
      originalReference: invoiceNumber ?? `invoice:${invoiceId}`, reason: legacy ? 'explicit legacy payment adoption; historical certainty retained' : 'actual full payment recorded' },
  }, tx);
}

/** Transaction-aware adapter used by the legacy status endpoint; no nested transaction. */
export async function recordFullPaymentInTransaction(tx: Prisma.TransactionClient, userId: string, invoiceId: number, input: FullPaymentInput) {
  const invoice = await ownedInvoice(tx, userId, invoiceId);
  if (input.currency !== 'EUR') throw new PaymentJournalError('Nur EUR-Zahlungen werden unterstützt.', 400, 'UNSUPPORTED_CURRENCY');
  if (!['MANUAL', 'LEGACY_STATUS'].includes(input.source)) throw new PaymentJournalError('Nicht unterstützte Zahlungsquelle.');
  const amountCents = exactPaymentCents(input.amount).toString();
  const paidAt = paymentDate(input.paidAt, input.source === 'LEGACY_STATUS');
  const reference = paymentText(input.reference, 'Zahlungsbezug', 255);
  const idempotencyKey = paymentText(input.idempotencyKey, 'Idempotenzschlüssel', 128);
  const priorKey = await tx.paymentJournalEvent.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
  if (priorKey) {
    if (priorKey.invoiceId !== invoiceId || priorKey.amountCents !== amountCents || priorKey.currency !== input.currency
      || priorKey.paidAt?.getTime() !== paidAt.getTime() || priorKey.reference !== reference || priorKey.source !== input.source) {
      throw new PaymentJournalError('Idempotenzschlüssel gehört zu einer anderen Zahlung. Bitte Eingabe prüfen.', 409, 'IDEMPOTENCY_CONFLICT');
    }
    return { event: priorKey, summary: paymentSummary(invoice.totalAmount!, priorKey), replayed: true };
  }
  if (invoice.paymentJournalEvent || invoice.status === 'PAID' || invoice.income || invoice.paidAt) {
    throw new PaymentJournalError('Es besteht bereits ein Zahlungsnachweis. Legacy-Zahlungen ausdrücklich übernehmen; keine zweite Einnahme buchen.', 409, 'PAYMENT_ALREADY_EXISTS');
  }
  if (!['DRAFT', 'SENT'].includes(invoice.status)) throw new PaymentJournalError('Diese Rechnung kann nicht bezahlt werden.', 409, 'UNSUPPORTED_DOCUMENT');
  const totalCents = await assertBookable(invoice);
  if (BigInt(amountCents) !== totalCents) throw new PaymentJournalError('Dieser Schritt unterstützt nur die erste vollständige Zahlung in Höhe des offenen Rechnungsbetrags; Teil-/Überzahlungen sind noch nicht unterstützt.', 400, 'FULL_PAYMENT_REQUIRED');
  const income = await tx.income.create({ data: { userId, invoiceId, amount: Number(formatMoneyEUR(totalCents)), date: paidAt,
    customerId: invoice.customerId, description: `Rechnung ${invoice.invoiceNumber ?? invoiceId}`, taxRelevant: true } });
  const event = await tx.paymentJournalEvent.create({ data: { userId, invoiceId, incomeId: income.id, amountCents, currency: 'EUR', paidAt,
    dateCertainty: 'ACTUAL', source: input.source, reference, idempotencyKey } });
  const summary = paymentSummary(invoice.totalAmount!, event);
  await tx.invoice.update({ where: { id: invoiceId, userId }, data: { status: summary.paid ? 'PAID' : invoice.status, paidAt, issuanceState: 'ISSUED' } });
  await auditPayment(tx, userId, invoiceId, invoice.invoiceNumber, { paymentJournalEventId: event.id, amountCents, paidAt, source: event.source, reference, incomeId: income.id }, false);
  return { event, summary, replayed: false };
}

export async function recordFullPayment(userId: string, invoiceId: number, input: FullPaymentInput) {
  return inTransaction(tx => recordFullPaymentInTransaction(tx, userId, invoiceId, input));
}

/** Explicit, once-only adoption. No date or Income is manufactured for legacy PAID. */
export async function adoptLegacyPaidInvoice(userId: string, invoiceId: number) {
  return inTransaction(async tx => {
    const invoice = await ownedInvoice(tx, userId, invoiceId);
    if (invoice.paymentJournalEvent) return { event: invoice.paymentJournalEvent, summary: paymentSummary(invoice.totalAmount!, invoice.paymentJournalEvent), replayed: true };
    if (invoice.status !== 'PAID') throw new PaymentJournalError('Nur bestehende Legacy-PAID-Rechnungen können übernommen werden.', 409, 'LEGACY_PAID_REQUIRED');
    const cents = await assertBookable(invoice);
    if (invoice.income && (invoice.income.userId !== userId || exactPaymentCents(invoice.income.amount) !== cents)) {
      throw new PaymentJournalError('Legacy-Einnahme und Rechnung weichen ab; bitte vor Übernahme prüfen.', 409, 'PAYMENT_REVIEW_REQUIRED');
    }
    if (invoice.income && invoice.paidAt && invoice.income.date.getTime() !== invoice.paidAt.getTime()) {
      throw new PaymentJournalError('Historische Zahlungsdaten widersprechen sich; bitte vor Übernahme prüfen.', 409, 'PAYMENT_REVIEW_REQUIRED');
    }
    const paidAt = invoice.income?.date ?? invoice.paidAt;
    const dateCertainty = invoice.income ? 'LEGACY_INCOME' : invoice.paidAt ? 'LEGACY_INVOICE' : 'UNKNOWN';
    const event = await tx.paymentJournalEvent.create({ data: { userId, invoiceId, incomeId: invoice.income?.id ?? null,
      amountCents: cents.toString(), currency: 'EUR', paidAt, dateCertainty, source: 'LEGACY_IMPORT',
      reference: invoice.invoiceNumber ?? `invoice:${invoiceId}`, idempotencyKey: `legacy-import:invoice:${invoiceId}` } });
    await auditPayment(tx, userId, invoiceId, invoice.invoiceNumber, { paymentJournalEventId: event.id, amountCents: event.amountCents, paidAt, dateCertainty, incomeId: event.incomeId }, true);
    return { event, summary: paymentSummary(invoice.totalAmount!, event), replayed: false };
  });
}

/** Tenant-scoped read. Legacy PAID without an event is explicit, never guessed as a journal payment. */
export async function readInvoicePaymentJournal(userId: string, invoiceId: number) {
  const invoice = await ownedInvoice(prisma, userId, invoiceId);
  // Preflight uses exactly the document/currency/money policy of the writer.
  await assertBookable(invoice);
  const legacyAdoptionRequired = invoice.status === 'PAID' && !invoice.paymentJournalEvent;
  return { currency: 'EUR' as const, event: invoice.paymentJournalEvent,
    summary: legacyAdoptionRequired ? null : paymentSummary(invoice.totalAmount!, invoice.paymentJournalEvent),
    legacyAdoptionRequired,
    canRecordPayment: !invoice.paymentJournalEvent && !invoice.income && !invoice.paidAt && ['DRAFT', 'SENT'].includes(invoice.status),
  };
}
