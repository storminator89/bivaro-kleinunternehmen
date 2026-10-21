import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction, isRetryableDatabaseError } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { getEInvoiceBookingRejection } from '@/lib/e-invoice-parser';
import { formatMoneyEUR } from '@/lib/money';
import { exactPaymentCents, paymentDate, paymentSummary, paymentText, PaymentJournalError, type FullPaymentInput } from './contract';

async function ownedInvoice(tx: Prisma.TransactionClient, userId: string, invoiceId: number) {
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new PaymentJournalError('Ungültige Rechnungs-ID');
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId }, include: {
    incomes: { include: { cashTransaction: true } }, paymentJournalEvents: { orderBy: { id: 'asc' } },
  } });
  if (!invoice) throw new PaymentJournalError('Rechnung nicht gefunden', 404, 'INVOICE_NOT_FOUND');
  if (invoice.customerId !== null && !await tx.customer.findFirst({ where: { id: invoice.customerId, userId }, select: { id: true } })) {
    throw new PaymentJournalError('Die Kundenzuordnung der Rechnung muss vor der Zahlung geprüft werden.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }
  return invoice;
}

export type LedgerInvoice = Awaited<ReturnType<typeof ownedInvoice>>;
const review = () => new PaymentJournalError('Zahlungsnachweise und Rechnungsprojektion müssen vor einer weiteren Zahlung geprüft werden.', 409, 'PAYMENT_REVIEW_REQUIRED');

/** Validate every linked projection; an unexplained Income must never be counted or hidden. */
export function ledgerSummary(invoice: LedgerInvoice) {
  const events = invoice.paymentJournalEvents;
  const summary = paymentSummary(invoice.totalAmount!, events);
  const incomes = new Map(invoice.incomes.map(income => [income.id, income]));
  const linked = new Set<number>();
  for (const event of events) {
    if (event.userId !== invoice.userId || event.invoiceId !== invoice.id || event.currency !== 'EUR') throw review();
    const actual = event.dateCertainty === 'ACTUAL';
    if (actual && (!['MANUAL', 'LEGACY_STATUS'].includes(event.source) || !event.paidAt || event.incomeId === null)) throw review();
    if (!actual && (events.length !== 1 || event.amountCents !== summary.totalCents)) throw review();
    if (!actual && (event.source !== 'LEGACY_IMPORT' || !['LEGACY_INCOME', 'LEGACY_INVOICE', 'UNKNOWN'].includes(event.dateCertainty))) throw review();
    if (event.dateCertainty === 'UNKNOWN' && (event.paidAt !== null || event.incomeId !== null || invoice.paidAt !== null)) throw review();
    if (event.dateCertainty === 'LEGACY_INVOICE' && (!event.paidAt || event.incomeId !== null || invoice.paidAt?.getTime() !== event.paidAt.getTime())) throw review();
    if (event.dateCertainty === 'LEGACY_INCOME' && (!event.paidAt || event.incomeId === null || (invoice.paidAt !== null && invoice.paidAt.getTime() !== event.paidAt.getTime()))) throw review();
    if (event.incomeId !== null) {
      const income = incomes.get(event.incomeId);
      let incomeCents: string | null = null;
      try { if (income) incomeCents = exactPaymentCents(income.amount).toString(); } catch { throw review(); }
      if (!income || linked.has(income.id) || income.userId !== invoice.userId || income.invoiceId !== invoice.id
        || income.customerId !== invoice.customerId || incomeCents !== event.amountCents
        || !event.paidAt || income.date.getTime() !== event.paidAt.getTime()) throw review();
      linked.add(income.id);
    }
  }
  if (events.length > 0) {
    if (linked.size !== incomes.size || (events.some(event => event.dateCertainty === 'ACTUAL') && invoice.issuanceState !== 'ISSUED')) throw review();
    if (invoice.status !== 'CANCELLED' && invoice.status !== (summary.paid ? 'PAID' : 'SENT')) throw review();
    if (!summary.paid && invoice.paidAt !== null) throw review();
    // Adopted evidence retains all historical date/null values. Actual ledgers
    // project only the latest real allocation date at full settlement.
    if (events.every(event => event.dateCertainty === 'ACTUAL')) {
      const latest = Math.max(...events.map(event => event.paidAt!.getTime()));
      if (summary.paid && invoice.paidAt?.getTime() !== latest) throw review();
    }
  } else if (invoice.status === 'PAID' || invoice.incomes.length > 0 || invoice.paidAt) {
    throw review();
  }
  return summary;
}

async function assertBookable(invoice: LedgerInvoice) {
  if (invoice.type !== 'INVOICE') throw new PaymentJournalError('Nur Rechnungen unterstützen diese Zahlung.', 409, 'UNSUPPORTED_DOCUMENT');
  const parsed = invoice.parsedData;
  const currency = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.currency : null;
  if (currency != null && currency !== 'EUR') throw new PaymentJournalError('Rechnungswährung wird nicht unterstützt; nur EUR ist buchbar.', 409, 'UNSUPPORTED_CURRENCY');
  const rejection = await getEInvoiceBookingRejection(parsed);
  if (rejection) throw new PaymentJournalError(`Die Zahlung kann nicht gebucht werden: ${rejection}`, 409, 'PAYMENT_REVIEW_REQUIRED');
  try { return exactPaymentCents(invoice.totalAmount); } catch { throw review(); }
}

async function auditPayment(tx: Prisma.TransactionClient, userId: string, invoiceId: number, invoiceNumber: string | null, values: Record<string, unknown>, legacy: boolean) {
  await createFinancialAuditLog({ userId, action: legacy ? 'IMPORT' : 'PAYMENT_RECEIVED', entityType: 'Invoice', entityId: invoiceId,
    entityName: invoiceNumber ?? undefined, newValues: values,
    metadata: { actorId: userId, tenantId: userId, operation: legacy ? 'invoice.payment-legacy-import' : 'invoice.payment',
      originalReference: invoiceNumber ?? `invoice:${invoiceId}`, reason: legacy ? 'explicit legacy payment adoption; historical certainty retained' : 'actual payment allocation recorded' },
  }, tx);
}

/** Transaction-aware legacy adapter. Name retained for old first-full clients. */
export async function recordFullPaymentInTransaction(tx: Prisma.TransactionClient, userId: string, invoiceId: number, input: FullPaymentInput) {
  const invoice = await ownedInvoice(tx, userId, invoiceId);
  await assertBookable(invoice);
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
    return { event: priorKey, summary: ledgerSummary(invoice), replayed: true };
  }
  const summary = ledgerSummary(invoice);
  if (!['DRAFT', 'SENT', 'PAID'].includes(invoice.status)) throw new PaymentJournalError('Diese Rechnung kann nicht bezahlt werden.', 409, 'UNSUPPORTED_DOCUMENT');
  if (input.source === 'LEGACY_STATUS' && invoice.paymentJournalEvents.length > 0) {
    throw new PaymentJournalError('Bitte den verbleibenden Betrag mit Datum und Bezug im Zahlungsdialog erfassen.', 409, 'PAYMENT_DETAILS_REQUIRED', summary);
  }
  if (input.expectedPaidCents === undefined) {
    if (invoice.paymentJournalEvents.length > 0 || amountCents !== summary.totalCents) {
      throw new PaymentJournalError('Bitte den aktuellen Zahlungsstand im Zahlungsdialog bestätigen.', 409, 'PAYMENT_DETAILS_REQUIRED', summary);
    }
  } else {
    if (typeof input.expectedPaidCents !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(input.expectedPaidCents) || input.expectedPaidCents.length > 16) {
      throw new PaymentJournalError('Ungültiger Zahlungsstand.');
    }
    if (input.expectedPaidCents !== summary.paidCents) {
      throw new PaymentJournalError('Der Zahlungsstand wurde zwischenzeitlich geändert. Bitte Restbetrag prüfen und bewusst erneut bestätigen.', 409, 'PAYMENT_STATE_CHANGED', summary);
    }
  }
  if (BigInt(amountCents) > BigInt(summary.openCents)) {
    throw new PaymentJournalError('Der Zahlungsbetrag übersteigt den offenen Restbetrag.', 409, 'PAYMENT_EXCEEDS_OPEN', summary);
  }
  const income = await tx.income.create({ data: { userId, invoiceId, amount: Number(formatMoneyEUR(BigInt(amountCents))), date: paidAt,
    customerId: invoice.customerId, description: `Rechnung ${invoice.invoiceNumber ?? invoiceId}`, taxRelevant: true } });
  const event = await tx.paymentJournalEvent.create({ data: { userId, invoiceId, incomeId: income.id, amountCents, currency: 'EUR', paidAt,
    dateCertainty: 'ACTUAL', source: input.source, reference, idempotencyKey } });
  const allocations = [...invoice.paymentJournalEvents, event];
  const nextSummary = paymentSummary(invoice.totalAmount!, allocations);
  const latestDate = new Date(Math.max(...allocations.map(allocation => allocation.paidAt!.getTime())));
  await tx.invoice.update({ where: { id: invoiceId, userId }, data: {
    status: nextSummary.paid ? 'PAID' : 'SENT', paidAt: nextSummary.paid ? latestDate : null, issuanceState: 'ISSUED',
  } });
  await auditPayment(tx, userId, invoiceId, invoice.invoiceNumber, { paymentJournalEventId: event.id, amountCents, paidAt, source: event.source, reference, incomeId: income.id }, false);
  return { event, summary: nextSummary, replayed: false };
}

export async function recordFullPayment(userId: string, invoiceId: number, input: FullPaymentInput) {
  // A unique-key race aborts the entire transaction. Re-read in a fresh
  // transaction, then verify semantic identity rather than returning raw P2002.
  for (let uniqueRetry = 0; ; uniqueRetry++) {
    try {
      return await inTransaction(tx => recordFullPaymentInTransaction(tx, userId, invoiceId, input));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && uniqueRetry === 0) continue;
      if (isRetryableDatabaseError(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw new PaymentJournalError('Zahlung konnte wegen gleichzeitiger Buchung nicht bestätigt werden. Mit demselben Schlüssel erneut versuchen.', 503, 'PAYMENT_RETRY_REQUIRED');
      throw error;
    }
  }
}

/** Explicit, once-only full historical evidence; no new date or Income. */
export async function adoptLegacyPaidInvoice(userId: string, invoiceId: number) {
  return inTransaction(async tx => {
    const invoice = await ownedInvoice(tx, userId, invoiceId);
    const cents = await assertBookable(invoice);
    if (invoice.paymentJournalEvents.length > 0) {
      if (invoice.paymentJournalEvents.length !== 1 || invoice.paymentJournalEvents[0].source !== 'LEGACY_IMPORT') throw review();
      return { event: invoice.paymentJournalEvents[0], summary: ledgerSummary(invoice), replayed: true };
    }
    if (invoice.status !== 'PAID') throw new PaymentJournalError('Nur bestehende Legacy-PAID-Rechnungen können übernommen werden.', 409, 'LEGACY_PAID_REQUIRED');
    if (invoice.incomes.length > 1) throw review();
    const income = invoice.incomes[0];
    if (income && (income.userId !== userId || income.customerId !== invoice.customerId || exactPaymentCents(income.amount) !== cents)) throw review();
    if (income && invoice.paidAt && income.date.getTime() !== invoice.paidAt.getTime()) throw review();
    const paidAt = income?.date ?? invoice.paidAt;
    const dateCertainty = income ? 'LEGACY_INCOME' : invoice.paidAt ? 'LEGACY_INVOICE' : 'UNKNOWN';
    const event = await tx.paymentJournalEvent.create({ data: { userId, invoiceId, incomeId: income?.id ?? null,
      amountCents: cents.toString(), currency: 'EUR', paidAt, dateCertainty, source: 'LEGACY_IMPORT',
      reference: invoice.invoiceNumber?.trim() || `invoice:${invoiceId}`, idempotencyKey: `legacy-import:invoice:${invoiceId}` } });
    await auditPayment(tx, userId, invoiceId, invoice.invoiceNumber, { paymentJournalEventId: event.id, amountCents: event.amountCents, paidAt, dateCertainty, incomeId: event.incomeId }, true);
    return { event, summary: paymentSummary(invoice.totalAmount!, [event]), replayed: false };
  });
}

/** Legacy unknown balances are explicit, never guessed as unpaid. */
export async function readInvoicePaymentJournal(userId: string, invoiceId: number) {
  const invoice = await ownedInvoice(prisma, userId, invoiceId);
  await assertBookable(invoice);
  const legacyAdoptionRequired = invoice.status === 'PAID' && invoice.paymentJournalEvents.length === 0;
  let summary = null;
  let reviewRequired = false;
  try { summary = ledgerSummary(invoice); }
  catch (error) {
    if (!(error instanceof PaymentJournalError) || error.code !== 'PAYMENT_REVIEW_REQUIRED') throw error;
    reviewRequired = true;
  }
  return { currency: 'EUR' as const, events: invoice.paymentJournalEvents,
    event: invoice.paymentJournalEvents.length === 1 ? invoice.paymentJournalEvents[0] : null,
    summary, legacyAdoptionRequired, reviewRequired,
    canRecordPayment: !reviewRequired && !!summary && !summary.paid && ['DRAFT', 'SENT'].includes(invoice.status),
  };
}
