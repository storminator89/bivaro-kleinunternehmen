import { formatBusinessDate, parseBusinessDate } from '@/lib/business-date';

export class QuoteWorkflowInputError extends Error {}

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export const QUOTE_ACTION_FILTERS = ['FOLLOW_UP', 'NEEDS_RESPONSE', 'READY_TO_INVOICE'] as const;
export type QuoteActionFilter = typeof QUOTE_ACTION_FILTERS[number];
export type QuoteWorkflowCounts = Record<QuoteActionFilter, number>;
export type QuoteWorkflowUpdate = { status: string; quoteFollowUpOn: string | null; quoteResponseNote: string | null };

/** In-app tasks use a German business calendar, never an elapsed 24-hour timer. */
export function quoteBusinessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function parseQuoteWorkflowUpdate(input: Record<string, unknown>): Partial<QuoteWorkflowUpdate> {
  const result: Partial<QuoteWorkflowUpdate> = {};
  if ('status' in input) {
    if (!QUOTE_STATUSES.includes(input.status as typeof QUOTE_STATUSES[number])) throw new QuoteWorkflowInputError('Ungültiger Angebotsstatus');
    result.status = input.status as string;
  }
  if ('quoteFollowUpOn' in input) {
    if (input.quoteFollowUpOn === null || input.quoteFollowUpOn === '') result.quoteFollowUpOn = null;
    else {
      try { parseBusinessDate(input.quoteFollowUpOn); } catch { throw new QuoteWorkflowInputError('Bitte ein gültiges Nachfassdatum im Format JJJJ-MM-TT angeben'); }
      result.quoteFollowUpOn = input.quoteFollowUpOn as string;
    }
  }
  if ('quoteResponseNote' in input) {
    if (input.quoteResponseNote !== null && typeof input.quoteResponseNote !== 'string') throw new QuoteWorkflowInputError('Die interne Notiz muss Text sein');
    if (typeof input.quoteResponseNote === 'string' && input.quoteResponseNote.length > 2000) throw new QuoteWorkflowInputError('Die interne Notiz darf höchstens 2000 Zeichen enthalten');
    result.quoteResponseNote = typeof input.quoteResponseNote === 'string' ? input.quoteResponseNote.trim() || null : null;
  }
  if (!Object.keys(result).length) throw new QuoteWorkflowInputError('Keine Änderung angegeben');
  return result;
}

export function quoteNextAction(quote: { status: string; quoteFollowUpOn?: string | null; validUntil?: string | Date | null; convertedInvoice?: { id: number } | null }, today = quoteBusinessToday()): { label: string; kind: QuoteActionFilter } | null {
  if (quote.convertedInvoice || ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(quote.status)) return null;
  if (quote.status === 'ACCEPTED') return { label: 'Rechnungsentwurf vorbereiten', kind: 'READY_TO_INVOICE' };
  if (quote.quoteFollowUpOn && quote.quoteFollowUpOn <= today) return { label: quote.quoteFollowUpOn < today ? 'Nachfassen überfällig' : 'Heute nachfassen', kind: 'FOLLOW_UP' };
  if (quote.status === 'SENT' && quote.validUntil && formatBusinessDate(quote.validUntil) < today) return { label: 'Gültigkeit vorbei · Rückmeldung klären', kind: 'NEEDS_RESPONSE' };
  return null;
}

/** Conversion prepares a reviewable invoice, never a declaration by the client. */
export function quoteConversionBlockReason(quote: { status: string; validUntil?: string | Date | null }, today = quoteBusinessToday()): string | null {
  if (!['DRAFT', 'SENT', 'ACCEPTED'].includes(quote.status)) return 'Bitte das Angebot unter „Rückmeldung & Nachfassen“ bewusst wieder öffnen oder eine erhaltene Annahme manuell erfassen.';
  if (quote.status === 'SENT' && quote.validUntil && formatBusinessDate(quote.validUntil) < today) return 'Die Gültigkeit ist vorbei. Bitte zuerst unter „Rückmeldung & Nachfassen“ die Rückmeldung klären und das Angebot bewusst wieder öffnen oder die Annahme manuell erfassen.';
  return null;
}
