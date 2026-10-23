import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEInvoiceBookingRejection } from '@/lib/e-invoice-parser';
import { hasServiceBillingDraftMarker } from '@/lib/service-billing';
import { formatBusinessDate, parseBusinessDate } from '@/lib/business-date';
import { exactPaymentCents } from '@/lib/payment-journal/contract';
import { loadInvoicePaymentStates } from '@/lib/payment-journal/allocation-ledger';
import { quoteBusinessToday, quoteNextAction } from '@/lib/quote-workflow';
import { AI_RECEIPT_MAX_JOBS } from '@/lib/purchase-documents/ai-contract';
import { parseMoneyEUR } from '@/lib/money';
import type { DailyAction, DailyActions } from './contract';

const SOURCE_LIMIT = 500;
const ACTION_LIMIT = 50;
function sourceCents(value: unknown): string | null {
  try { return exactPaymentCents(value).toString(); } catch { return null; }
}
function receiptSourceCents(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100 || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  try {
    const cents = parseMoneyEUR(value, { mode: 'strict' });
    return cents >= BigInt(0) ? cents.toString() : null;
  } catch { return null; }
}
type ReceiptEvidence = { id: number; grossAmount: unknown; aiStatus: string | null; aiSourceRevision: number | bigint | null };
function currencyIsEUR(parsed: unknown): boolean {
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) as unknown; } catch { return false; } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const currency = (parsed as Record<string, unknown>).currency;
  return currency == null || currency === 'EUR';
}

/** Fresh, tenant-owned snapshot; no tasks, bookings, emails or provider calls. */
export async function readDailyActions(userId: string, now = new Date()): Promise<DailyActions> {
  const today = quoteBusinessToday(now);
  const day = parseBusinessDate(today);
  const nextDay = new Date(day.getTime() + 86_400_000);
  const [invoices, quotes, receipts, receiptEvidence, paymentOpenById] = await prisma.$transaction(async tx => {
    const [invoices, quotes, receipts] = await Promise.all([
    tx.invoice.findMany({
      where: { userId, type: 'INVOICE', status: 'SENT', dueDate: { lt: nextDay } },
      include: { customer: { select: { name: true, userId: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: SOURCE_LIMIT + 1,
    }),
    tx.invoice.findMany({
      where: { userId, type: 'QUOTE', convertedInvoice: { is: null }, OR: [
        { status: 'ACCEPTED' },
        { status: { in: ['DRAFT', 'SENT'] }, quoteFollowUpOn: { lte: today } },
        { status: 'SENT', validUntil: { lt: day } },
      ] },
      select: { id: true, userId: true, status: true, fileName: true, invoiceNumber: true, invoiceDate: true, uploadedAt: true, totalAmount: true, parsedData: true, quoteFollowUpOn: true, validUntil: true, customer: { select: { name: true, userId: true } } },
      orderBy: [{ quoteFollowUpOn: 'asc' }, { id: 'asc' }], take: SOURCE_LIMIT + 1,
    }),
    tx.purchaseDocument.findMany({
      where: { userId, reviewStatus: 'REVIEW', expenseId: null },
      select: { id: true, originalFileName: true, uploadedAt: true, currency: true, supplierName: true, reviewDraftSavedAt: true, parseStatus: true, revision: true },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }], take: SOURCE_LIMIT + 1,
    }),
    ]);
    // Only bounded source scalars cross the database boundary. The legacy Float
    // is not source evidence, and task prioritization never needs AI results.
    const receiptEvidence = receipts.length ? await tx.$queryRaw<ReceiptEvidence[]>(Prisma.sql`
      SELECT "id",
        CASE WHEN "parseStatus" = 'PARSED' AND json_valid("parsedData") THEN
          CASE WHEN json_type("parsedData", '$.grossAmount') = 'text'
            THEN substr(json_extract("parsedData", '$.grossAmount'), 1, 101) ELSE NULL END
          ELSE NULL END AS "grossAmount",
        CASE WHEN "aiExtraction" IS NULL THEN NULL
          WHEN NOT json_valid("aiExtraction") THEN 'unknown'
          WHEN json_type("aiExtraction") <> 'object'
            OR json_type("aiExtraction", '$.version') IS NOT 'integer'
            OR json_extract("aiExtraction", '$.version') IS NOT 1
            OR json_type("aiExtraction", '$.jobs') IS NOT 'array' THEN 'unknown'
          WHEN json_array_length("aiExtraction", '$.jobs') > ${AI_RECEIPT_MAX_JOBS} THEN 'unknown'
          WHEN json_array_length("aiExtraction", '$.jobs') = 0 THEN NULL
          WHEN json_type("aiExtraction", '$.jobs[#-1]') IS NOT 'object'
            OR json_type("aiExtraction", '$.jobs[#-1].status') IS NOT 'text'
            OR length(json_extract("aiExtraction", '$.jobs[#-1].status')) > 16
            OR json_extract("aiExtraction", '$.jobs[#-1].status') NOT IN ('queued','running','completed','failed','unknown')
            OR json_type("aiExtraction", '$.jobs[#-1].sourceSha256') IS NOT 'text'
            OR json_extract("aiExtraction", '$.jobs[#-1].sourceSha256') IS NOT "originalSha256"
            OR json_type("aiExtraction", '$.jobs[#-1].sourceRevision') IS NOT 'integer'
            OR json_extract("aiExtraction", '$.jobs[#-1].sourceRevision') < 0
            OR json_extract("aiExtraction", '$.jobs[#-1].sourceRevision') > "revision"
            THEN 'unknown'
          ELSE substr(json_extract("aiExtraction", '$.jobs[#-1].status'), 1, 16) END AS "aiStatus",
        CASE WHEN json_valid("aiExtraction") THEN
          CASE WHEN json_type("aiExtraction", '$.jobs[#-1].sourceRevision') = 'integer'
            AND json_extract("aiExtraction", '$.jobs[#-1].sourceRevision') BETWEEN 0 AND "revision"
            THEN json_extract("aiExtraction", '$.jobs[#-1].sourceRevision') ELSE NULL END
          ELSE NULL END AS "aiSourceRevision"
      FROM "PurchaseDocument" WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(receipts.map(receipt => receipt.id))})
    `) : [];
    const states = await loadInvoicePaymentStates(tx, userId, invoices.slice(0, SOURCE_LIMIT).filter(invoice => !hasServiceBillingDraftMarker(invoice.parsedData)).map(invoice => invoice.id), { onReview: 'omit' });
    const paymentOpenById = new Map([...states].map(([id, state]) => [id, state.summary.openCents]));
    return [invoices, quotes, receipts, receiptEvidence, paymentOpenById] as const;
  });
  const evidenceByReceipt = new Map(receiptEvidence.map(evidence => [Number(evidence.id), evidence]));
  const actions: DailyAction[] = [];
  for (const invoice of invoices.slice(0, SOURCE_LIMIT)) {
    // Valid planning drafts remain outside the existing SENT-only source query.
    // A planning marker on a SENT row is damaged evidence, never a receivable.
    const planningMarker = hasServiceBillingDraftMarker(invoice.parsedData);
    if (!planningMarker && invoice.totalAmount !== null && invoice.totalAmount <= 0) continue;
    const date = formatBusinessDate(invoice.dueDate!);
    let openCents: string | null = null;
    try {
      if (!planningMarker && currencyIsEUR(invoice.parsedData) && (!invoice.customer || invoice.customer.userId === userId) && !await getEInvoiceBookingRejection(invoice.parsedData)) openCents = paymentOpenById.get(invoice.id) ?? null;
    } catch { /* Unknown historical balance is a review, never an estimated debt. */ }
    if (openCents === '0') continue;
    const overdue = date < today;
    const unknown = openCents === null;
    actions.push({
      id: `invoice:${invoice.id}`, kind: unknown ? 'INVOICE_REVIEW' : overdue ? 'INVOICE_OVERDUE' : 'INVOICE_DUE',
      priority: unknown ? 2 : overdue ? 1 : 3,
      title: planningMarker ? 'Serviceentwurf klären' : unknown ? 'Zahlungsstand klären' : overdue ? 'Überfällige Rechnung prüfen' : 'Heute fällige Rechnung prüfen',
      reason: planningMarker ? 'Dieser Datensatz enthält einen Serviceplan-Entwurfsmarker und ist keine bestätigte Forderung. Den Beleg im bestehenden Rechnungsablauf prüfen; keine Zahlung oder Mahnung daraus ableiten.' : unknown ? 'Zahlungsnachweise, Währung oder Belegquelle sind nicht eindeutig. Erst prüfen, keinen offenen Betrag annehmen.' : overdue ? 'Das Fälligkeitsdatum ist vorbei. Der Restbetrag stammt aus dem vollständigen Zahlungsjournal; vor dem Nachfassen Zahlungseingänge prüfen.' : 'Laut gespeichertem Fälligkeitsdatum heute fällig. Zahlungseingänge prüfen; noch nicht überfällig.',
      source: invoice.invoiceNumber || invoice.fileName, party: invoice.customer?.userId === userId ? invoice.customer.name : null,
      date, dateLabel: planningMarker ? 'Gespeichertes Datum' : 'Fällig am', amountCents: openCents, amountLabel: planningMarker ? 'Keine bestätigte Forderung' : unknown ? 'Restbetrag ungeklärt' : 'Noch offen laut Journal',
      href: `/dashboard?tab=invoices&document=${invoice.id}`, cta: 'Rechnung prüfen',
    });
  }
  for (const quote of quotes.slice(0, SOURCE_LIMIT)) {
    if (quote.totalAmount !== null && quote.totalAmount <= 0) continue;
    let followUpOn = quote.quoteFollowUpOn;
    if (followUpOn) { try { parseBusinessDate(followUpOn); } catch { followUpOn = null; } }
    const action = quoteNextAction({ ...quote, quoteFollowUpOn: followUpOn }, today);
    if (!action) continue;
    const ready = action.kind === 'READY_TO_INVOICE';
    const followUp = action.kind === 'FOLLOW_UP';
    const date = followUp ? quote.quoteFollowUpOn! : ready ? quote.invoiceDate ? formatBusinessDate(quote.invoiceDate) : quoteBusinessToday(quote.uploadedAt) : formatBusinessDate(quote.validUntil!);
    actions.push({
      id: `quote:${quote.id}`, kind: ready ? 'QUOTE_READY' : followUp ? 'QUOTE_FOLLOW_UP' : 'QUOTE_RESPONSE',
      priority: followUp && date < today ? 4 : ready ? 5 : 6,
      title: ready ? 'Rechnung aus Angebot vorbereiten' : followUp ? 'Angebot nachfassen' : 'Rückmeldung zum Angebot klären',
      reason: ready ? 'Von dir als angenommen erfasst, noch keine verknüpfte Rechnung. Den bestehenden Rechnungsentwurf öffnen und bewusst prüfen.' : followUp ? 'Dein vorgemerktes Nachfassdatum ist erreicht. Rückmeldung selbst klären und den Stand im Angebot festhalten.' : 'Die gespeicherte Gültigkeit ist vorbei. Das ist keine Absage; Rückmeldung manuell klären.',
      source: quote.invoiceNumber || quote.fileName, party: quote.customer?.userId === userId ? quote.customer.name : null,
      date, dateLabel: followUp ? 'Vorgemerkt für' : ready ? quote.invoiceDate ? 'Angebotsdatum' : 'Hochgeladen am' : 'Gültig bis',
      amountCents: currencyIsEUR(quote.parsedData) ? sourceCents(quote.totalAmount) : null, amountLabel: 'Angebotsbetrag · kein Umsatz',
      href: `/dashboard?tab=quotes&document=${quote.id}`, cta: ready ? 'Angebot öffnen' : 'Rückmeldung erfassen',
    });
  }
  for (const receipt of receipts.slice(0, SOURCE_LIMIT)) {
    const evidence = evidenceByReceipt.get(receipt.id);
    const aiStatus = evidence?.aiStatus;
    const failed = aiStatus === 'failed' || aiStatus === 'unknown' || !evidence;
    const aiChanged = evidence?.aiSourceRevision != null && Number(evidence.aiSourceRevision) < receipt.revision;
    actions.push({
      id: `receipt:${receipt.id}`, kind: 'RECEIPT_REVIEW', priority: failed ? 7 : 8,
      title: failed ? 'Beleg manuell weiterprüfen' : receipt.reviewDraftSavedAt ? 'Beleg-Prüfentwurf fortsetzen' : 'Eingangsbeleg prüfen',
      reason: failed ? 'Die KI-Auswertung ist fehlgeschlagen oder nicht eindeutig. Das Original und gespeicherte Eingaben manuell prüfen; kein automatischer Neuversuch.' : aiStatus ? `Der KI-Stand wird hier nicht fachlich bewertet.${aiChanged ? ' Der Beleg wurde seit diesem KI-Stand weiterbearbeitet.' : ''} Original, Vorschläge und gespeicherten Entwurf im Beleg selbst prüfen; noch keine Ausgabe oder Zahlung.` : receipt.reviewDraftSavedAt ? 'Ein Prüfentwurf ist gespeichert. Die Prüfung ist noch offen; es wurde keine Ausgabe daraus erfasst.' : receipt.parseStatus === 'FAILED' ? 'Der Beleg konnte nicht vollständig ausgelesen werden. Original manuell prüfen; noch keine Ausgabe daraus erfasst.' : 'Die menschliche Prüfung ist noch offen. Original prüfen, bevor eine Ausgabe bewusst erfasst wird.',
      source: receipt.originalFileName, party: receipt.supplierName,
      date: quoteBusinessToday(receipt.uploadedAt), dateLabel: 'Hochgeladen am',
      amountCents: receipt.currency === 'EUR' ? receiptSourceCents(evidence?.grossAmount) : null, amountLabel: 'Ausgelesener Betrag · ungeprüft',
      href: `/purchases?document=${receipt.id}`, cta: 'Belegprüfung fortsetzen',
    });
  }
  // One action per source document. Overlapping quote conditions never duplicate it.
  const unique = [...new Map(actions.map(action => [action.id, action])).values()];
  unique.sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { businessDate: today, timeZone: 'Europe/Berlin', generatedAt: now.toISOString(), actions: unique.slice(0, ACTION_LIMIT), actionCount: unique.length, isPartial: [invoices, quotes, receipts].some(rows => rows.length > SOURCE_LIMIT) };
}
