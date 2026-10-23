import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { invoicePaymentAmounts } from '@/components/payments/payment-presentation';
import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';
import { InvoiceBalance } from '@/components/dashboard/tabs/invoices-tab';
import { IncomeInvoiceAttribution } from '@/components/dashboard/tabs/incomes-tab';
import { PaymentHistory } from '@/components/payments/payment-history';
import { PaymentAdjustmentPanel } from '@/components/payments/payment-adjustment-panel';
import { BankImportReceiptSummary } from '@/components/bank-csv/bank-import-panel';
import type { PaymentLedger, PaymentHistoryEvent } from '@/lib/full-payment-form';
import type { PaymentAdjustmentPreflight, PaymentAdjustmentEvent } from '@/lib/payment-adjustment-form';
import type { Invoice } from '@/types/dashboard';
import type { BankImportReceipt } from '@/lib/bank-import-contract';

const ledger: PaymentLedger = { version: 3, documentState: 'CANCELLED', originCash: { originalReceivedCents: '9900', correctedCents: '900', validReceivedCents: '9000', refundedCents: '1000', netRetainedCents: '8000' }, allocation: { originalAllocatedCents: '5000', correctedAllocatedCents: '1000', validAllocatedCents: '4000', refundedAllocatedCents: '2000', retainedAllocatedCents: '2000' }, collectibleOpenCents: '0', refundDueCents: '2000' };
const root = { originalPaymentId: 31, originInvoiceId: 7, allocatedInvoiceId: 8, amountCents: '5000', validReceivedCents: '4000', refundedCents: '2000', retainedCents: '2000', paidAt: '2026-10-21T00:00:00.000Z', dateCertainty: 'ACTUAL', source: 'MANUAL', bindingStableKey: '11111111-1111-4111-8111-111111111111', allocationRevision: 2, allocationChangeStableKey: '22222222-2222-4222-8222-222222222222', provenance: 'BANK_CSV' as const };
const journal: PaymentAdjustmentPreflight = { ledger, ledgerVersion: 'a'.repeat(64), summary: { totalCents: '12000', paidCents: '4000', openCents: '0', paid: false, paymentState: 'PARTIAL' }, events: [], originEvents: [], effectivePayments: [root], rootCapabilities: [{ originalPaymentId: 31, correctableCents: '2000', refundableCents: '2000', canCorrect: true, canRefund: true, canReallocate: false, correctionReviewReason: null, refundReviewReason: null, reallocationReviewReason: 'Folgebeleg vorhanden.' }], adjustments: [], adjustmentCapacities: [{ originalPaymentId: 31, correctableCents: '2000', refundableCents: '2000' }], eligibleCancellationBasis: { invoiceId: 9, invoiceNumber: 'ST-8' }, canRecordAdjustment: true, adjustmentReviewReason: null };

describe('allocation-aware invoice presentation without rewritten cash evidence', () => {
  it('uses current allocation metrics instead of immutable origin cash, preserving v2 mapping', () => {
    expect(invoicePaymentAmounts(ledger)).toEqual({ valid: '4000', corrected: '1000', refunded: '2000', retained: '2000', open: '0', refundDue: '2000' });
    const old: PaymentLedger = { version: 2, originalReceivedCents: '5000', correctedCents: '1000', validReceivedCents: '4000', refundedCents: '2000', netRetainedCents: '2000', collectibleOpenCents: '0', refundDueCents: '2000' };
    expect(invoicePaymentAmounts(old)).toEqual(invoicePaymentAmounts(ledger));
  });
  it('renders the current invoice refund, never the different original cash refund', () => {
    const html = renderToStaticMarkup(createElement(InvoiceBalance, { invoice: { status: 'CANCELLED', paymentLedger: ledger } as Invoice }));
    expect(html).toContain('Tatsächlich erstattet 20,00 €'); expect(html).toContain('Noch zu erstatten 20,00 €'); expect(html).not.toContain('10,00 €');
  });
  it('shows allocation-axis panel figures and does not disable eligible roots invoice-wide', () => {
    const html = renderToStaticMarkup(createElement(PaymentAdjustmentPanel, { invoiceId: 8, tenantId: 'synthetic', journal, disabled: false, loading: false, onEditingChange() {}, onBusyChange() {}, onReload() {}, onRecorded: async () => {} }));
    for (const phrase of ['Gültig zugeordnet', '40,00 €', '10,00 €', '20,00 €', 'Korrektur / Erstattung dokumentieren', 'Andere Rechnung']) expect(html).toContain(phrase);
    expect(html).not.toContain('90,00 €'); expect(html).not.toContain('80,00 €');
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)[^>]*>Korrektur \/ Erstattung/);
  });
  it('renders an incoming effective root even when the current invoice has no origin events', () => {
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events: [], effectivePayments: [root] }));
    expect(html).toContain('Aktuell dieser Rechnung zugeordnet'); expect(html).toContain('Original-Zahlungsnachweis #31'); expect(html).toContain('Ursprung Rechnung #7'); expect(html).toContain('aktuell Rechnung #8');
  });
  it('keeps an origin receipt readable after it moved away without calling it currently paid', () => {
    const event: PaymentHistoryEvent = { id: 31, invoiceId: 7, amountCents: '5000', currency: 'EUR', paidAt: root.paidAt, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'original', idempotencyKey: 'original-key' };
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events: [event], effectivePayments: [] }));
    expect(html).toContain('Originaleingang auf Rechnung #7'); expect(html).toContain('nicht aktuell dieser Rechnung zugeordnet'); expect(html).toContain('Kein Zahlungseingang aktuell zugeordnet');
  });
  it('keeps a real refund visible on the current invoice even though its receipt originated elsewhere', () => {
    const refund: PaymentAdjustmentEvent = { id: 44, originalPaymentId: 31, kind: 'CUSTOMER_REFUND', amountCents: '2000', currency: 'EUR', actionDate: '2026-10-22T00:00:00.000Z', accountingEffectiveOn: '2026-10-22T00:00:00.000Z', reason: 'Echte Rückzahlung', reference: 'Payout evidence', idempotencyKey: 'payout', cancellationInvoiceId: 9, fiscalMappingStatus: 'UNREVIEWED', contractVersion: 3, allocationBasisSnapshot: { originInvoiceNumber: 'RE-A', currentInvoiceNumber: 'RE-B' } };
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events: [], effectivePayments: [root], adjustments: [refund] }));
    for (const phrase of ['Erstattung: tatsächlich zurückgezahlt', '20,00 €', 'Folgebeleg #44', 'Original #31', 'Original: RE-A', 'Zuordnung bei Erfassung: RE-B', 'Vollständiger Stornobeleg #9']) expect(html).toContain(phrase);
    expect(html).not.toContain('Korrektur: nie erhalten');
  });
  it('presents immutable allocation changes as no-cash history rather than another receipt or refund', () => {
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events: [], effectivePayments: [], allocationHistory: [{ id: 5, stableKey: 'change', bindingStableKey: root.bindingStableKey, originalPaymentKey: 'original', revision: 2, fromInvoiceId: 7, toInvoiceId: 8, fromInvoiceNumber: 'RE-A', toInvoiceNumber: 'RE-B', amountCents: '4000', currency: 'EUR', actionDate: '2026-10-22T00:00:00.000Z', reason: 'Falsche Rechnung erkannt', recordedAt: '2026-10-22T12:00:00.000Z' }] }));
    for (const phrase of ['Rechnungswechsel · kein Geldfluss', 'RE-A', 'RE-B', 'Stand 2', 'Entdeckt 22.10.2026']) expect(html).toContain(phrase);
    expect(html).not.toContain('Erstattung: tatsächlich');
  });
  it('labels income origin and current assignment independently, including review-required state', () => {
    const income = { id: 1, description: 'Receipt', amount: 40, date: '2026-10-21', taxRelevant: true, originInvoiceId: 7, originInvoiceNumber: 'RE-A', allocatedInvoiceId: 8, allocatedInvoiceNumber: 'RE-B', allocationRevision: 2 };
    const html = renderToStaticMarkup(createElement(IncomeInvoiceAttribution, { income }));
    for (const phrase of ['Originaleingang', 'RE-A', 'Aktuell zugeordnet', 'RE-B', '/history?invoiceId=7', '/history?invoiceId=8']) expect(html).toContain(phrase);
    const review = renderToStaticMarkup(createElement(IncomeInvoiceAttribution, { income: { ...income, paymentAllocationReviewRequired: true } }));
    expect(review).toContain('Aktuelle Zuordnung prüfen'); expect(review).not.toContain('RE-B');
  });
  it('keeps a receipt activity as original cash while linking and labelling its current invoice allocation', () => {
    const html = renderToStaticMarkup(createElement(DashboardActivityFeed, { activities: [{ id: 'receipt:31', type: 'income', description: 'Original receipt', date: '2026-10-21', amount: 40, movementKind: 'RECEIPT', invoiceId: 7, originInvoiceId: 7, allocatedInvoiceId: 8, invoiceAttribution: 'IMMUTABLE_CASH_ORIGIN' }] }));
    for (const phrase of ['Original-Rechnung #7', 'aktuell #8', '/history?invoiceId=8', 'Einnahme', '40,00']) expect(html).toContain(phrase);
    expect(html).not.toContain('Erstattung:');
  });
  it('preserves the original no-assignment journey but never makes that blanket claim for a live or unknown batch', () => {
    const receipt = { accountAlias: 'Testkonto', counts: { total: 1, invalid: 0, duplicates: 0, overlapRows: 0 }, savedAt: '2026-10-22T00:00:00.000Z', totals: { incomingCents: '4000', outgoingCents: '0' }, period: { from: '2026-10-21', to: '2026-10-21' } } as BankImportReceipt;
    expect(renderToStaticMarkup(createElement(BankImportReceiptSummary, { receipt, assignmentCount: 0 }))).toContain('noch keine Zahlungen zugeordnet');
    for (const assignmentCount of [1, null]) {
      const html = renderToStaticMarkup(createElement(BankImportReceiptSummary, { receipt, assignmentCount }));
      expect(html).not.toContain('noch keine Zahlungen zugeordnet'); expect(html).toContain('Der Import selbst hat keine Zahlung erfasst');
    }
  });
});
