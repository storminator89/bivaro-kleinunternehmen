import { describe, expect, it } from 'vitest';
import { parseQuoteWorkflowUpdate, quoteBusinessToday, quoteConversionBlockReason, quoteNextAction } from '@/lib/quote-workflow';

describe('quote follow-up calendar and manual response contract', () => {
  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '2026-1-01', '2026-10-21T00:00:00Z', '0000-01-01', 123])('rejects invalid task day %s', quoteFollowUpOn => {
    expect(() => parseQuoteWorkflowUpdate({ quoteFollowUpOn })).toThrow();
  });
  it('accepts leap days and normalizes clearing without modifying document data', () => {
    expect(parseQuoteWorkflowUpdate({ quoteFollowUpOn: '2028-02-29', quoteResponseNote: '  Telefonat  ', parsedData: { items: [] } })).toEqual({ quoteFollowUpOn: '2028-02-29', quoteResponseNote: 'Telefonat' });
    expect(parseQuoteWorkflowUpdate({ quoteFollowUpOn: '', quoteResponseNote: ' ' })).toEqual({ quoteFollowUpOn: null, quoteResponseNote: null });
  });
  it('rejects invalid status, note types and overflow', () => {
    for (const input of [{ status: 'PAID' }, { quoteResponseNote: 123 }, { quoteResponseNote: 'x'.repeat(2001) }, {}]) expect(() => parseQuoteWorkflowUpdate(input)).toThrow();
  });
  it('uses Europe/Berlin calendar midnight including daylight-saving transitions', () => {
    expect(quoteBusinessToday(new Date('2026-10-20T22:00:00Z'))).toBe('2026-10-21');
    expect(quoteBusinessToday(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(quoteBusinessToday(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
  it('keeps valid-until inclusive, highlights overdue tasks and never changes a status', () => {
    const quote = { status: 'SENT', validUntil: '2026-10-21T00:00:00Z' };
    expect(quoteNextAction(quote, '2026-10-21')).toBeNull();
    expect(quoteNextAction(quote, '2026-10-22')?.kind).toBe('NEEDS_RESPONSE');
    expect(quoteNextAction({ ...quote, quoteFollowUpOn: '2026-10-20' }, '2026-10-21')?.label).toContain('überfällig');
    expect(quote.status).toBe('SENT');
  });
  it.each(['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'])('does not create active follow-up tasks for %s', status => {
    const action = quoteNextAction({ status, quoteFollowUpOn: '2026-01-01' }, '2026-10-21');
    expect(action?.kind ?? null).toBe(status === 'ACCEPTED' ? 'READY_TO_INVOICE' : null);
  });
  it('uses real conversion association, not the response status, to retire preparation tasks', () => {
    expect(quoteNextAction({ status: 'ACCEPTED', convertedInvoice: { id: 42 } })).toBeNull();
  });
});

describe('conversion is separate from manual customer response', () => {
  it.each(['DRAFT', 'SENT', 'ACCEPTED'])('allows %s without declaring a new acceptance', status => {
    const quote = { status, validUntil: '2026-10-21' };
    expect(quoteConversionBlockReason(quote, '2026-10-21')).toBeNull();
    expect(quote.status).toBe(status);
  });
  it.each(['REJECTED', 'EXPIRED', 'CANCELLED', 'PAID'])('requires a conscious reopen or manually recorded acceptance for %s', status => {
    expect(quoteConversionBlockReason({ status }, '2026-10-21')).toContain('Rückmeldung');
  });
  it('guards just after Berlin midnight but allows the entire validity day, including the autumn clock change', () => {
    const quote = { status: 'SENT', validUntil: '2026-10-25' };
    expect(quoteConversionBlockReason(quote, quoteBusinessToday(new Date('2026-10-25T22:59:59Z')))).toBeNull();
    expect(quoteConversionBlockReason(quote, quoteBusinessToday(new Date('2026-10-25T23:00:00Z')))).toContain('Gültigkeit');
    expect(quoteConversionBlockReason({ ...quote, status: 'ACCEPTED' }, '2026-10-26')).toBeNull();
    expect(quoteConversionBlockReason({ ...quote, status: 'DRAFT' }, '2026-10-26')).toBeNull();
  });
});
