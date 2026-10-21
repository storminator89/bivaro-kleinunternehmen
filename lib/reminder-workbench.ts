import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { ledgerSummary, type LedgerInvoice } from '@/lib/payment-journal/service';
import { parseMoneyEUR, formatMoneyEUR } from '@/lib/money';

export class ReminderWorkbenchError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_REMINDER') { super(message); }
}

export type ReminderOptions = { reminderLevel?: unknown; fee?: unknown; dueDays?: unknown; notes?: unknown; expectedBalanceVersion?: unknown; idempotencyKey?: unknown };
export type ReminderBalanceSnapshot = {
  version: 1;
  balanceVersion: string;
  totalCents: string;
  paidCents: string;
  openCents: string;
  paymentHistory: { amountCents: string; paidAt: string; reference: string }[];
};
const labels: Record<number, string> = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung', 4: 'Letzte Mahnung' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = (value: string) => {
  const cents = BigInt(value);
  return `${cents / BigInt(100)},${(cents % BigInt(100)).toString().padStart(2, '0')} €`;
};

/** Shared eligibility: only explained, positive EUR balances, never guessed legacy evidence. */
export function reminderBalance(invoice: LedgerInvoice): ReminderBalanceSnapshot {
  if (invoice.type !== 'INVOICE' || !['DRAFT', 'SENT'].includes(invoice.status)) {
    throw new ReminderWorkbenchError('Mahnungen können nur für offene Rechnungen erfasst werden', 409, 'INVOICE_NOT_OPEN');
  }
  const parsed = invoice.parsedData;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.currency != null && parsed.currency !== 'EUR') {
    throw new ReminderWorkbenchError('Bitte die Rechnungswährung prüfen. Nur EUR wird unterstützt.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }
  let summary;
  try { summary = ledgerSummary(invoice); }
  catch { throw new ReminderWorkbenchError('Zahlungsnachweise müssen zuerst im Zahlungsjournal geprüft werden.', 409, 'PAYMENT_REVIEW_REQUIRED'); }
  if (summary.paid || invoice.paymentJournalEvents.some(event => event.dateCertainty !== 'ACTUAL' || !event.paidAt)) {
    throw new ReminderWorkbenchError('Kein eindeutig belegter offener Restbetrag vorhanden.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }
  const events = [...invoice.paymentJournalEvents].sort((a, b) => a.id - b.id);
  return {
    version: 1,
    balanceVersion: hash([invoice.userId, invoice.id, invoice.status, invoice.totalAmount, invoice.paidAt,
      invoice.invoiceNumber, invoice.dueDate, events.map(event => [event.id, event.amountCents, event.paidAt, event.reference, event.incomeId])]),
    totalCents: summary.totalCents, paidCents: summary.paidCents, openCents: summary.openCents,
    paymentHistory: events.map(event => ({ amountCents: event.amountCents, paidAt: event.paidAt!.toISOString(), reference: event.reference })),
  };
}

export function assertReminderBalance(snapshot: ReminderBalanceSnapshot, expected: unknown, required = true) {
  if (expected === undefined && !required) return;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected)) {
    throw new ReminderWorkbenchError('Bitte den aktuellen Restbetrag zuerst prüfen.', 409, 'BALANCE_CONFIRMATION_REQUIRED');
  }
  if (snapshot.balanceVersion !== expected) {
    throw new ReminderWorkbenchError('Der Zahlungsstand hat sich geändert. Bitte den aktuellen Restbetrag erneut prüfen und bewusst bestätigen.', 409, 'PAYMENT_STATE_CHANGED');
  }
}

export function normalizeReminderOptions(options: ReminderOptions, defaultLevel = 1) {
  const reminderLevel = options.reminderLevel === undefined ? defaultLevel : Number(options.reminderLevel);
  const dueDays = options.dueDays === undefined ? 14 : Number(options.dueDays);
  if (!Number.isInteger(reminderLevel) || reminderLevel < 1 || reminderLevel > 4 || !Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
    throw new ReminderWorkbenchError('Mahnstufe oder Zahlungsfrist ist ungültig.');
  }
  let feeCents;
  try { feeCents = parseMoneyEUR(options.fee == null ? 0 : options.fee as string | number); }
  catch { throw new ReminderWorkbenchError('Die manuell eingetragene Gebühr muss centgenau sein.'); }
  if (feeCents < BigInt(0) || feeCents > BigInt(1_000_000)) throw new ReminderWorkbenchError('Die manuell eingetragene Gebühr ist ungültig.');
  if (options.notes != null && (typeof options.notes !== 'string' || options.notes.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(options.notes))) {
    throw new ReminderWorkbenchError('Die Notiz ist ungültig.');
  }
  return { reminderLevel, dueDays, fee: Number(formatMoneyEUR(feeCents)), feeCents: feeCents.toString(), notes: typeof options.notes === 'string' ? options.notes.trim() || null : null };
}

async function ownedReminderInvoice(tx: Prisma.TransactionClient, userId: string, invoiceId: number) {
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new ReminderWorkbenchError('Ungültige Rechnungs-ID.');
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId }, include: {
    customer: true, incomes: { include: { cashTransaction: true } },
    paymentJournalEvents: { orderBy: { id: 'asc' } }, reminders: { orderBy: { id: 'desc' }, take: 1 },
  } });
  if (!invoice) throw new ReminderWorkbenchError('Rechnung nicht gefunden.', 404, 'NOT_FOUND');
  if (invoice.customerId != null && !await tx.customer.findFirst({ where: { id: invoice.customerId, userId }, select: { id: true } })) {
    throw new ReminderWorkbenchError('Bitte die Kundenzuordnung prüfen.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }
  return invoice;
}

export function composeReminderText(invoiceNumber: string, balance: ReminderBalanceSnapshot, options: ReturnType<typeof normalizeReminderOptions>, companyName: string, dueDate: Date) {
  return [
    'Sehr geehrte Damen und Herren,', '',
    `zu Rechnung ${invoiceNumber} ist nach unserem aktuellen Zahlungsjournal noch ein Restbetrag offen.`, '',
    `Rechnungsbetrag: ${money(balance.totalCents)}`,
    `Bereits eingegangen: ${money(balance.paidCents)}`,
    `Offener Restbetrag: ${money(balance.openCents)}`,
    ...(options.feeCents !== '0' ? [`Manuell eingetragene Mahngebühr: ${money(options.feeCents)}`] : []),
    `Zahlbetrag: ${money((BigInt(balance.openCents) + BigInt(options.feeCents)).toString())}`, '',
    `Bitte überweisen Sie den Zahlbetrag bis zum ${dueDate.toLocaleDateString('de-DE', { timeZone: 'UTC' })}.`,
    'Sollte sich eine weitere Zahlung mit diesem Schreiben überschnitten haben, melden Sie sich bitte bei uns.',
    ...(options.notes ? ['', `Hinweis: ${options.notes}`] : []), '',
    'Die ursprüngliche Rechnung bleibt unverändert.', '', 'Mit freundlichen Grüßen', companyName,
  ].join('\n');
}

async function previewInTransaction(tx: Prisma.TransactionClient, userId: string, invoiceId: number, input: ReminderOptions, requireConfirmation: boolean) {
  const invoice = await ownedReminderInvoice(tx, userId, invoiceId);
  const balance = reminderBalance(invoice);
  assertReminderBalance(balance, input.expectedBalanceVersion, requireConfirmation || input.expectedBalanceVersion !== undefined);
  const options = normalizeReminderOptions(input, Math.min((invoice.reminders[0]?.reminderLevel ?? 0) + 1, 4));
  const settings = await tx.settings.findUnique({ where: { userId }, select: { companyName: true } });
  const dueDate = new Date(); dueDate.setUTCDate(dueDate.getUTCDate() + options.dueDays);
  const invoiceNumber = invoice.invoiceNumber || invoice.fileName;
  return { invoice, balance, options, dueDate, subject: `${labels[options.reminderLevel]} zu Rechnung ${invoiceNumber}`,
    text: composeReminderText(invoiceNumber, balance, options, settings?.companyName || '[Ihr Firmenname]', dueDate),
    recipient: invoice.customer?.email || null,
  };
}

export async function previewReminder(userId: string, invoiceId: number, input: ReminderOptions = {}, requireConfirmation = false) {
  return inTransaction(async tx => {
    const preview = await previewInTransaction(tx, userId, invoiceId, input, requireConfirmation);
    return { invoiceId, invoiceNumber: preview.invoice.invoiceNumber || preview.invoice.fileName,
      ...preview.balance, reminderLevel: preview.options.reminderLevel, feeCents: preview.options.feeCents,
      dueDate: preview.dueDate.toISOString(), subject: preview.subject, text: preview.text, recipient: preview.recipient,
      automaticDelivery: false, partialEmailDeliveryAvailable: false,
    };
  });
}

async function recordReminderOnce(userId: string, invoiceId: number, input: ReminderOptions) {
  return inTransaction(async tx => {
    const key = input.idempotencyKey;
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/u.test(key))) throw new ReminderWorkbenchError('Ungültiger Wiederholungsschlüssel.');
    // Replay precedes freshness: a successful request remains a replay after a later payment.
    const prior = typeof key === 'string' ? await tx.reminder.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } }, include: { invoice: { include: { customer: true } } } }) : null;
    if (prior) {
      const options = normalizeReminderOptions(input, prior.reminderLevel);
      const stored = prior.balanceSnapshot as Record<string, unknown> | null;
      if (prior.invoiceId !== invoiceId || prior.reminderLevel !== options.reminderLevel || prior.fee !== options.fee || prior.notes !== options.notes
        || stored?.balanceVersion !== input.expectedBalanceVersion || stored?.dueDays !== options.dueDays) {
        throw new ReminderWorkbenchError('Dieser Wiederholungsschlüssel gehört zu einer anderen Mahnung.', 409, 'IDEMPOTENCY_CONFLICT');
      }
      return { ...prior, replayed: true };
    }
    if (typeof key === 'string' && key.startsWith('restored:')) throw new ReminderWorkbenchError('Wiederherstellungs-Identitäten sind für neue Befehle reserviert.');
    const preview = await previewInTransaction(tx, userId, invoiceId, input, false);
    if (preview.balance.paidCents !== '0' && input.expectedBalanceVersion === undefined) throw new ReminderWorkbenchError('Bitte den Restbetrag nach Zahlungseingang ausdrücklich prüfen.', 409, 'PAYMENT_REVIEW_REQUIRED');
    assertReminderBalance(preview.balance, input.expectedBalanceVersion, preview.balance.paidCents !== '0' || key !== undefined);
    if ((preview.balance.paidCents !== '0' || input.expectedBalanceVersion !== undefined) && key === undefined) throw new ReminderWorkbenchError('Bitte die Mahnung mit einem Wiederholungsschlüssel bestätigen.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    const snapshot = { ...preview.balance, dueDays: preview.options.dueDays };
    const reminder = await tx.reminder.create({ data: { invoiceId, userId,
      reminderLevel: preview.options.reminderLevel, fee: preview.options.fee, notes: preview.options.notes,
      dueDate: preview.dueDate, idempotencyKey: typeof key === 'string' ? key : null, balanceSnapshot: input.expectedBalanceVersion === undefined ? Prisma.DbNull : snapshot,
    }, include: { invoice: { include: { customer: true } } } });
    await createFinancialAuditLog({ userId, action: 'CREATE', entityType: 'Reminder', entityId: reminder.id,
      entityName: preview.invoice.invoiceNumber || preview.invoice.fileName,
      newValues: { invoiceId, reminderLevel: reminder.reminderLevel, fee: reminder.fee, dueDate: reminder.dueDate, balanceSnapshot: snapshot },
      metadata: { actorId: userId, tenantId: userId, operation: 'reminder.record-confirmed-balance', originalReference: preview.invoice.invoiceNumber || `invoice:${invoiceId}`, reason: 'user confirmed internal reminder only; no communication sent' },
    }, tx);
    return { ...reminder, replayed: false };
  });
}

export async function recordReminder(userId: string, invoiceId: number, input: ReminderOptions = {}) {
  for (let retry = 0; ; retry++) {
    try { return await recordReminderOnce(userId, invoiceId, input); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && retry === 0) continue;
      throw error;
    }
  }
}
