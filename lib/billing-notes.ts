import { Prisma } from '@prisma/client';
import { parseBusinessDate, BusinessDateError } from '@/lib/business-date';
import type { ParsedEInvoiceLineItem } from '@/lib/e-invoice-parser';

export const MAX_BILLING_NOTE_DESCRIPTION_LENGTH = 500;
export const MAX_BILLING_NOTE_UNIT_LENGTH = 100;
export const MAX_BILLING_NOTES_PER_REQUEST = 100;
export const MAX_BILLING_NOTE_REQUEST_BYTES = 64 * 1024;

export const NOTE_VISIBILITIES = ['EDITOR', 'SEND', 'BOTH'] as const;
export type NoteVisibility = typeof NOTE_VISIBILITIES[number];

export class BillingNoteInputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'BillingNoteInputError';
  }
}

export class BillingNoteClaimError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
    this.name = 'BillingNoteClaimError';
  }
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new BillingNoteInputError(`${field} ist erforderlich`);
  const text = value.trim();
  if (!text) throw new BillingNoteInputError(`${field} ist erforderlich`);
  if (text.length > max) throw new BillingNoteInputError(`${field} ist zu lang`);
  return text;
}

export function parseNoteVisibility(value: unknown, fallback: NoteVisibility = 'BOTH'): NoteVisibility {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !NOTE_VISIBILITIES.includes(value as NoteVisibility)) {
    throw new BillingNoteInputError('Ungültige Notizsichtbarkeit');
  }
  return value as NoteVisibility;
}

export function parsePositiveId(value: unknown, field = 'ID'): number {
  const parsed = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BillingNoteInputError(`Ungültige ${field}`);
  return parsed;
}

export function parseCustomerId(value: unknown): number {
  return parsePositiveId(value, 'Kunden-ID');
}

export function parseBillingNoteInput(input: Record<string, unknown>) {
  let serviceDate: Date;
  try {
    serviceDate = parseBusinessDate(input.serviceDate);
  } catch (error) {
    if (error instanceof BusinessDateError) throw new BillingNoteInputError('Leistungsdatum muss ein gültiger Kalendertag im Format YYYY-MM-DD sein');
    throw error;
  }

  const quantityValue = input.quantity === undefined ? 1 : input.quantity;
  const quantity = typeof quantityValue === 'number'
    ? quantityValue
    : (typeof quantityValue === 'string' && quantityValue.trim() ? Number(quantityValue) : NaN);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new BillingNoteInputError('Menge muss eine endliche Zahl größer als 0 sein');
  if (quantity > Number.MAX_SAFE_INTEGER) throw new BillingNoteInputError('Menge ist zu groß');

  return {
    customerId: parseCustomerId(input.customerId),
    serviceDate,
    description: boundedText(input.description, 'Beschreibung', MAX_BILLING_NOTE_DESCRIPTION_LENGTH),
    quantity,
    unit: boundedText(input.unit === undefined ? 'Stunde' : input.unit, 'Einheit', MAX_BILLING_NOTE_UNIT_LENGTH),
  };
}

/** Normalize labels for matching notes against imported invoice line items. */
export function normalizeBillingLineText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('de-DE')
    : '';
}

/** Treat the common German/UN/EU spellings of a unit as equivalent. */
export function normalizeBillingUnit(value: unknown): string {
  const normalized = normalizeBillingLineText(value).replace(/[.\-_/]/gu, '');
  const aliases: Record<string, string> = {
    h: 'hour', std: 'hour', stdn: 'hour', stunde: 'hour', stunden: 'hour', hour: 'hour', hours: 'hour', hur: 'hour',
    tag: 'day', tage: 'day', day: 'day', days: 'day', 'day(s)': 'day',
    pauschal: 'lump-sum', ls: 'lump-sum', 'lump sum': 'lump-sum', 'lump-sum': 'lump-sum',
    stk: 'piece', stueck: 'piece', stück: 'piece', stücke: 'piece', piece: 'piece', pieces: 'piece', c62: 'piece',
  };
  return aliases[normalized] ?? normalized;
}

function quantityMatches(left: unknown, right: unknown): boolean {
  const a = typeof left === 'number' ? left : Number(left);
  const b = typeof right === 'number' ? right : Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

export function billingNoteMatchesLine(
  note: { description: string; quantity: number; unit: string },
  line: Pick<ParsedEInvoiceLineItem, 'description' | 'details' | 'quantity' | 'unit'>,
): boolean {
  const description = normalizeBillingLineText(note.description);
  const lineDescription = normalizeBillingLineText(line.description);
  const lineDetails = normalizeBillingLineText(line.details);
  const textMatches = description.length > 0 && (description === lineDescription || description === lineDetails);
  return Boolean(textMatches)
    && quantityMatches(note.quantity, line.quantity)
    && normalizeBillingUnit(note.unit) === normalizeBillingUnit(line.unit);
}

/** The selected customer must be the buyer represented by the imported invoice. */
export function customerNameMatchesInvoiceBuyer(customerName: string, invoiceBuyerName: string | null | undefined): boolean {
  const selected = normalizeBillingLineText(customerName);
  const buyer = normalizeBillingLineText(invoiceBuyerName);
  return selected.length > 0 && buyer.length > 0 && selected === buyer;
}

type BillingNoteTransactionClient = Pick<Prisma.TransactionClient, 'billingNote'>;

/**
 * Claim notes and validate their invoice lines in the same transaction that
 * creates the invoice. Any mismatch or race throws and rolls back all claims.
 */
export async function claimBillingNotesForInvoice(
  tx: BillingNoteTransactionClient,
  options: {
    userId: string;
    customerId: number;
    invoiceId: number;
    billingNoteIds: number[];
    lineItems: ParsedEInvoiceLineItem[];
  },
) {
  const ids = options.billingNoteIds;
  if (ids.length === 0) return [];
  if (ids.length > MAX_BILLING_NOTES_PER_REQUEST) throw new BillingNoteClaimError('Zu viele Leistungsnotizen', 400);
  if (new Set(ids).size !== ids.length) throw new BillingNoteClaimError('Leistungsnotizen dürfen nicht doppelt angegeben werden', 400);

  const notes = await tx.billingNote.findMany({ where: { id: { in: ids }, userId: options.userId } });
  if (notes.length !== ids.length) throw new BillingNoteClaimError('Leistungsnotiz nicht gefunden', 404);
  if (notes.some(note => note.customerId !== options.customerId)) {
    throw new BillingNoteClaimError('Leistungsnotiz und Rechnung gehören zu unterschiedlichen Kunden', 409);
  }
  if (notes.some(note => note.invoiceId !== null)) {
    throw new BillingNoteClaimError('Mindestens eine Leistungsnotiz ist bereits einer Rechnung zugeordnet', 409);
  }

  const usedLines = new Set<number>();
  for (const note of notes) {
    const lineIndex = options.lineItems.findIndex((line, index) => !usedLines.has(index) && billingNoteMatchesLine(note, line));
    if (lineIndex < 0) {
      throw new BillingNoteClaimError(`Die Leistungsnotiz „${note.description}“ ist in der Rechnung nicht enthalten`, 409);
    }
    usedLines.add(lineIndex);
  }

  const claimed = await tx.billingNote.updateMany({
    where: { id: { in: ids }, userId: options.userId, customerId: options.customerId, invoiceId: null },
    data: { invoiceId: options.invoiceId },
  });
  if (claimed.count !== ids.length) {
    throw new BillingNoteClaimError('Eine Leistungsnotiz wurde inzwischen einer anderen Rechnung zugeordnet', 409);
  }
  return notes;
}
