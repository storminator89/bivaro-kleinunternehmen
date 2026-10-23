import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertBookable, ledgerSummary, type LedgerInvoice } from '@/lib/payment-journal/service';
import { loadInvoicePaymentStates, type InvoicePaymentState } from '@/lib/payment-journal/allocation-ledger';
import { PaymentJournalError, type PaymentSummary } from '@/lib/payment-journal/contract';
import type { CustomerTimelinePage, TimelineEntry } from '@/lib/customer-timeline-contract';

export const CUSTOMER_TIMELINE_PAGE_SIZE = 20;
// Never derive a rest balance from a truncated ledger. Oversized evidence is
// still navigable, but requires the existing document's full review surface.
export const CUSTOMER_TIMELINE_EVIDENCE_LIMIT = 200;
const types = ['INVOICE', 'QUOTE', 'CREDIT_NOTE'];
type Kind = 0 | 1 | 2 | 3;
type Key = { id: number; invoiceId: number; at: Date; kind: Kind; businessDate?: Date | null; dateCertainty?: string; adjustmentKind?: string; amountCents?: string; originalPaymentId?: number; originInvoiceId?: number; fromInvoiceId?: number; toInvoiceId?: number; cancellationInvoiceId?: number | null };
type Cursor = { v: 2; customerId: number; maxima: [number, number, number, number]; last: { id: number; at: string; kind: Kind } };

export class CustomerTimelineError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function decodeCursor(value: string | null, customerId: number): Cursor | null {
  if (value === null) return null;
  try {
    if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (cursor.v !== 2 || cursor.customerId !== customerId || !Array.isArray(cursor.maxima) || cursor.maxima.length !== 4
      || cursor.maxima.some(id => !Number.isSafeInteger(id) || id < 0)
      || !cursor.last || !Number.isSafeInteger(cursor.last.id) || cursor.last.id <= 0
      || ![0, 1, 2, 3].includes(cursor.last.kind) || typeof cursor.last.at !== 'string'
      || new Date(cursor.last.at).toISOString() !== cursor.last.at) throw new Error();
    return cursor;
  } catch { throw new CustomerTimelineError('Ungültiger Verlaufscursor. Bitte den Verlauf neu laden.'); }
}

function before(cursor: Cursor | null, kind: Kind, field: 'uploadedAt' | 'createdAt' | 'recordedAt'): Prisma.Sql {
  if (!cursor) return Prisma.empty;
  const column = Prisma.raw(`r."${field}"`);
  const date = new Date(cursor.last.at);
  // A total order across all three sources, including identical timestamps.
  return Prisma.sql`AND (${column} < ${date} OR (${column} = ${date} AND (${kind} < ${cursor.last.kind} OR (${kind} = ${cursor.last.kind} AND r.id < ${cursor.last.id}))))`;
}

function sortKeys(a: Key, b: Key) {
  return b.at.getTime() - a.at.getTime() || b.kind - a.kind || b.id - a.id;
}

type FinancialState = { balance: TimelineEntry['balance']; paymentState: PaymentSummary['paymentState'] | null };

async function timelineFinancialState(invoice: LedgerInvoice, state?: InvoicePaymentState | null): Promise<FinancialState> {
  const notApplicable: FinancialState = { balance: { state: 'NOT_APPLICABLE', openCents: null }, paymentState: null };
  const review: FinancialState = { balance: { state: 'REVIEW', openCents: null }, paymentState: null };
  if (state === null) return review;
  if (invoice.type !== 'INVOICE' || invoice.status === 'DRAFT') return notApplicable;
  if (!['SENT', 'PAID', 'CANCELLED'].includes(invoice.status)) return review;
  if ([invoice.incomes, invoice.paymentJournalEvents, invoice.paymentAdjustments, invoice.creditNotes].some(rows => rows.length > CUSTOMER_TIMELINE_EVIDENCE_LIMIT)) {
    return review;
  }
  try {
    // Includes currency/classification guards and the exact shared journal-v2
    // evidence graph. Legacy PAID, zero/unknown totals and contradictions are
    // not silently converted to collectible debt.
    await assertBookable(invoice);
    const summary = state?.summary ?? ledgerSummary(invoice);
    return { balance: { state: 'KNOWN', openCents: summary.openCents }, paymentState: summary.paymentState };
  } catch (error) {
    if (!(error instanceof PaymentJournalError)) throw error;
    return review;
  }
}

export async function timelineBalance(invoice: LedgerInvoice): Promise<TimelineEntry['balance']> {
  return (await timelineFinancialState(invoice)).balance;
}

function documentStatus(invoice: LedgerInvoice, balance: TimelineEntry['balance'], paymentState: FinancialState['paymentState'], conversion: 'NONE' | 'LINKED' | 'REVIEW') {
  if (invoice.type === 'QUOTE') return conversion === 'LINKED' ? 'In Rechnung übernommen' : conversion === 'REVIEW' ? 'Angebotsübernahme prüfen'
    : ({ DRAFT: 'Angebotsentwurf', SENT: 'Angebot versendet', ACCEPTED: 'Angebot angenommen', REJECTED: 'Angebot abgelehnt', EXPIRED: 'Angebot abgelaufen', CANCELLED: 'Angebot storniert' } as Record<string, string>)[invoice.status] ?? 'Angebot · Status prüfen';
  if (invoice.type === 'CREDIT_NOTE') return 'Stornobeleg';
  if (invoice.status === 'DRAFT') return 'Rechnungsentwurf · keine Forderung';
  if (invoice.status === 'CANCELLED') return 'Rechnung storniert · keine Forderung';
  if (balance.state === 'REVIEW') return 'Zahlungsstand prüfen';
  if (balance.openCents === '0') return 'Bezahlt';
  return paymentState === 'PARTIAL' ? 'Teilweise bezahlt' : 'Rechnung offen';
}

export async function readCustomerTimeline(userId: string, customerId: number, cursorValue: string | null): Promise<CustomerTimelinePage> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new CustomerTimelineError('Ungültige Kunden-ID');
  const cursor = decodeCursor(cursorValue, customerId);
  return prisma.$transaction(async tx => {
    const customer = await tx.customer.findFirst({ where: { id: customerId, userId }, select: { id: true, name: true } });
    if (!customer) throw new CustomerTimelineError('Kunde nicht gefunden', 404);
    const documentWhere = { userId, customerId, type: { in: types } };
    const eventWhere = { userId, invoice: { userId, customerId, type: 'INVOICE' } };
    const maxima: [number, number, number, number] = cursor?.maxima ?? [
      (await tx.invoice.aggregate({ where: documentWhere, _max: { id: true } }))._max.id ?? 0,
      (await tx.paymentJournalEvent.aggregate({ where: eventWhere, _max: { id: true } }))._max.id ?? 0,
      (await tx.paymentAdjustment.aggregate({ where: eventWhere, _max: { id: true } }))._max.id ?? 0,
      (await tx.paymentAllocationChange.aggregate({ where: { userId, toInvoice: { userId, customerId, type: 'INVOICE' } }, _max: { id: true } }))._max.id ?? 0,
    ];
    // All external values are bound parameters. A source can contribute at
    // most one page plus lookahead; no full-customer financial load or sum.
    const documents = await tx.$queryRaw<Array<{ id: number; invoiceId: number; at: Date }>>(Prisma.sql`
      SELECT r.id, r.id AS invoiceId, r.uploadedAt AS at FROM Invoice r
      WHERE r.userId = ${userId} AND r.customerId = ${customerId} AND r.type IN ('INVOICE', 'QUOTE', 'CREDIT_NOTE')
      AND r.id <= ${maxima[0]} ${before(cursor, 0, 'uploadedAt')}
      ORDER BY r.uploadedAt DESC, r.id DESC LIMIT ${CUSTOMER_TIMELINE_PAGE_SIZE + 1}`);
    const payments = await tx.$queryRaw<Array<{ id: number; invoiceId: number; at: Date; businessDate: Date | null; dateCertainty: string; amountCents: string }>>(Prisma.sql`
      SELECT r.id, r.invoiceId, r.createdAt AS at, r.paidAt AS businessDate, r.dateCertainty, r.amountCents FROM PaymentJournalEvent r JOIN Invoice i ON i.id = r.invoiceId
      WHERE r.userId = ${userId} AND i.userId = ${userId} AND i.customerId = ${customerId} AND i.type = 'INVOICE'
      AND r.id <= ${maxima[1]} ${before(cursor, 1, 'createdAt')}
      ORDER BY r.createdAt DESC, r.id DESC LIMIT ${CUSTOMER_TIMELINE_PAGE_SIZE + 1}`);
    const adjustments = await tx.$queryRaw<Array<{ id: number; invoiceId: number; at: Date; businessDate: Date; adjustmentKind: string; amountCents: string; originalPaymentId: number; originInvoiceId: number; cancellationInvoiceId: number | null }>>(Prisma.sql`
      SELECT r.id, r.invoiceId, r.originalPaymentId, p.invoiceId AS originInvoiceId, r.cancellationInvoiceId, r.recordedAt AS at, r.actionDate AS businessDate, r.kind AS adjustmentKind, r.amountCents FROM PaymentAdjustment r JOIN Invoice i ON i.id = r.invoiceId
      JOIN PaymentJournalEvent p ON p.id = r.originalPaymentId
      JOIN Invoice origin ON origin.id = p.invoiceId
      LEFT JOIN BankPaymentBinding binding ON binding.id = r.allocationBindingId AND binding.paymentJournalEventId = p.id AND binding.userId = r.userId
      WHERE r.userId = ${userId} AND i.userId = ${userId} AND i.customerId = ${customerId} AND i.type = 'INVOICE'
      AND p.userId = ${userId} AND origin.userId = ${userId} AND origin.customerId = ${customerId}
      AND ((r.contractVersion = 2 AND p.invoiceId = i.id) OR (r.contractVersion = 3 AND binding.id IS NOT NULL))
      AND r.id <= ${maxima[2]} ${before(cursor, 2, 'recordedAt')}
      ORDER BY r.recordedAt DESC, r.id DESC LIMIT ${CUSTOMER_TIMELINE_PAGE_SIZE + 1}`);
    const allocations = await tx.$queryRaw<Array<{ id: number; invoiceId: number; originalPaymentId: number; originInvoiceId: number; fromInvoiceId: number; toInvoiceId: number; at: Date; businessDate: Date; amountCents: string }>>(Prisma.sql`
      SELECT r.id, r.toInvoiceId AS invoiceId, b.paymentJournalEventId AS originalPaymentId, p.invoiceId AS originInvoiceId,
        r.fromInvoiceId, r.toInvoiceId, r.recordedAt AS at, r.actionDate AS businessDate, r.amountCents
      FROM PaymentAllocationChange r JOIN BankPaymentBinding b ON b.id = r.bindingId AND b.userId = r.userId
      JOIN PaymentJournalEvent p ON p.id = b.paymentJournalEventId AND p.userId = r.userId
      JOIN Invoice source ON source.id = r.fromInvoiceId JOIN Invoice target ON target.id = r.toInvoiceId
      WHERE r.userId = ${userId} AND source.userId = ${userId} AND target.userId = ${userId}
        AND source.customerId = ${customerId} AND target.customerId = ${customerId}
        AND r.id <= ${maxima[3]} ${before(cursor, 3, 'recordedAt')}
      ORDER BY r.recordedAt DESC, r.id DESC LIMIT ${CUSTOMER_TIMELINE_PAGE_SIZE + 1}`);
    const keys: Key[] = [
      ...documents.map(row => ({ ...row, kind: 0 as const })),
      ...payments.map(row => ({ ...row, kind: 1 as const })),
      ...adjustments.map(row => ({ ...row, kind: 2 as const })),
      ...allocations.map(row => ({ ...row, kind: 3 as const })),
    ].sort(sortKeys);
    const pageKeys = keys.slice(0, CUSTOMER_TIMELINE_PAGE_SIZE);
    const invoices = await tx.invoice.findMany({ where: { ...documentWhere, id: { in: [...new Set(pageKeys.map(row => row.invoiceId))] } }, include: {
      incomes: { include: { cashTransaction: true }, take: CUSTOMER_TIMELINE_EVIDENCE_LIMIT + 1 },
      paymentJournalEvents: { orderBy: { id: 'asc' }, take: CUSTOMER_TIMELINE_EVIDENCE_LIMIT + 1 },
      paymentAdjustments: { orderBy: { id: 'asc' }, take: CUSTOMER_TIMELINE_EVIDENCE_LIMIT + 1 },
      creditNotes: { orderBy: { id: 'asc' }, take: CUSTOMER_TIMELINE_EVIDENCE_LIMIT + 1 },
      convertedInvoice: { select: { id: true, userId: true, customerId: true, invoiceNumber: true, type: true } },
    } });
    const states = await loadInvoicePaymentStates(tx, userId, invoices.filter(invoice => invoice.type === 'INVOICE').map(invoice => invoice.id), { onReview: 'omit' });
    const projected = new Map(await Promise.all(invoices.map(async invoice => {
      const state = invoice.type === 'INVOICE' ? states.get(invoice.id) ?? null : undefined;
      return [invoice.id, { invoice, state, ...await timelineFinancialState(invoice, state) }] as const;
    })));
    const entries: TimelineEntry[] = [];
    for (const key of pageKeys) {
      const value = projected.get(key.invoiceId);
      if (!value) continue;
      const { invoice, state, balance, paymentState } = value;
      const root = state?.rootStates.find(value => value.root.id === (key.kind === 1 ? key.id : key.originalPaymentId));
      const known = balance.state === 'KNOWN';
      const legacy = key.kind === 1 && key.dateCertainty !== 'ACTUAL';
      const converted = invoice.type === 'QUOTE' && invoice.convertedInvoice?.userId === userId && invoice.convertedInvoice.customerId === customerId && invoice.convertedInvoice.type === 'INVOICE'
        ? { id: invoice.convertedInvoice.id, number: invoice.convertedInvoice.invoiceNumber, href: `/history?invoiceId=${invoice.convertedInvoice.id}` } : undefined;
      entries.push({
        key: `${key.kind}:${key.id}`, kind: key.kind === 0 ? 'DOCUMENT' : key.kind === 1 ? 'PAYMENT' : key.kind === 2 ? 'ADJUSTMENT' : 'ALLOCATION', recordedAt: key.at.toISOString(),
        document: { id: invoice.id, type: invoice.type, number: invoice.invoiceNumber, status: invoice.status, href: invoice.type === 'QUOTE' ? `/api/quotes/download?id=${invoice.id}` : `/history?invoiceId=${invoice.id}`, ...(converted ? { convertedInvoice: converted } : {}) },
        businessDate: key.kind === 0 ? invoice.invoiceDate?.toISOString() ?? null : key.businessDate?.toISOString() ?? null,
        dateCertainty: key.dateCertainty ?? null,
        statusLabel: key.kind === 0 ? documentStatus(invoice, balance, paymentState, converted ? 'LINKED' : invoice.convertedInvoice ? 'REVIEW' : 'NONE') : key.kind === 1
          ? !known ? 'Zahlungsnachweis · Prüfung nötig' : legacy ? 'Historischer Zahlungsnachweis' : (state?.adjustments ?? invoice.paymentAdjustments).some(row => row.originalPaymentId === key.id) ? 'Zahlung erfasst · später angepasst' : 'Zahlung bestätigt'
          : key.kind === 3 ? !known ? 'Rechnungszuordnung · Prüfung nötig' : 'Rechnungszuordnung geändert · keine Geldbewegung'
          : !known ? 'Anpassung · Prüfung nötig' : key.adjustmentKind === 'CUSTOMER_REFUND' ? 'Erstattungsnachweis · fachlich ungeprüft' : 'Zahlungskorrektur · fachlich ungeprüft',
        balance,
        ...(root ? { attribution: { originInvoiceId: root.root.invoiceId, allocatedInvoiceId: root.allocatedInvoiceId, ...(key.kind === 3 ? { fromInvoiceId: key.fromInvoiceId, toInvoiceId: key.toInvoiceId } : {}), ...(key.kind === 2 ? { cancellationInvoiceId: key.cancellationInvoiceId ?? null } : {}) } } : {}),
        amountCents: known && key.amountCents && /^[1-9][0-9]{0,15}$/u.test(key.amountCents) ? key.amountCents : null,
      });
    }
    const last = pageKeys.at(-1);
    return { customer, entries, nextCursor: keys.length > CUSTOMER_TIMELINE_PAGE_SIZE && last
      ? Buffer.from(JSON.stringify({ v: 2, customerId, maxima, last: { id: last.id, at: last.at.toISOString(), kind: last.kind } } satisfies Cursor)).toString('base64url') : null };
  });
}
