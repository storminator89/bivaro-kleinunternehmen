import { getLedgerDateFilter } from '@/lib/business-date';
import { compareInvoiceListRows, type InvoiceListSort } from '@/lib/invoice-list-sort';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loadInvoicePaymentStates, type InvoicePaymentState } from '@/lib/payment-journal/allocation-ledger';
import { reducePaymentLedger } from '@/lib/payment-journal/adjustment-contract';
import { isUnrenderedServiceBillingDraft } from '@/lib/service-billing';
import { getEInvoiceBookingRejection, getRawEInvoiceXml } from '@/lib/e-invoice-parser';
import { PaymentJournalError } from '@/lib/payment-journal/contract';
import { ownedRecordMatch } from '@/lib/record-search/match';
import { filteredListQuery } from '@/lib/record-search/list-contract';

export type InvoiceListReadOptions = {
  page: number; pageSize: number; search?: string; paidStatus?: string | null;
  dateRange?: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;
  documentId?: number;
  sort?: InvoiceListSort;
  /** Body-only palette match; never a URL search parameter. */
  recordQuery?: string;
};
function isPdfFile(fileName: string): boolean { return fileName.toLowerCase().endsWith('.pdf'); }

/** Shared, read-only projection: every caller retains the complete existing ledger checks. */
export async function readInvoiceList(userId: string, headers: Headers, options: InvoiceListReadOptions): Promise<Response> {
  const { page, pageSize } = options;
  const skip = (page - 1) * pageSize;

  // Filters
  const { search = '', paidStatus, dateRange, documentId, recordQuery } = options;

  const where: Prisma.InvoiceWhereInput = { userId, type: recordQuery !== undefined ? { in: ['INVOICE', 'CREDIT_NOTE'] } : { not: 'QUOTE' } };
  if (documentId !== undefined) where.id = documentId;
  let dateMatch = Prisma.empty;

  // Financial filters are applied to the validated complete ledger below,
  // before pagination and count. A partial allocation is never fully paid.

  const dateFilter = getLedgerDateFilter(dateRange ?? null);
  if (dateFilter) {
    const { gte: start, lt: endExclusive } = dateFilter;
    dateMatch = Prisma.sql`AND (("invoiceDate" >= ${start} AND "invoiceDate" < ${endExclusive}) OR ("invoiceDate" IS NULL AND "uploadedAt" >= ${start} AND "uploadedAt" < ${endExclusive}))`;
    where.OR = [
      { invoiceDate: dateFilter },
      { AND: [{ invoiceDate: null }, { uploadedAt: dateFilter }] },
    ];
  }

  if (search) {
    const existingAnd = Array.isArray(where.AND) ? where.AND : (where.AND ? [where.AND] : []);
    where.AND = [
      ...existingAnd,
      {
        OR: [
          { fileName: { contains: search } },
          { invoiceNumber: { contains: search } },
        ],
      },
    ];
  }

  const { items, states } = await prisma.$transaction(async tx => {
    let sourceWhere = where;
    if (recordQuery !== undefined) {
      // Candidate IDs are internal, tenant-scoped and bounded by the same
      // 10k source guard as GET, never accepted from a client or loaded unbounded.
      const candidates = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT "id" FROM "Invoice" WHERE ${ownedRecordMatch('outbound', userId, filteredListQuery(recordQuery))}
          ${dateMatch} ORDER BY "uploadedAt" DESC, "id" DESC LIMIT 10001
      `);
      if (candidates.length > 10_000) throw new PaymentJournalError('Zu viele Rechnungen. Bitte die Auswahl eingrenzen.', 413, 'SOURCE_LIMIT');
      sourceWhere = { AND: [where, { id: { in: candidates.map(row => row.id) } }] };
    }
    const items = await tx.invoice.findMany({
      where: sourceWhere,
      take: 10_001,
      orderBy: recordQuery === undefined ? { uploadedAt: 'desc' } : [{ uploadedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        fileName: true,
        storedFileName: true,
        uploadedAt: true,
        invoiceDate: true,
        dueDate: true,
        invoiceNumber: true,
        parsedData: true,
        totalAmount: true,
        status: true,
        issuanceState: true,
        paidAt: true,
        validUntil: true,
        quoteFollowUpOn: true,
        quoteResponseNote: true,
        originalInvoiceId: true,
        cancellationReason: true,
        convertedFromQuoteId: true,
        customerId: true,
        userId: true,
        incomes: { select: { id: true, amount: true, date: true }, take: 10_001 },
        paymentAdjustments: { select: { id: true }, take: 1 },
        customer: { select: { id: true, name: true, userId: true } },
      },
    });
    if (items.length > 10_000) throw new PaymentJournalError('Zu viele Rechnungen. Bitte die Auswahl eingrenzen.', 413, 'SOURCE_LIMIT');
    const states = await loadInvoicePaymentStates(tx, userId, items.filter(invoice => invoice.type === 'INVOICE' && !isUnrenderedServiceBillingDraft(invoice)).map(invoice => invoice.id), { onReview: 'omit' });
    return { items, states };
  });

  const supportsPaymentV3 = headers.get('X-Bivaro-Payment-Contract') === '3';
  if (!supportsPaymentV3 && [...states.values()].some(state => state.requiresV3)) return NextResponse.json({ error: 'Diese Rechnungsauswahl benötigt Zahlungsjournal-Vertrag 3.', code: 'PAYMENT_CAPABILITY_REQUIRED', requiredContract: 3 }, { status: 409 });
  const supportsPaymentV2 = supportsPaymentV3 || headers.get('X-Bivaro-Payment-Contract') === '2';
  if (!supportsPaymentV2 && items.some(invoice => invoice.paymentAdjustments.length > 0)) return NextResponse.json({ error: 'Diese Rechnungsauswahl enthält Berichtigungen und erfordert Zahlungsjournal-Vertrag 2.', code: 'PAYMENT_CAPABILITY_REQUIRED', requiredContract: 2 }, { status: 409 });
  const checkedItems = await Promise.all(items.map(async ({ parsedData, paymentAdjustments: _adjustments, incomes, customer, ...invoice }) => {
    void _adjustments;
    const state = states.get(invoice.id);
    let summary: InvoicePaymentState['summary'] | null = null;
    let paymentReviewRequired = false;
    let canRecordPayment = false;
    const serviceDraftEditable = isUnrenderedServiceBillingDraft({ ...invoice, parsedData });
    if (invoice.type === 'INVOICE' && !serviceDraftEditable) {
      try {
        if (!state) throw new Error('Unverified payment state');
        summary = state.summary;
        if (customer && customer.userId !== userId) throw new Error('Invalid customer ownership');
        const currency = parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData) ? parsedData.currency : null;
        if (currency != null && currency !== 'EUR') throw new Error('Unsupported currency');
        if (await getEInvoiceBookingRejection(parsedData)) throw new Error('Unsupported invoice evidence');
        canRecordPayment = !summary.paid && ['DRAFT', 'SENT'].includes(invoice.status);
      } catch {
        summary = null;
        paymentReviewRequired = true;
      }
    }
    return {
      ...invoice,
      incomes: incomes.map(income => ({ id: income.id, amount: income.amount, date: income.date })),
      customer: customer && customer.userId === userId ? { id: customer.id, name: customer.name } : null,
      paymentSummary: summary,
      paymentLedger: summary ? supportsPaymentV3 || state!.requiresV3 ? state!.ledger : reducePaymentLedger(state!.invoice.totalAmount!, state!.originEvents, state!.adjustments, state!.invoice.status).ledger : null,
      paymentContractVersion: summary ? supportsPaymentV3 || state!.requiresV3 ? 3 : 2 : null,
      paymentReviewRequired,
      canRecordPayment,
      serviceDraftEditable,
      hasEInvoiceXml: Boolean(getRawEInvoiceXml(parsedData)),
      hasPdfFile: isPdfFile(invoice.fileName) || isPdfFile(invoice.storedFileName),
    };
  }));
  const filtered = checkedItems.filter(invoice => {
    if (paidStatus === 'paid') return invoice.paymentSummary?.paid === true;
    if (paidStatus === 'unpaid') return invoice.status !== 'CANCELLED' && invoice.paymentSummary?.paid === false;
    if (paidStatus === 'partial') return invoice.status !== 'CANCELLED' && invoice.paymentSummary?.paymentState === 'PARTIAL';
    return true;
  });
  const sort = options.sort;
  if (sort) filtered.sort((a, b) => compareInvoiceListRows(a, b, sort));
  return NextResponse.json({ items: filtered.slice(skip, skip + pageSize), total: filtered.length, page, pageSize });
}
