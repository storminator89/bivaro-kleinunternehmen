import { describe, expect, it } from 'vitest';
import { historyDocument, historyEvent, parseHistoryQuery } from '@/lib/invoice-history';
import { historyLifecycle, historyStatusLabel } from '@/lib/invoice-history-contract';

const query = (value: string) => parseHistoryQuery(new URLSearchParams(value));
describe('bounded invoice history presentation', () => {
  it.each(['page=NaN', 'page=0', 'page=100001', 'limit=51', 'invoiceId=-1', 'invoiceId=1.5', 'action=SECURITY_EVENT', 'userId=other', 'page=1&page=2', 'from=2026-02-30', 'to=2026-12-32', 'from=2026-10-21&to=2026-10-20', `search=${'x'.repeat(101)}`])('rejects invalid or ownership-changing query %s', value => {
    expect(() => query(value)).toThrow();
  });
  it('uses inclusive UTC calendar end with an exclusive next-day upper bound', () => {
    expect(query('invoiceId=42&page=2&limit=5&action=CANCELLED&from=2026-10-20&to=2026-10-21')).toMatchObject({ invoiceId: 42, page: 2, limit: 5, action: 'CANCELLED', from: new Date('2026-10-20T00:00:00Z'), until: new Date('2026-10-22T00:00:00Z') });
  });
  it('does not expose arbitrary payloads or invent missing prior values', () => {
    const result = historyEvent({ id: 1, userId: 'owner', entityId: '2', action: 'UPDATE', createdAt: new Date('2026-10-21T12:00:00Z'),
      oldValues: JSON.stringify({ status: 'SENT', iban: 'SECRET-IBAN', customer: { email: 'secret@example.test' }, totalAmount: 10 }),
      newValues: JSON.stringify({ status: 'CANCELLED', totalAmount: 20, password: 'SECRET-PASSWORD', parsedData: { rawXml: 'SECRET-XML' } }),
      metadata: JSON.stringify({ actorId: 'owner', authorization: 'SECRET-TOKEN', reason: 'SECRET-UNRELATED-REASON' }) });
    expect(result.changes).toEqual([{ field: 'status', label: 'Status', before: 'Versendet', after: 'Storniert' }, { field: 'totalAmount', label: 'Dokumentbetrag', before: '10', after: '20' }]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(historyEvent({ ...{ id: 2, userId: 'owner', entityId: '2', action: 'CREATE', createdAt: new Date(), oldValues: null, newValues: '{"status":"SENT"}', metadata: null } }).changes).toEqual([{ field: 'status', label: 'Status', before: null, after: 'Versendet' }]);
  });
  it('survives malformed legacy JSON and refuses contradictory actor context', () => {
    expect(historyEvent({ id: 1, userId: 'owner', entityId: '2', action: 'UPDATE', createdAt: new Date(), oldValues: 'broken', newValues: '[]', metadata: '{"actorId":"someone-else"}' })).toMatchObject({ actor: 'UNKNOWN', changes: [] });
  });
  it.each([
    ['PAYMENT_RECEIVED', 'Eingegangener Betrag (Cent)', 'Tatsächliches Eingangsdatum'],
    ['PAYMENT_CORRECTION', 'Nie erhaltener Betrag (Cent)', 'Gespeicherter Zahlungsdatumswert'],
    ['CUSTOMER_REFUND', 'Tatsächlich zurückgezahlter Betrag (Cent)', 'Gespeicherter Zahlungsdatumswert'],
    ['IMPORT', 'Finanzbelegbetrag (Cent)', 'Gespeicherter Zahlungsdatumswert'],
    ['UPDATE', 'Finanzbelegbetrag (Cent)', 'Gespeicherter Zahlungsdatumswert'],
    ['__proto__', 'Finanzbelegbetrag (Cent)', 'Gespeicherter Zahlungsdatumswert'],
  ])('labels %s evidence without inventing the direction or certainty of another action', (action, amountLabel, dateLabel) => {
    const event = historyEvent({ id: 1, userId: 'owner', entityId: '2', action, createdAt: new Date('2026-10-21T12:00:00Z'),
      oldValues: null, newValues: JSON.stringify({ amountCents: '4000', paidAt: '2026-10-01T00:00:00.000Z' }), metadata: null });
    expect(event.changes).toEqual([
      { field: 'amountCents', label: amountLabel, before: null, after: '4000' },
      { field: 'paidAt', label: dateLabel, before: null, after: '2026-10-01T00:00:00.000Z' },
    ]);
    expect(JSON.stringify(event)).not.toContain('Berichtigung / tatsächliche Rückzahlung');
  });
  it('does not infer currency, tax choice, issuance proof or foreign relationship from legacy data', () => {
    const row = { id: 2, invoiceNumber: 'SYNTHETIC', type: 'CREDIT_NOTE', status: 'DRAFT', issuanceState: 'UNKNOWN', invoiceDate: null, uploadedAt: new Date(), totalAmount: 10, parsedData: { company: { iban: 'SECRET' }, taxRate: 0 }, cancellationReason: null, originalInvoiceId: 99 };
    const result = historyDocument(row, new Set([2]));
    expect(result).toMatchObject({ originalInvoiceId: null, currency: null, taxMode: null });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(historyLifecycle(result)).toBe('Ausstellungsnachweis unbekannt');
    expect(historyLifecycle({ status: 'SENT', issuanceState: 'ISSUED' })).toBe('Ausgestellt');
  });
});


describe('hostile legacy enum keys', () => {
  it.each(['__proto__', 'constructor', 'toString'])('treats prototype key %s as unknown, never as a React child or DTO object', value => {
    expect(historyStatusLabel(value)).toBeNull();
    const event = historyEvent({ id: 1, userId: 'owner', entityId: '2', action: 'UPDATE', createdAt: new Date(), oldValues: JSON.stringify({ status: value, issuanceState: value }), newValues: '{"status":"CANCELLED","issuanceState":"ISSUED"}', metadata: null });
    expect(event.changes).toEqual([{ field: 'status', label: 'Status', before: null, after: 'Storniert' }, { field: 'issuanceState', label: 'Ausstellungsnachweis', before: null, after: 'Ausgestellt' }]);
    expect(event.changes.every(change => [change.before, change.after].every(value => value === null || typeof value === 'string'))).toBe(true);
  });
});
